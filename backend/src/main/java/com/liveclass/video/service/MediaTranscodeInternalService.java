package com.liveclass.video.service;

import com.liveclass.asset.api.AssetUploadManagement;
import com.liveclass.video.config.EgressProperties;
import com.liveclass.video.domain.MediaTranscodeJob;
import com.liveclass.video.domain.MediaTranscodeJobStatus;
import com.liveclass.video.domain.RecordedVideo;
import com.liveclass.video.domain.RecordedVideoStatus;
import com.liveclass.video.repository.MediaTranscodeJobRepository;
import com.liveclass.video.repository.RecordedVideoRepository;
import com.liveclass.video.web.dto.MediaTranscodeCallbackEvent;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** media-worker 전용 source URL 발급과 상태 callback 처리. */
@Service
public class MediaTranscodeInternalService {

    private static final Set<String> STABLE_FAILURE_CODES = Set.of(
            "SOURCE_DOWNLOAD_FAILED", "SOURCE_INVALID", "SOURCE_TOO_LARGE",
            "DURATION_LIMIT_EXCEEDED", "FFPROBE_FAILED", "FFMPEG_FAILED",
            "OUTPUT_UPLOAD_FAILED", "WORKER_INTERNAL_ERROR");

    private final MediaTranscodeJobRepository jobRepository;
    private final RecordedVideoRepository recordedVideoRepository;
    private final AssetUploadManagement assetUploadManagement;
    private final ReplayStorage replayStorage;
    private final RecordingStorage recordingStorage;
    private final HlsManifestProcessor manifestProcessor;
    private final EgressProperties egressProperties;
    private final MediaCallbackInbox callbackInbox;
    private final RecordedPublicationService publicationService;

    public MediaTranscodeInternalService(MediaTranscodeJobRepository jobRepository,
                                         RecordedVideoRepository recordedVideoRepository,
                                         AssetUploadManagement assetUploadManagement,
                                         ReplayStorage replayStorage,
                                         RecordingStorage recordingStorage,
                                         HlsManifestProcessor manifestProcessor,
                                         EgressProperties egressProperties,
                                         MediaCallbackInbox callbackInbox,
                                         RecordedPublicationService publicationService) {
        this.jobRepository = jobRepository;
        this.recordedVideoRepository = recordedVideoRepository;
        this.assetUploadManagement = assetUploadManagement;
        this.replayStorage = replayStorage;
        this.recordingStorage = recordingStorage;
        this.manifestProcessor = manifestProcessor;
        this.egressProperties = egressProperties;
        this.callbackInbox = callbackInbox;
        this.publicationService = publicationService;
    }

    @Transactional(readOnly = true)
    public String issueSourceUrl(UUID jobId) {
        MediaTranscodeJob job = requireJob(jobId);
        // Dispatcher는 DB 행을 잠근 트랜잭션 안에서 RabbitMQ에 발행한다. 소비가 매우 빠르면
        // 그 트랜잭션의 DISPATCHED 커밋보다 source URL 요청이 먼저 도착해 다른 트랜잭션에서는
        // 아직 PENDING으로 보일 수 있다. 유효한 worker HMAC과 jobId를 가진 요청에 한해 이 짧은
        // 상태도 허용하고, RUNNING callback은 dispatcher 커밋 뒤 행 잠금을 이어받아 확정한다.
        if (job.getStatus() != MediaTranscodeJobStatus.PENDING
                && job.getStatus() != MediaTranscodeJobStatus.DISPATCHED
                && job.getStatus() != MediaTranscodeJobStatus.RUNNING) {
            throw new MediaTranscodeCallbackInvalidException("원본 URL을 발급할 수 없는 작업 상태입니다.");
        }
        RecordedVideo video = requireVideo(job.getRecordedVideoId());
        if (video.getSourceAssetId() == null) {
            throw new MediaTranscodeCallbackInvalidException("변환할 원본 MP4가 없습니다.");
        }
        return assetUploadManagement.resolveRecordedVideoSourceUrl(video.getSourceAssetId())
                .orElseThrow(() -> new MediaTranscodeCallbackInvalidException("변환할 원본 MP4가 준비되지 않았습니다."));
    }

    @Transactional
    public void handleCallback(MediaTranscodeCallbackEvent event, String rawJson) {
        validateEnvelope(event);
        if (!callbackInbox.tryReceive(
                event.eventId(), "MEDIA_TRANSCODE_" + event.status(), event.recordedVideoId().toString(), rawJson)) {
            return;
        }

        // media/STT terminal callback 모두 recorded_video를 먼저 잠가 lock 순서를 통일한다.
        RecordedVideo video = requireVideoForUpdate(event.recordedVideoId());
        MediaTranscodeJob job = requireJob(event.jobId());
        if (!job.getRecordedVideoId().equals(video.getId())) {
            throw new MediaTranscodeCallbackInvalidException("job과 recordedVideo가 일치하지 않습니다.");
        }

        // 같은 attempt의 terminal 결과는 먼저 확정된 것을 유지한다. 늦은 callback이 READY를 되돌리지 않는다.
        if (job.getStatus() == MediaTranscodeJobStatus.SUCCEEDED
                || job.getStatus() == MediaTranscodeJobStatus.FAILED) {
            callbackInbox.markProcessed(event.eventId());
            if (job.getStatus() == MediaTranscodeJobStatus.SUCCEEDED) {
                publicationService.tryAutoPublish(video.getId());
            }
            return;
        }

        switch (event.status()) {
            case "RUNNING" -> markRunning(job, video);
            case "FAILED" -> markFailed(job, video, stableFailureCode(event.failureCode()));
            case "SUCCEEDED" -> verifyAndMarkReady(job, video, event.output());
            default -> throw new MediaTranscodeCallbackInvalidException("지원하지 않는 callback 상태입니다.");
        }
        callbackInbox.markProcessed(event.eventId());
        if (job.getStatus() == MediaTranscodeJobStatus.SUCCEEDED) {
            publicationService.tryAutoPublish(video.getId());
        }
    }

