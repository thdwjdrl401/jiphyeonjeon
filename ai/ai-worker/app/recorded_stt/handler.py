from __future__ import annotations

import tempfile
from dataclasses import dataclass
from pathlib import Path

from app.recorded_stt.contracts import (
    CaptionSegment,
    ChunkResult,
    RecordedSttJob,
    parse_recorded_stt_job,
)
from app.recorded_stt.gms_whisper import (
    GmsWhisperClient,
    WhisperSegment,
    WhisperTranscriptionError,
)
from app.recorded_stt.media import FfmpegRecordedAudioProcessor, RecordedAudioError
from app.recorded_stt.spring_client import RecordedSttSpringClient, RecordedSttSpringError


class PermanentRecordedSttJobError(RuntimeError):
    """The message is invalid or a stable terminal failure was reported to Spring."""


@dataclass(slots=True)
class RecordedSttJobHandler:
    spring: RecordedSttSpringClient
    whisper: GmsWhisperClient
    media: FfmpegRecordedAudioProcessor
    model: str
    language: str
    overlap_ms: int

    async def handle(self, body: bytes) -> None:
        try:
            job = parse_recorded_stt_job(body)
        except (ValueError, TypeError) as exc:
            raise PermanentRecordedSttJobError("invalid recorded STT job envelope") from exc
        try:
            await self._execute(job)
        except (RecordedSttSpringError, WhisperTranscriptionError, RecordedAudioError) as exc:
            if exc.retryable:
                raise
            await self._report_failed(job, exc.code)
            raise PermanentRecordedSttJobError("recorded STT failed permanently") from exc

    async def _execute(self, job: RecordedSttJob) -> None:
        progress = await self.spring.progress(job.job_id)
        if progress.terminal:
            return
        completed = {chunk.chunk_index: chunk for chunk in progress.completed_chunks}
        with tempfile.TemporaryDirectory(prefix=f"recorded-stt-{job.job_id}-") as temporary:
            directory = Path(temporary)
            source = directory / "source.mp4"
            audio = directory / "audio.mp3"
            source_url = await self.spring.issue_source_url(job.job_id)
            await self.spring.download_source(source_url, source)
            probe = await self.media.probe(source)
            if not probe.has_audio:
                raise RecordedAudioError(
                    "recorded source has no audio stream",
                    code="SOURCE_AUDIO_MISSING",
                )
            await self.media.extract(source, audio)
            chunks = await self.media.chunks(audio, directory, probe.duration_ms)
            if set(completed) - {chunk.index for chunk in chunks}:
                raise RecordedAudioError(
                    "stored STT progress does not match the deterministic chunk plan",
                    code="SOURCE_NOT_READY",
                )

            segment_count = 0
            prompt_tail: str | None = None
            for chunk in chunks:
                prior = completed.get(chunk.index)
                if prior is not None:
                    if prior.source_sha256 != chunk.sha256:
                        raise RecordedAudioError(
                            "stored STT chunk checksum does not match the source",
                            code="SOURCE_NOT_READY",
                        )
                    segment_count += prior.segment_count
                    continue

                transcription = await self.whisper.transcribe(chunk.path, prompt=prompt_tail)
                segments = self._global_segments(
                    transcription.segments,
                    source_start_ms=chunk.source_start_ms,
                    source_end_ms=chunk.source_end_ms,
                    chunk_index=chunk.index,
                )
                result = ChunkResult(
                    event_id=f"stt-chunk-{job.job_id}-{chunk.index}-{chunk.sha256[:16]}",
                    source_start_ms=chunk.source_start_ms,
                    source_end_ms=chunk.source_end_ms,
                    source_sha256=chunk.sha256,
                    model=self.model,
                    language=self.language,
                    segments=segments,
                )
                await self.spring.submit_chunk(job.job_id, chunk.index, result)
                segment_count += len(segments)
                if segments:
                    prompt_tail = segments[-1].text[-500:]

            await self.spring.send_terminal(
                event_id=f"stt-terminal-{job.job_id}-succeeded",
                job_id=job.job_id,
                recorded_video_id=job.recorded_video_id,
                status="SUCCEEDED",
                output={
                    "model": self.model,
                    "language": self.language,
                    "durationMs": probe.duration_ms,
                    "chunkCount": len(chunks),
                    "segmentCount": segment_count,
                },
            )

    def _global_segments(
        self,
        segments: tuple[WhisperSegment, ...],
        *,
        source_start_ms: int,
        source_end_ms: int,
        chunk_index: int,
    ) -> tuple[CaptionSegment, ...]:
        result: list[CaptionSegment] = []
        leading_overlap_end = source_start_ms + (self.overlap_ms if chunk_index > 0 else 0)
        for local_index, segment in enumerate(segments):
            start = source_start_ms + round(segment.start * 1000)
            end = source_start_ms + round(segment.end * 1000)
            text = segment.text.strip()
            if not text:
                continue
            if start < source_start_ms or end > source_end_ms + 2_000 or end <= start:
                raise WhisperTranscriptionError(
                    "GMS segment exceeds its audio chunk",
                    code="STT_RESPONSE_INVALID",
                    retryable=False,
                )
            # Overlap ownership is deterministic: the earlier chunk owns a segment whose midpoint
            # remains inside the next chunk's leading overlap. This also works after process restart,
            # when only prior checksums/counts (not caption text) are loaded from Spring.
            if chunk_index > 0 and (start + end) // 2 < leading_overlap_end:
                continue
            result.append(
                CaptionSegment(
                    local_segment_index=local_index,
                    start_ms=start,
                    end_ms=min(end, source_end_ms),
                    text=text,
                )
            )
        return tuple(result)

    async def report_retry_exhausted(self, body: bytes) -> None:
        try:
            job = parse_recorded_stt_job(body)
        except (ValueError, TypeError):
            return
        try:
            progress = await self.spring.progress(job.job_id)
        except RecordedSttSpringError as exc:
            if exc.retryable:
                raise
            return
        if progress.terminal:
            return
        await self._report_failed(job, "RETRY_EXHAUSTED")

    async def _report_failed(self, job: RecordedSttJob, failure_code: str) -> None:
        try:
            await self.spring.send_terminal(
                event_id=f"stt-terminal-{job.job_id}-failed-{failure_code.lower()}",
                job_id=job.job_id,
                recorded_video_id=job.recorded_video_id,
                status="FAILED",
                failure_code=failure_code,
            )
        except RecordedSttSpringError as exc:
            if exc.retryable:
                raise
            raise PermanentRecordedSttJobError("Spring rejected the STT failure callback") from exc
