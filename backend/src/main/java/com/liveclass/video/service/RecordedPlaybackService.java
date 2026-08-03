package com.liveclass.video.service;

import com.liveclass.video.api.LessonPlaybackAccess;
import com.liveclass.video.api.RecordedVideoConflictException;
import com.liveclass.video.api.RecordedVideoNotFoundException;
import com.liveclass.video.config.PlaybackProperties;
import com.liveclass.video.domain.RecordedVideo;
import com.liveclass.video.domain.RecordedVideoStatus;
import com.liveclass.video.repository.RecordedVideoRepository;
import com.liveclass.video.web.dto.RecordedPlaybackResponse;
import org.springframework.stereotype.Service;

import java.util.UUID;

/** 업로드 녹화강의 전용 playback. 라이브 시간축·ReplayStatus·delta playlist를 사용하지 않는다. */
@Service
public class RecordedPlaybackService {

    private final RecordedVideoRepository recordedVideoRepository;
    private final LessonPlaybackAccess playbackAccess;
    private final ReplayStorage replayStorage;
    private final HlsManifestProcessor manifestProcessor;
    private final PlaybackProperties playbackProperties;

    public RecordedPlaybackService(RecordedVideoRepository recordedVideoRepository,
                                   LessonPlaybackAccess playbackAccess,
                                   ReplayStorage replayStorage,
                                   HlsManifestProcessor manifestProcessor,
                                   PlaybackProperties playbackProperties) {
        this.recordedVideoRepository = recordedVideoRepository;
        this.playbackAccess = playbackAccess;
        this.replayStorage = replayStorage;
        this.manifestProcessor = manifestProcessor;
        this.playbackProperties = playbackProperties;
    }

    public RecordedPlaybackResponse playback(UUID userId, UUID lessonId) {
        playbackAccess.resolve(userId, lessonId);
        RecordedVideo video = requireReady(lessonId);
        String manifestUrl = "/api/lessons/%s/recorded-playback/manifest".formatted(lessonId);
        return new RecordedPlaybackResponse(
                lessonId,
                video.getId(),
                video.getDurationMs(),
                new RecordedPlaybackResponse.Source(manifestUrl, 0, video.getDurationMs()));
    }

    public String manifest(UUID userId, UUID lessonId) {
        playbackAccess.resolve(userId, lessonId);
        RecordedVideo video = requireReady(lessonId);
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

    private RecordedVideo requireReady(UUID lessonId) {
        RecordedVideo video = recordedVideoRepository.findByLessonId(lessonId)
                .orElseThrow(() -> new RecordedVideoNotFoundException("녹화강의를 찾을 수 없습니다."));
        if (video.getStatus() != RecordedVideoStatus.READY) {
            throw new RecordedVideoConflictException(
                    "RECORDED_VIDEO_NOT_READY", "녹화강의 영상이 아직 준비되지 않았습니다.");
        }
        return video;
    }
}
