package com.liveclass.video.service;

import com.liveclass.asset.api.AssetDirectory;
import com.liveclass.asset.api.AssetRef;
import com.liveclass.asset.api.AssetUploadException;
import com.liveclass.asset.api.AssetUploadManagement;
import com.liveclass.video.api.RecordedLessonView;
import com.liveclass.video.api.RecordedProcessingView;
import com.liveclass.video.api.RecordedUploadTicket;
import com.liveclass.video.api.RecordedVideoConflictException;
import com.liveclass.video.api.RecordedVideoDisabledException;
import com.liveclass.video.api.RecordedVideoForbiddenException;
import com.liveclass.video.api.RecordedVideoInvalidException;
import com.liveclass.video.api.RecordedVideoManagement;
import com.liveclass.video.api.RecordedVideoNotFoundException;
import com.liveclass.video.domain.MediaTranscodeJob;
import com.liveclass.video.domain.MediaTranscodeJobStatus;
import com.liveclass.video.domain.RecordedVideo;
import com.liveclass.video.domain.RecordedVideoStatus;
import com.liveclass.video.repository.MediaTranscodeJobRepository;
import com.liveclass.video.repository.RecordedVideoRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 업로드 녹화강의의 원본 연결과 처리 상태를 소유한다. 강사·커리큘럼 소유권은 curriculum facade가
 * 검증하고, 이 서비스는 lessonId 이하의 미디어 불변식만 다룬다.
 */
@Service
public class RecordedVideoService implements RecordedVideoManagement {

    private static final List<MediaTranscodeJobStatus> ACTIVE_JOB_STATUSES = List.of(
            MediaTranscodeJobStatus.PENDING,
            MediaTranscodeJobStatus.DISPATCHED,
            MediaTranscodeJobStatus.RUNNING);

    private final RecordedVideoRepository recordedVideoRepository;
    private final MediaTranscodeJobRepository jobRepository;
    private final AssetUploadManagement assetUploadManagement;
    private final AssetDirectory assetDirectory;
    private final boolean enabled;

