package com.liveclass.video.service;

import com.liveclass.asset.api.AssetDirectory;
import com.liveclass.asset.api.AssetRef;
import com.liveclass.video.domain.RecordedCaptionPublicationStatus;
import com.liveclass.video.domain.RecordedCaptionSegment;
import com.liveclass.video.domain.RecordedCaptionStatus;
import com.liveclass.video.domain.RecordedCaptionTrack;
import com.liveclass.video.domain.RecordedSttChunk;
import com.liveclass.video.domain.RecordedSttJob;
import com.liveclass.video.domain.RecordedSttJobStatus;
import com.liveclass.video.domain.RecordedVideo;
import com.liveclass.video.repository.RecordedCaptionSegmentRepository;
import com.liveclass.video.repository.RecordedCaptionTrackRepository;
import com.liveclass.video.repository.RecordedSttChunkRepository;
import com.liveclass.video.repository.RecordedSttJobRepository;
import com.liveclass.video.repository.RecordedVideoRepository;
import com.liveclass.video.web.dto.RecordedSttCallbackEvent;
import com.liveclass.video.web.dto.RecordedSttChunkRequest;
import com.liveclass.video.web.dto.RecordedSttProgressResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
public class RecordedSttInternalService {

    private static final Set<String> STABLE_FAILURE_CODES = Set.of(
            "SOURCE_NOT_READY", "SOURCE_DOWNLOAD_FAILED", "SOURCE_TOO_LARGE",
            "DURATION_LIMIT_EXCEEDED",
            "SOURCE_AUDIO_MISSING", "AUDIO_EXTRACTION_FAILED", "AUDIO_CHUNK_TOO_LARGE",
            "STT_MODEL_UNAVAILABLE", "STT_PROVIDER_UNAVAILABLE", "STT_RESPONSE_INVALID",
            "WORKER_INTERNAL_ERROR", "RETRY_EXHAUSTED");
    private static final int MAX_SEGMENTS_PER_CHUNK = 5_000;

    private final RecordedSttJobRepository jobRepository;
    private final RecordedVideoRepository videoRepository;
    private final RecordedCaptionTrackRepository trackRepository;
    private final RecordedSttChunkRepository chunkRepository;
    private final RecordedCaptionSegmentRepository segmentRepository;
    private final AssetDirectory assetDirectory;
    private final RecordedSttCallbackInbox callbackInbox;

    public RecordedSttInternalService(RecordedSttJobRepository jobRepository,
                                      RecordedVideoRepository videoRepository,
                                      RecordedCaptionTrackRepository trackRepository,
                                      RecordedSttChunkRepository chunkRepository,
                                      RecordedCaptionSegmentRepository segmentRepository,
                                      AssetDirectory assetDirectory,
                                      RecordedSttCallbackInbox callbackInbox) {
        this.jobRepository = jobRepository;
        this.videoRepository = videoRepository;
        this.trackRepository = trackRepository;
        this.chunkRepository = chunkRepository;
        this.segmentRepository = segmentRepository;
        this.assetDirectory = assetDirectory;
        this.callbackInbox = callbackInbox;
    }

    @Transactional(readOnly = true)
    public String issueSourceUrl(UUID jobId) {
        RecordedSttJob job = requireRunnableJob(jobId);
        RecordedVideo video = requireVideo(job.getRecordedVideoId());
        if (!video.getSourceAssetId().equals(job.getSourceAssetId())) {
            throw invalid("RECORDED_STT_SOURCE_INVALID", "작업과 녹화강의의 원본이 일치하지 않습니다.");
        }
        AssetRef source = assetDirectory.find(job.getSourceAssetId()).orElseThrow(() ->
                invalid("RECORDED_STT_SOURCE_NOT_READY", "녹화강의 원본을 찾을 수 없습니다."));
        if (!"RECORDED_VIDEO_SOURCE".equals(source.kind()) || !"UPLOADED".equals(source.status())) {
            throw invalid("RECORDED_STT_SOURCE_NOT_READY", "녹화강의 원본이 준비되지 않았습니다.");
        }
        return assetDirectory.resolveUrl(job.getSourceAssetId()).orElseThrow(() ->
                invalid("RECORDED_STT_SOURCE_NOT_READY", "녹화강의 원본 URL을 발급할 수 없습니다."));
    }

