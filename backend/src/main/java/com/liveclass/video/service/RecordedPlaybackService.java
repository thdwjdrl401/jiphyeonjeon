package com.liveclass.video.service;

import com.liveclass.video.api.LessonPlaybackAccess;
import com.liveclass.video.api.RecordedVideoConflictException;
import com.liveclass.video.api.RecordedVideoNotFoundException;
import com.liveclass.video.api.RecordedCaptionNotFoundException;
import com.liveclass.video.config.PlaybackProperties;
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
import com.liveclass.video.web.dto.RecordedPlaybackResponse;
import com.liveclass.video.web.dto.RecordedCaptionSegmentResponse;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/** 업로드 녹화강의 전용 playback. 라이브 시간축·ReplayStatus·delta playlist를 사용하지 않는다. */
@Service
public class RecordedPlaybackService {

    private final RecordedVideoRepository recordedVideoRepository;
    private final LessonPlaybackAccess playbackAccess;
    private final ReplayStorage replayStorage;
    private final HlsManifestProcessor manifestProcessor;
    private final PlaybackProperties playbackProperties;
    private final RecordedCaptionTrackRepository trackRepository;
    private final RecordedCaptionSegmentRepository segmentRepository;
    private final MeterRegistry meterRegistry;

    public RecordedPlaybackService(RecordedVideoRepository recordedVideoRepository,
                                   LessonPlaybackAccess playbackAccess,
                                   ReplayStorage replayStorage,
                                   HlsManifestProcessor manifestProcessor,
                                   PlaybackProperties playbackProperties,
                                   RecordedCaptionTrackRepository trackRepository,
                                   RecordedCaptionSegmentRepository segmentRepository,
                                   MeterRegistry meterRegistry) {
        this.recordedVideoRepository = recordedVideoRepository;
        this.playbackAccess = playbackAccess;
        this.replayStorage = replayStorage;
        this.manifestProcessor = manifestProcessor;
        this.playbackProperties = playbackProperties;
        this.trackRepository = trackRepository;
        this.segmentRepository = segmentRepository;
        this.meterRegistry = meterRegistry;
    }

    @Transactional(readOnly = true)
    public RecordedPlaybackResponse playback(UUID userId, UUID lessonId) {
        playbackAccess.resolve(userId, lessonId);
        RecordedVideo video = requirePublished(lessonId);
        String manifestUrl = "/api/lessons/%s/recorded-playback/manifest".formatted(lessonId);
        RecordedPlaybackResponse.Captions captions = captions(video, lessonId);
        return new RecordedPlaybackResponse(
                lessonId,
                video.getId(),
                video.getDurationMs(),
                video.getPublicationStatus().name(),
                new RecordedPlaybackResponse.Source(manifestUrl, 0, video.getDurationMs()),
                captions);
    }

    @Transactional(readOnly = true)
    public String manifest(UUID userId, UUID lessonId) {
        playbackAccess.resolve(userId, lessonId);
        RecordedVideo video = requirePublished(lessonId);
        String raw;
        try {
            raw = replayStorage.findManifest(video.getOutputBucket(), video.getHlsManifestKey())
                    .orElseThrow(() -> new RecordedVideoConflictException(
                            "RECORDED_VIDEO_NOT_READY", "녹화강의 재생목록을 찾을 수 없습니다."));
            if (!raw.lines().anyMatch(line -> line.strip().equals("#EXT-X-ENDLIST"))) {
                throw new RecordedVideoConflictException(
                        "RECORDED_VIDEO_NOT_READY", "완성된 녹화강의 재생목록이 아닙니다.");
            }
            return manifestProcessor.rewrite(
                    raw, video.getOutputBucket(), video.getHlsManifestKey(), playbackProperties.segmentUrlTtl());
        } catch (RecordedVideoConflictException | ReplayManifestInvalidException e) {
            throw e;
        } catch (RuntimeException e) {
            throw new PlaybackStorageUnavailableException("녹화강의 스토리지에 연결할 수 없습니다.", e);
        }
    }

    @Transactional(readOnly = true)
    public String captionWebVtt(UUID userId, UUID lessonId, UUID trackId) {
        playbackAccess.resolve(userId, lessonId);
        RecordedVideo video = requirePublished(lessonId);
        RecordedCaptionTrack track = trackRepository.findById(trackId)
                .filter(candidate -> candidate.getRecordedVideoId().equals(video.getId()))
                .filter(candidate -> candidate.getStatus() == RecordedCaptionStatus.READY)
                .filter(candidate -> candidate.getPublicationStatus() == RecordedCaptionPublicationStatus.PUBLISHED)
                .filter(candidate -> candidate.getActiveJobId() != null)
                .orElseThrow(() -> {
                    meterRegistry.counter("recorded.caption.vtt.request", "result", "not_found").increment();
                    return new RecordedCaptionNotFoundException("게시된 녹화강의 자막을 찾을 수 없습니다.");
                });
        List<RecordedCaptionSegment> segments = segmentRepository
                .findByTrackIdAndJobIdOrderByStartMsAscLocalSegmentIndexAsc(track.getId(), track.getActiveJobId());
        if (segments.size() != track.getSegmentCount()) {
            meterRegistry.counter("recorded.caption.vtt.request", "result", "error").increment();
            throw new RecordedVideoConflictException(
                    "RECORDED_CAPTION_NOT_READY", "게시된 자막 구간이 완전하지 않습니다.");
        }
        StringBuilder vtt = new StringBuilder("WEBVTT\n\n");
        for (RecordedCaptionSegment segment : segments) {
            vtt.append("segment-").append(segment.getId()).append('\n')
                    .append(toVttTimestamp(segment.getStartMs()))
                    .append(" --> ")
                    .append(toVttTimestamp(segment.getEndMs()))
                    .append('\n')
                    .append(normalizeCueText(segment.getText()))
                    .append("\n\n");
        }
        meterRegistry.counter("recorded.caption.vtt.request", "result", "success").increment();
        return vtt.toString();
    }