    private void markRunning(MediaTranscodeJob job, RecordedVideo video) {
        job.setStatus(MediaTranscodeJobStatus.RUNNING);
        if (job.getStartedAt() == null) {
            job.setStartedAt(OffsetDateTime.now());
        }
        if (video.getStatus() != RecordedVideoStatus.READY) {
            video.setStatus(RecordedVideoStatus.TRANSCODING);
            video.setFailureCode(null);
        }
    }

    private void markFailed(MediaTranscodeJob job, RecordedVideo video, String failureCode) {
        job.setStatus(MediaTranscodeJobStatus.FAILED);
        job.setFinishedAt(OffsetDateTime.now());
        job.setLastError(failureCode);
        if (video.getStatus() != RecordedVideoStatus.READY) {
            video.setStatus(RecordedVideoStatus.FAILED);
            video.setFailureCode(failureCode);
        }
    }

    private void verifyAndMarkReady(MediaTranscodeJob job, RecordedVideo video,
                                    MediaTranscodeCallbackEvent.Output output) {
        if (output == null || output.bucket() == null || output.hlsManifestKey() == null
                || output.durationMs() == null || output.durationMs() <= 0
                || output.sizeBytes() == null || output.sizeBytes() < 0
                || output.segmentCount() == null || output.segmentCount() <= 0) {
            throw new MediaTranscodeCallbackInvalidException("성공 callback의 출력 메타데이터가 올바르지 않습니다.");
        }
        String expectedKey = "recorded/%s/index.m3u8".formatted(video.getId());
        if (!egressProperties.bucket().equals(output.bucket()) || !expectedKey.equals(output.hlsManifestKey())) {
            throw new MediaTranscodeCallbackInvalidException("서버가 지정한 HLS 출력 경로와 일치하지 않습니다.");
        }

        video.setStatus(RecordedVideoStatus.VERIFYING);
        String manifest;
        try {
            Optional<String> found = replayStorage.findManifest(output.bucket(), output.hlsManifestKey());
            if (found.isEmpty()) {
                markFailed(job, video, "MANIFEST_MISSING");
                return;
            }
            manifest = found.get();
            Optional<String> firstSegment = manifestProcessor.firstSegmentKey(manifest, output.hlsManifestKey());
            if (!manifest.stripLeading().startsWith("#EXTM3U")
                    || !manifest.lines().anyMatch(line -> line.strip().equals("#EXT-X-ENDLIST"))
                    || firstSegment.isEmpty()
                    || recordingStorage.head(output.bucket(), firstSegment.get()).isEmpty()) {
                markFailed(job, video, "MANIFEST_INVALID");
                return;
            }
        } catch (RuntimeException e) {
            throw new MediaTranscodeStorageUnavailableException("HLS 출력 스토리지를 확인할 수 없습니다.", e);
        }

        job.setStatus(MediaTranscodeJobStatus.SUCCEEDED);
        job.setFinishedAt(OffsetDateTime.now());
        job.setLastError(null);
        video.setOutputBucket(output.bucket());
        video.setHlsManifestKey(output.hlsManifestKey());
        video.setDurationMs(output.durationMs());
        video.setSizeBytes(output.sizeBytes());
        video.setSegmentCount(output.segmentCount());
        video.setFailureCode(null);
        video.setReadyAt(OffsetDateTime.now());
        video.setStatus(RecordedVideoStatus.READY);
    }

    private void validateEnvelope(MediaTranscodeCallbackEvent event) {
        if (event == null || event.eventId() == null || event.eventId().isBlank()
                || event.jobId() == null || event.recordedVideoId() == null
                || event.status() == null || event.status().isBlank()) {
            throw new MediaTranscodeCallbackInvalidException("callback 필수 필드가 없습니다.");
        }
    }

    private String stableFailureCode(String failureCode) {
        return STABLE_FAILURE_CODES.contains(failureCode) ? failureCode : "WORKER_INTERNAL_ERROR";
    }

    private MediaTranscodeJob requireJob(UUID jobId) {
        return jobRepository.findById(jobId)
                .orElseThrow(() -> new MediaTranscodeCallbackInvalidException("변환 작업을 찾을 수 없습니다."));
    }

    private RecordedVideo requireVideo(UUID recordedVideoId) {
        return recordedVideoRepository.findById(recordedVideoId)
                .orElseThrow(() -> new MediaTranscodeCallbackInvalidException("녹화강의 영상을 찾을 수 없습니다."));
    }

    private RecordedVideo requireVideoForUpdate(UUID recordedVideoId) {
        return recordedVideoRepository.findByIdForUpdate(recordedVideoId)
                .orElseThrow(() -> new MediaTranscodeCallbackInvalidException("녹화강의 영상을 찾을 수 없습니다."));
    }
}