    @Transactional
    public RecordedSttProgressResponse progress(UUID jobId) {
        RecordedSttJob job = requireJob(jobId);
        if (job.getStatus() == RecordedSttJobStatus.PENDING
                || job.getStatus() == RecordedSttJobStatus.DISPATCHED) {
            job.setStatus(RecordedSttJobStatus.RUNNING);
            if (job.getStartedAt() == null) {
                job.setStartedAt(OffsetDateTime.now());
            }
            RecordedCaptionTrack track = requireTrack(job.getRecordedVideoId());
            track.setStatus(RecordedCaptionStatus.PROCESSING);
            if (track.getStartedAt() == null) {
                track.setStartedAt(OffsetDateTime.now());
            }
        }
        List<RecordedSttProgressResponse.CompletedChunk> completed = chunkRepository
                .findByJobIdOrderByChunkIndex(jobId).stream()
                .map(chunk -> new RecordedSttProgressResponse.CompletedChunk(
                        chunk.getChunkIndex(), chunk.getSourceSha256(), chunk.getSegmentCount()))
                .toList();
        RecordedCaptionTrack track = requireTrack(job.getRecordedVideoId());
        return new RecordedSttProgressResponse(
                job.getId(), job.getStatus().name(), isTerminal(job.getStatus()),
                track.getDurationMs(), completed);
    }

    @Transactional
    public void acceptChunk(UUID jobId, int chunkIndex, RecordedSttChunkRequest request, byte[] rawBody) {
        RecordedSttJob job = requireRunnableJob(jobId);
        validateChunk(job, chunkIndex, request);
        String payloadSha256 = sha256(rawBody);
        RecordedSttChunk existing = chunkRepository.findByJobIdAndChunkIndex(jobId, chunkIndex).orElse(null);
        if (existing != null) {
            if (existing.getPayloadSha256().equals(payloadSha256)
                    && existing.getSourceSha256().equals(request.sourceSha256())) {
                return;
            }
            throw conflict("RECORDED_STT_CHUNK_CONFLICT", "같은 chunkIndex에 다른 결과가 이미 저장됐습니다.");
        }
        if (!callbackInbox.tryReceive(request.eventId(), "RECORDED_STT_CHUNK", jobId.toString(),
                new String(rawBody, StandardCharsets.UTF_8))) {
            throw conflict("RECORDED_STT_EVENT_CONFLICT", "이미 사용된 STT eventId입니다.");
        }

        RecordedCaptionTrack track = requireTrack(job.getRecordedVideoId());
        RecordedSttChunk chunk = new RecordedSttChunk();
        chunk.setJobId(jobId);
        chunk.setChunkIndex(chunkIndex);
        chunk.setSourceStartMs(request.sourceStartMs());
        chunk.setSourceEndMs(request.sourceEndMs());
        chunk.setSourceSha256(request.sourceSha256());
        chunk.setPayloadSha256(payloadSha256);
        chunk.setSegmentCount(request.segments().size());
        chunk.setReceivedAt(OffsetDateTime.now());
        chunkRepository.save(chunk);

        for (RecordedSttChunkRequest.Segment input : request.segments()) {
            RecordedCaptionSegment segment = new RecordedCaptionSegment();
            segment.setTrackId(track.getId());
            segment.setJobId(jobId);
            segment.setChunkIndex(chunkIndex);
            segment.setLocalSegmentIndex(input.localSegmentIndex());
            segment.setStartMs(input.startMs());
            segment.setEndMs(input.endMs());
            segment.setText(input.text().strip());
            segmentRepository.save(segment);
        }
        job.setStatus(RecordedSttJobStatus.RUNNING);
        job.setProcessedChunkCount(Math.toIntExact(chunkRepository.countByJobId(jobId)));
        if (job.getStartedAt() == null) {
            job.setStartedAt(OffsetDateTime.now());
        }
        track.setStatus(RecordedCaptionStatus.PROCESSING);
        callbackInbox.markProcessed(request.eventId());
    }