    /** HLS 플레이어 아래 공통 CaptionDock에 표시할 게시 자막의 구조화된 시간 구간. */
    @Transactional(readOnly = true)
    public List<RecordedCaptionSegmentResponse> captionSegments(UUID userId, UUID lessonId) {
        playbackAccess.resolve(userId, lessonId);
        RecordedVideo video = requirePublished(lessonId);
        RecordedCaptionTrack track = trackRepository.findByRecordedVideoId(video.getId()).orElse(null);
        if (track == null || track.getStatus() == RecordedCaptionStatus.EMPTY) {
            return List.of();
        }
        if (track.getStatus() != RecordedCaptionStatus.READY
                || track.getPublicationStatus() != RecordedCaptionPublicationStatus.PUBLISHED
                || track.getActiveJobId() == null) {
            throw new RecordedVideoConflictException(
                    "RECORDED_CAPTION_NOT_READY", "녹화강의 자막이 게시되지 않았습니다.");
        }
        List<RecordedCaptionSegment> segments = segmentRepository
                .findByTrackIdAndJobIdOrderByStartMsAscLocalSegmentIndexAsc(track.getId(), track.getActiveJobId());
        if (segments.size() != track.getSegmentCount()) {
            throw new RecordedVideoConflictException(
                    "RECORDED_CAPTION_NOT_READY", "게시된 자막 구간이 완전하지 않습니다.");
        }
        return segments.stream().map(RecordedCaptionSegmentResponse::from).toList();
    }

    private RecordedPlaybackResponse.Captions captions(RecordedVideo video, UUID lessonId) {
        RecordedCaptionTrack track = trackRepository.findByRecordedVideoId(video.getId()).orElse(null);
        // V26 이전 READY 자산은 서비스 연속성을 위해 PUBLISHED로 backfill되며 자막 트랙이 없을 수 있다.
        if (track == null || track.getStatus() == RecordedCaptionStatus.EMPTY) {
            return new RecordedPlaybackResponse.Captions("EMPTY", List.of());
        }
        if (track.getStatus() != RecordedCaptionStatus.READY
                || track.getPublicationStatus() != RecordedCaptionPublicationStatus.PUBLISHED) {
            throw new RecordedVideoConflictException(
                    "RECORDED_CAPTION_NOT_READY", "녹화강의 자막이 게시되지 않았습니다.");
        }
        String language = track.getLanguage() == null ? "ko" : track.getLanguage();
        String label = "ko".equalsIgnoreCase(language) ? "한국어" : language;
        String url = "/api/lessons/%s/recorded-playback/captions/%s.vtt?v=%d"
                .formatted(lessonId, track.getId(), track.getVersion());
        RecordedPlaybackResponse.Track responseTrack = new RecordedPlaybackResponse.Track(
                track.getId(), language, label, "subtitles", "WEBVTT", url, track.getVersion(), true);
        return new RecordedPlaybackResponse.Captions("AVAILABLE", List.of(responseTrack));
    }

    private String toVttTimestamp(long milliseconds) {
        long hours = milliseconds / 3_600_000;
        long minutes = (milliseconds % 3_600_000) / 60_000;
        long seconds = (milliseconds % 60_000) / 1_000;
        long millis = milliseconds % 1_000;
        return "%02d:%02d:%02d.%03d".formatted(hours, minutes, seconds, millis);
    }

    private String normalizeCueText(String text) {
        return text.replace("\u0000", "")
                .replace("\r\n", "\n")
                .replace('\r', '\n')
                .strip();
    }

    private RecordedVideo requirePublished(UUID lessonId) {
        RecordedVideo video = recordedVideoRepository.findByLessonId(lessonId)
                .orElseThrow(() -> new RecordedVideoNotFoundException("녹화강의를 찾을 수 없습니다."));
        if (video.getStatus() != RecordedVideoStatus.READY
                || video.getPublicationStatus() != RecordedPublicationStatus.PUBLISHED) {
            throw new RecordedVideoConflictException(
                    "RECORDED_VIDEO_NOT_PUBLISHED", "녹화강의 영상과 자막이 아직 게시되지 않았습니다.");
        }
        return video;
    }
}