    public RecordedVideoService(RecordedVideoRepository recordedVideoRepository,
                                MediaTranscodeJobRepository jobRepository,
                                AssetUploadManagement assetUploadManagement,
                                AssetDirectory assetDirectory,
                                @Value("${recorded.video.enabled:true}") boolean enabled) {
        this.recordedVideoRepository = recordedVideoRepository;
        this.jobRepository = jobRepository;
        this.assetUploadManagement = assetUploadManagement;
        this.assetDirectory = assetDirectory;
        this.enabled = enabled;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<RecordedLessonView> findByClientRequestId(UUID clientRequestId) {
        return recordedVideoRepository.findByClientRequestId(clientRequestId).map(this::toLessonView);
    }

    @Override
    @Transactional
    public RecordedLessonView register(UUID lessonId, UUID clientRequestId) {
        requireEnabled();
        Optional<RecordedVideo> existing = recordedVideoRepository.findByClientRequestId(clientRequestId);
        if (existing.isPresent()) {
            return toLessonView(existing.get());
        }
        RecordedVideo video = new RecordedVideo();
        video.setLessonId(lessonId);
        video.setClientRequestId(clientRequestId);
        video.setStatus(RecordedVideoStatus.AWAITING_UPLOAD);
        return toLessonView(recordedVideoRepository.save(video));
    }

    @Override
    @Transactional
    public RecordedUploadTicket issueUpload(UUID lessonId, UUID uploaderId,
                                            String fileName, String contentType, long fileSize) {
        requireEnabled();
        RecordedVideo video = requireByLesson(lessonId);
        if (video.getStatus() != RecordedVideoStatus.AWAITING_UPLOAD) {
            throw new RecordedVideoConflictException(
                    "RECORDED_VIDEO_UPLOAD_CONFLICT", "업로드를 새로 시작할 수 없는 처리 상태입니다.");
        }
        AssetUploadManagement.UploadTicket ticket;
        try {
            if (video.getSourceAssetId() != null) {
                assetUploadManagement.abandonPendingRecordedVideoSource(video.getSourceAssetId(), uploaderId);
            }
            ticket = assetUploadManagement.createRecordedVideoSource(
                    fileName, contentType, fileSize, uploaderId);
        } catch (AssetUploadException e) {
            throw switch (e.reason()) {
                case INVALID -> new RecordedVideoInvalidException("RECORDED_VIDEO_INVALID", e.getMessage());
                case FORBIDDEN -> new RecordedVideoForbiddenException(e.getMessage());
                case NOT_FOUND, STATE_CONFLICT -> new RecordedVideoConflictException(
                        "RECORDED_VIDEO_UPLOAD_CONFLICT", e.getMessage());
            };
        }
        video.setSourceAssetId(ticket.assetId());
        return new RecordedUploadTicket(
                ticket.assetId(), ticket.uploadUrl(), ticket.method(), ticket.headers(), ticket.expiresAt());
    }

    @Override
    @Transactional
    public RecordedProcessingView completeUpload(UUID lessonId, UUID assetId, UUID requesterId) {
        requireEnabled();
        RecordedVideo video = requireByLesson(lessonId);
        if (!assetId.equals(video.getSourceAssetId())) {
            throw new RecordedVideoConflictException(
                    "RECORDED_VIDEO_SOURCE_STALE", "현재 녹화강의에 연결된 원본 영상이 아닙니다.");
        }

        if (video.getStatus() != RecordedVideoStatus.AWAITING_UPLOAD) {
            return findCurrentJob(video)
                    .map(job -> toProcessing(video, job.getId()))
                    .orElseThrow(() -> new RecordedVideoConflictException(
                            "RECORDED_VIDEO_UPLOAD_CONFLICT", "이미 접수된 업로드입니다."));
        }

        try {
            AssetRef source = assetUploadManagement.completeRecordedVideoSource(assetId, requesterId);
            if (!"UPLOADED".equals(source.status())) {
                throw new RecordedVideoConflictException(
                        "RECORDED_VIDEO_UPLOAD_NOT_FOUND", "업로드한 MP4 객체를 확인할 수 없습니다.");
            }
        } catch (AssetUploadException e) {
            switch (e.reason()) {
                case NOT_FOUND, STATE_CONFLICT -> throw new RecordedVideoConflictException(
                        "RECORDED_VIDEO_UPLOAD_NOT_FOUND", e.getMessage());
                case INVALID -> throw new RecordedVideoInvalidException("RECORDED_VIDEO_INVALID", e.getMessage());
                case FORBIDDEN -> throw new RecordedVideoForbiddenException(e.getMessage());
            }
        }

        video.setStatus(RecordedVideoStatus.QUEUED);
        video.setFailureCode(null);
        MediaTranscodeJob job = createJob(video, 1);
        return toProcessing(video, job.getId());
    }

    @Override
    @Transactional(readOnly = true)
    public RecordedProcessingView processing(UUID lessonId) {
        RecordedVideo video = requireByLesson(lessonId);
        UUID jobId = jobRepository.findTopByRecordedVideoIdOrderByAttemptNoDesc(video.getId())
                .map(MediaTranscodeJob::getId)
                .orElse(null);
        return toProcessing(video, jobId);
    }

    @Override
    @Transactional
    public RecordedProcessingView retry(UUID lessonId) {
        requireEnabled();
        RecordedVideo video = requireByLesson(lessonId);
        if (video.getStatus() != RecordedVideoStatus.FAILED) {
            throw new RecordedVideoConflictException(
                    "RECORDED_VIDEO_RETRY_CONFLICT", "실패한 녹화강의만 다시 처리할 수 있습니다.");
        }
        AssetRef source = assetDirectory.find(video.getSourceAssetId()).orElseThrow(() ->
                new RecordedVideoConflictException(
                        "RECORDED_VIDEO_SOURCE_NOT_READY", "다시 처리할 원본 MP4가 없습니다."));
        if (!"RECORDED_VIDEO_SOURCE".equals(source.kind()) || !"UPLOADED".equals(source.status())) {
            throw new RecordedVideoConflictException(
                    "RECORDED_VIDEO_SOURCE_NOT_READY", "원본 MP4를 다시 업로드해야 합니다.");
        }
        int nextAttempt = jobRepository.findTopByRecordedVideoIdOrderByAttemptNoDesc(video.getId())
                .map(job -> job.getAttemptNo() + 1)
                .orElse(1);
        video.setStatus(RecordedVideoStatus.QUEUED);
        video.setFailureCode(null);
        MediaTranscodeJob job = createJob(video, nextAttempt);
        return toProcessing(video, job.getId());
    }

    private MediaTranscodeJob createJob(RecordedVideo video, int attemptNo) {
        MediaTranscodeJob job = new MediaTranscodeJob();
        job.setRecordedVideoId(video.getId());
        job.setAttemptNo(attemptNo);
        job.setStatus(MediaTranscodeJobStatus.PENDING);
        job.setIdempotencyKey("recorded-video:%s:attempt:%d".formatted(video.getId(), attemptNo));
        job.setPublishAttemptCount(0);
        job.setNextPublishAt(OffsetDateTime.now());
        return jobRepository.save(job);
    }

    private Optional<MediaTranscodeJob> findCurrentJob(RecordedVideo video) {
        return jobRepository.findFirstByRecordedVideoIdAndStatusInOrderByAttemptNoDesc(
                video.getId(), ACTIVE_JOB_STATUSES)
                .or(() -> jobRepository.findTopByRecordedVideoIdOrderByAttemptNoDesc(video.getId()));
    }

    private RecordedVideo requireByLesson(UUID lessonId) {
        return recordedVideoRepository.findByLessonId(lessonId)
                .orElseThrow(() -> new RecordedVideoNotFoundException("녹화강의 영상을 찾을 수 없습니다."));
    }

    private void requireEnabled() {
        if (!enabled) {
            throw new RecordedVideoDisabledException("녹화강의 업로드 기능이 비활성화되어 있습니다.");
        }
    }

    private RecordedLessonView toLessonView(RecordedVideo video) {
        return new RecordedLessonView(
                video.getLessonId(), video.getId(), video.getClientRequestId(), video.getStatus().name());
    }

    private RecordedProcessingView toProcessing(RecordedVideo video, UUID jobId) {
        return new RecordedProcessingView(
                video.getLessonId(), video.getId(), jobId, video.getStatus().name(),
                video.getFailureCode(), video.getDurationMs(), video.getSizeBytes(), video.getReadyAt());
    }
}