    @Transactional
    public void handleTerminal(RecordedSttCallbackEvent event, String rawJson) {
        validateTerminalEnvelope(event);
        if (!callbackInbox.tryReceive(event.eventId(), "RECORDED_STT_" + event.status(),
                event.jobId().toString(), rawJson)) {
            return;
        }
        RecordedSttJob job = requireJob(event.jobId());
        RecordedVideo video = requireVideo(event.recordedVideoId());
        if (!job.getRecordedVideoId().equals(video.getId())) {
            throw invalid("RECORDED_STT_CALLBACK_INVALID", "job과 recordedVideo가 일치하지 않습니다.");
        }
        if (isTerminal(job.getStatus())) {
            callbackInbox.markProcessed(event.eventId());
            return;
        }
        RecordedCaptionTrack track = requireTrack(video.getId());
        switch (event.status()) {
            case "SUCCEEDED" -> markSucceeded(job, track, event.output());
            case "FAILED" -> markFailed(job, track, stableFailureCode(event.failureCode()));
            default -> throw invalid("RECORDED_STT_CALLBACK_INVALID", "지원하지 않는 terminal 상태입니다.");
        }
        callbackInbox.markProcessed(event.eventId());
    }

    private void markSucceeded(RecordedSttJob job, RecordedCaptionTrack track,
                               RecordedSttCallbackEvent.Output output) {
        if (output == null || !job.getModel().equals(output.model())
                || !job.getLanguage().equals(output.language())
                || output.durationMs() == null || output.durationMs() <= 0
                || output.chunkCount() == null || output.chunkCount() <= 0
                || output.segmentCount() == null || output.segmentCount() < 0) {
            throw invalid("RECORDED_STT_CALLBACK_INVALID", "성공 callback 출력이 올바르지 않습니다.");
        }
        List<RecordedSttChunk> chunks = chunkRepository.findByJobIdOrderByChunkIndex(job.getId());
        if (chunks.size() != output.chunkCount()) {
            throw conflict("RECORDED_STT_CHUNKS_INCOMPLETE", "완료되지 않은 STT 청크가 있습니다.");
        }
        for (int index = 0; index < chunks.size(); index++) {
            RecordedSttChunk chunk = chunks.get(index);
            if (chunk.getChunkIndex() != index || chunk.getSourceEndMs() > output.durationMs() + 2_000) {
                throw conflict("RECORDED_STT_CHUNKS_INCOMPLETE", "STT 청크 범위가 원본과 일치하지 않습니다.");
            }
            if (index == 0 && chunk.getSourceStartMs() != 0) {
                throw conflict("RECORDED_STT_CHUNKS_INCOMPLETE", "첫 STT 청크가 원본 시작점을 포함하지 않습니다.");
            }
            if (index > 0) {
                RecordedSttChunk previous = chunks.get(index - 1);
                long overlapMs = previous.getSourceEndMs() - chunk.getSourceStartMs();
                if (overlapMs < 0 || overlapMs > 10_000) {
                    throw conflict("RECORDED_STT_CHUNKS_INCOMPLETE", "STT 청크 사이에 누락 또는 과도한 중첩이 있습니다.");
                }
            }
        }
        if (Math.abs(chunks.getLast().getSourceEndMs() - output.durationMs()) > 2_000) {
            throw conflict("RECORDED_STT_CHUNKS_INCOMPLETE", "마지막 STT 청크가 원본 끝점을 포함하지 않습니다.");
        }
        long actualSegments = segmentRepository.countByJobId(job.getId());
        if (actualSegments != output.segmentCount()) {
            throw conflict("RECORDED_STT_SEGMENT_COUNT_MISMATCH", "자막 segment 수가 일치하지 않습니다.");
        }
        OffsetDateTime now = OffsetDateTime.now();
        job.setStatus(RecordedSttJobStatus.SUCCEEDED);
        job.setTotalChunkCount(output.chunkCount());
        job.setProcessedChunkCount(output.chunkCount());
        job.setFailureCode(null);
        job.setLastError(null);
        job.setFinishedAt(now);

        track.setStatus(actualSegments == 0 ? RecordedCaptionStatus.EMPTY : RecordedCaptionStatus.READY);
        track.setPublicationStatus(RecordedCaptionPublicationStatus.DRAFT);
        track.setActiveJobId(job.getId());
        track.setModel(output.model());
        track.setLanguage(output.language());
        track.setDurationMs(output.durationMs());
        track.setSegmentCount(Math.toIntExact(actualSegments));
        track.setFailureCode(null);
        track.setReadyAt(now);
    }

    private void markFailed(RecordedSttJob job, RecordedCaptionTrack track, String failureCode) {
        OffsetDateTime now = OffsetDateTime.now();
        job.setStatus(RecordedSttJobStatus.FAILED);
        job.setFailureCode(failureCode);
        job.setLastError(failureCode);
        job.setFinishedAt(now);
        track.setStatus(RecordedCaptionStatus.FAILED);
        track.setPublicationStatus(RecordedCaptionPublicationStatus.NOT_AVAILABLE);
        track.setFailureCode(failureCode);
        track.setReadyAt(null);
    }

