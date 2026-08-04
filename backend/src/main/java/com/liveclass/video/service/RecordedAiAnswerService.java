package com.liveclass.video.service;

import com.liveclass.aiintegration.api.RagAnswerObserver;
import com.liveclass.aiintegration.api.RagAnswerRelay;
import com.liveclass.aiintegration.api.RagAnswerStreamHandle;
import com.liveclass.aiintegration.api.ReplayRagAnswerCommand;
import com.liveclass.aiintegration.api.ReplayRagAnswerStreaming;
import com.liveclass.video.api.LessonPlaybackAccess;
import com.liveclass.video.api.PlaybackAccessGrant;
import com.liveclass.video.api.RecordedVideoConflictException;
import com.liveclass.video.api.RecordedVideoNotFoundException;
import com.liveclass.video.domain.RecordedCaptionPublicationStatus;
import com.liveclass.video.domain.RecordedCaptionSegment;
import com.liveclass.video.domain.RecordedCaptionStatus;
import com.liveclass.video.domain.RecordedCaptionTrack;
import com.liveclass.video.domain.RecordedPublicationStatus;
import com.liveclass.video.domain.RecordedVideo;
import com.liveclass.video.domain.RecordedVideoStatus;
import com.liveclass.video.repository.RecordedCaptionSegmentRepository;
import com.liveclass.video.repository.RecordedCaptionTrackRepository;
import com.liveclass.video.repository.RecordedVideoRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/** 게시된 녹화강의 질문을 ai-api Replay v2 계약으로 조립하고 SSE를 중계한다(ADR-0015). */
@Service
public class RecordedAiAnswerService {

    static final long CAPTION_WINDOW_MS = 30_000L;
    static final int MAX_CAPTION_SEGMENTS = 20;
    static final int MAX_CAPTION_CHARS = 6_000;
    private static final Logger log = LoggerFactory.getLogger(RecordedAiAnswerService.class);

    private final RecordedVideoRepository videoRepository;
    private final RecordedCaptionTrackRepository trackRepository;
    private final RecordedCaptionSegmentRepository segmentRepository;
    private final LessonPlaybackAccess playbackAccess;
    private final ReplayRagAnswerStreaming replayRagAnswerStreaming;
    private final RagAnswerRelay ragAnswerRelay;

    public RecordedAiAnswerService(RecordedVideoRepository videoRepository,
                                   RecordedCaptionTrackRepository trackRepository,
                                   RecordedCaptionSegmentRepository segmentRepository,
                                   LessonPlaybackAccess playbackAccess,
                                   ReplayRagAnswerStreaming replayRagAnswerStreaming,
                                   RagAnswerRelay ragAnswerRelay) {
        this.videoRepository = videoRepository;
        this.trackRepository = trackRepository;
        this.segmentRepository = segmentRepository;
        this.playbackAccess = playbackAccess;
        this.replayRagAnswerStreaming = replayRagAnswerStreaming;
        this.ragAnswerRelay = ragAnswerRelay;
    }

    /** 브라우저가 보내지 않은 식별자와 자막 문맥을 모두 서버의 게시 자산에서 채운다. */
    @Transactional(readOnly = true)
    public ReplayRagAnswerCommand prepare(UUID userId, UUID lessonId, String question, long playbackMs) {
        PlaybackAccessGrant grant = playbackAccess.resolve(userId, lessonId);
        RecordedVideo video = videoRepository.findByLessonId(lessonId)
                .orElseThrow(() -> new RecordedVideoNotFoundException("녹화강의를 찾을 수 없습니다."));
        requirePublished(video);

        Long durationMs = video.getDurationMs();
        long questionMs = durationMs != null && durationMs > 0
                ? Math.min(playbackMs, durationMs)
                : playbackMs;
        List<ReplayRagAnswerCommand.Caption> captions = captionContext(video.getId(), questionMs);
        return new ReplayRagAnswerCommand(
                UUID.randomUUID().toString(),
                lessonId,
                grant.curriculumId(),
                video.getId(),
                question,
                questionMs,
                captions);
    }