    private void validateChunk(RecordedSttJob job, int chunkIndex, RecordedSttChunkRequest request) {
        if (chunkIndex < 0 || request == null || request.eventId() == null || request.eventId().isBlank()
                || request.sourceStartMs() == null || request.sourceStartMs() < 0
                || request.sourceEndMs() == null || request.sourceEndMs() <= request.sourceStartMs()
                || request.sourceSha256() == null || !request.sourceSha256().matches("[0-9a-f]{64}")
                || !job.getModel().equals(request.model()) || !job.getLanguage().equals(request.language())
                || request.segments() == null || request.segments().size() > MAX_SEGMENTS_PER_CHUNK) {
            throw invalid("RECORDED_STT_CHUNK_INVALID", "STT 청크 필드가 올바르지 않습니다.");
        }
        Set<Integer> indexes = new java.util.HashSet<>();
        for (RecordedSttChunkRequest.Segment segment : request.segments()) {
            if (segment == null || segment.localSegmentIndex() == null || segment.localSegmentIndex() < 0
                    || !indexes.add(segment.localSegmentIndex())
                    || segment.startMs() == null || segment.startMs() < request.sourceStartMs()
                    || segment.endMs() == null || segment.endMs() <= segment.startMs()
                    || segment.endMs() > request.sourceEndMs() + 2_000
                    || segment.text() == null || segment.text().isBlank()
                    || segment.text().length() > 4_000) {
                throw invalid("RECORDED_STT_CHUNK_INVALID", "STT segment가 올바르지 않습니다.");
            }
        }
    }

    private void validateTerminalEnvelope(RecordedSttCallbackEvent event) {
        if (event == null || event.eventId() == null || event.eventId().isBlank()
                || event.jobId() == null || event.recordedVideoId() == null
                || event.status() == null || event.status().isBlank()) {
            throw invalid("RECORDED_STT_CALLBACK_INVALID", "terminal callback 필수 필드가 없습니다.");
        }
    }

    private RecordedSttJob requireRunnableJob(UUID jobId) {
        RecordedSttJob job = requireJob(jobId);
        if (job.getStatus() != RecordedSttJobStatus.PENDING
                && job.getStatus() != RecordedSttJobStatus.DISPATCHED
                && job.getStatus() != RecordedSttJobStatus.RUNNING) {
            throw invalid("RECORDED_STT_JOB_NOT_RUNNABLE", "실행할 수 없는 STT 작업 상태입니다.");
        }
        return job;
    }

    private RecordedSttJob requireJob(UUID jobId) {
        return jobRepository.findById(jobId).orElseThrow(() ->
                invalid("RECORDED_STT_JOB_NOT_FOUND", "STT 작업을 찾을 수 없습니다."));
    }

    private RecordedVideo requireVideo(UUID videoId) {
        return videoRepository.findById(videoId).orElseThrow(() ->
                invalid("RECORDED_STT_VIDEO_NOT_FOUND", "녹화강의 영상을 찾을 수 없습니다."));
    }

    private RecordedCaptionTrack requireTrack(UUID videoId) {
        return trackRepository.findByRecordedVideoId(videoId).orElseThrow(() ->
                invalid("RECORDED_STT_TRACK_NOT_FOUND", "녹화강의 자막 트랙을 찾을 수 없습니다."));
    }

    private String stableFailureCode(String failureCode) {
        return failureCode != null && STABLE_FAILURE_CODES.contains(failureCode)
                ? failureCode
                : "WORKER_INTERNAL_ERROR";
    }

    private boolean isTerminal(RecordedSttJobStatus status) {
        return status == RecordedSttJobStatus.SUCCEEDED || status == RecordedSttJobStatus.FAILED;
    }

    private String sha256(byte[] body) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body));
        } catch (Exception e) {
            throw new IllegalStateException("STT payload checksum 계산 실패", e);
        }
    }

    private RecordedSttContractException invalid(String code, String message) {
        return new RecordedSttContractException(code, message, false);
    }

    private RecordedSttContractException conflict(String code, String message) {
        return new RecordedSttContractException(code, message, true);
    }
}