    private List<ReplayRagAnswerCommand.Caption> captionContext(UUID recordedVideoId, long questionMs) {
        RecordedCaptionTrack track = trackRepository.findByRecordedVideoId(recordedVideoId).orElse(null);
        // 무발화(EMPTY)나 구버전 게시 자산의 track 부재는 정상이다. PPTX 근거만으로 계속 답한다.
        if (track == null || track.getStatus() == RecordedCaptionStatus.EMPTY) {
            return List.of();
        }
        if (track.getStatus() != RecordedCaptionStatus.READY
                || track.getPublicationStatus() != RecordedCaptionPublicationStatus.PUBLISHED
                || track.getActiveJobId() == null) {
            throw captionNotReady("녹화강의 자막이 게시되지 않았습니다.");
        }
        List<RecordedCaptionSegment> candidates = segmentRepository.findContextSegments(
                track.getId(), track.getActiveJobId(), Math.max(0L, questionMs - CAPTION_WINDOW_MS), questionMs);
        return adaptCaptions(track.getActiveJobId(), candidates);
    }

    /** 질문에 가장 가까운 구간부터 예산을 채운 뒤 다시 시간순으로 돌린다. */
    static List<ReplayRagAnswerCommand.Caption> adaptCaptions(
            UUID jobId, List<RecordedCaptionSegment> candidates) {
        List<CaptionValue> selectedNewestFirst = new ArrayList<>();
        int chars = 0;
        for (int index = candidates.size() - 1;
             index >= 0 && selectedNewestFirst.size() < MAX_CAPTION_SEGMENTS;
             index--) {
            RecordedCaptionSegment segment = candidates.get(index);
            String text = normalize(segment.getText());
            if (text.isBlank()) {
                continue;
            }
            int remaining = MAX_CAPTION_CHARS - chars;
            if (text.length() > remaining) {
                if (selectedNewestFirst.isEmpty() && remaining > 0) {
                    text = text.substring(text.length() - remaining);
                } else {
                    break;
                }
            }
            selectedNewestFirst.add(new CaptionValue(segment.getStartMs(), segment.getEndMs(), text));
            chars += text.length();
        }
        Collections.reverse(selectedNewestFirst);
        List<ReplayRagAnswerCommand.Caption> result = new ArrayList<>(selectedNewestFirst.size());
        for (int index = 0; index < selectedNewestFirst.size(); index++) {
            CaptionValue value = selectedNewestFirst.get(index);
            result.add(new ReplayRagAnswerCommand.Caption(
                    jobId.toString(), index, value.startMs(), value.endMs(), value.text()));
        }
        return List.copyOf(result);
    }

    public RagAnswerStreamHandle open(ReplayRagAnswerCommand command) {
        return replayRagAnswerStreaming.open(command);
    }

    /**
     * 브라우저로 잇는다. 중계 규칙(이벤트 무변환·terminal 정확히 하나·취소 시 업스트림 닫기)은 라이브·
     * 다시보기와 완전히 같아 공용 릴레이에 맡긴다(ADR-0075) — 예전에는 같은 펌프가 여기에도 복제돼 있었다.
     *
     * <p>답변을 기록하지 않는다({@link RagAnswerObserver#NONE}) — 녹화강의에는 질문을 묶어 둘 라이브
     * 세션이 없다. 기록은 LIVE 갈래만 남긴다.
     */
    public SseEmitter relay(ReplayRagAnswerCommand command, RagAnswerStreamHandle handle) {
        return ragAnswerRelay.relay(command.requestId(), handle, RagAnswerObserver.NONE);
    }

    private void requirePublished(RecordedVideo video) {
        if (video.getStatus() != RecordedVideoStatus.READY
                || video.getPublicationStatus() != RecordedPublicationStatus.PUBLISHED) {
            throw new RecordedVideoConflictException(
                    "RECORDED_VIDEO_NOT_PUBLISHED", "녹화강의 영상과 자막이 아직 게시되지 않았습니다.");
        }
    }

    private RecordedVideoConflictException captionNotReady(String message) {
        return new RecordedVideoConflictException("RECORDED_CAPTION_NOT_READY", message);
    }

    private static String normalize(String text) {
        return text == null ? "" : text.replace("\u0000", "").strip();
    }

    private record CaptionValue(long startMs, long endMs, String text) {
    }
}
