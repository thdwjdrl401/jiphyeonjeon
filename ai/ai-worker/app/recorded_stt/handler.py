from __future__ import annotations

import logging
import tempfile
from dataclasses import dataclass
from pathlib import Path

from app.recorded_stt.contracts import (
    CaptionSegment,
    ChunkResult,
    RecordedSttJob,
    parse_recorded_stt_job,
)
from app.recorded_stt.caption_cues import CaptionCueAssembler
from app.recorded_stt.media import FfmpegRecordedAudioProcessor, RecordedAudioError
from app.recorded_stt.openai_whisper import (
    OpenAIWhisperClient,
    WhisperTranscriptionError,
)
from app.recorded_stt.spring_client import RecordedSttSpringClient, RecordedSttSpringError
from app.recorded_stt.transcription_normalizer import (
    NormalizedTranscription,
    normalize_transcription,
)

logger = logging.getLogger(__name__)


class PermanentRecordedSttJobError(RuntimeError):
    """The message is invalid or a stable terminal failure was reported to Spring."""


@dataclass(slots=True)
class RecordedSttJobHandler:
    spring: RecordedSttSpringClient
    whisper: OpenAIWhisperClient
    media: FfmpegRecordedAudioProcessor
    model: str
    language: str
    overlap_ms: int
    cue_assembler: CaptionCueAssembler

    async def handle(self, body: bytes) -> None:
        try:
            job = parse_recorded_stt_job(body)
        except (ValueError, TypeError) as exc:
            raise PermanentRecordedSttJobError("invalid recorded STT job envelope") from exc
        try:
            await self._execute(job)
        except (RecordedSttSpringError, WhisperTranscriptionError, RecordedAudioError) as exc:
            if isinstance(exc, WhisperTranscriptionError) and exc.reason:
                logger.warning(
                    "recorded STT transcription response rejected",
                    extra={
                        "event": "recorded_stt.response_rejected",
                        "job_id": job.job_id,
                        "error_code": exc.code,
                        "error_reason": exc.reason,
                    },
                )
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

                provider_result = await self.whisper.transcribe(chunk.path, prompt=prompt_tail)
                transcription = normalize_transcription(provider_result)
                stats = transcription.stats
                logger.info(
                    "recorded STT transcription response normalized",
                    extra={
                        "event": "recorded_stt.response_normalized",
                        "job_id": job.job_id,
                        "segment_count": stats.raw_segment_count,
                        "word_count": stats.raw_word_count,
                        "invalid_segment_count": stats.invalid_segment_count,
                        "zero_duration_word_count": stats.zero_duration_word_count,
                        "merged_word_count": stats.merged_word_count,
                        "discarded_word_count": stats.discarded_word_count,
                        "fallback_mode": stats.fallback_mode,
                    },
                )
                segments = self._global_cues(
                    transcription,
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
                if transcription.text.strip():
                    prompt_tail = transcription.text.strip()[-500:]

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

    def _global_cues(
        self,
        transcription: NormalizedTranscription,
        *,
        source_start_ms: int,
        source_end_ms: int,
        chunk_index: int,
    ) -> tuple[CaptionSegment, ...]:
        overlap_end_seconds = self.overlap_ms / 1000 if chunk_index > 0 else 0.0
        accepted_words = tuple(
            word
            for word in transcription.words
            if (word.start + word.end) / 2 >= overlap_end_seconds
        )
        if chunk_index == 0:
            accepted_segments = transcription.segments
        elif accepted_words:
            # A segment crossing the leading overlap may contain text already owned by the prior
            # chunk. Drop that provider segment and let its accepted words become word-only cues.
            accepted_segments = tuple(
                segment
                for segment in transcription.segments
                if segment.start >= overlap_end_seconds
            )
        else:
            accepted_segments = tuple(
                segment
                for segment in transcription.segments
                if (segment.start + segment.end) / 2 >= overlap_end_seconds
            )

        owned = NormalizedTranscription(
            duration=transcription.duration,
            text=transcription.text,
            segments=accepted_segments,
            words=accepted_words,
            stats=transcription.stats,
        )
        cues = self.cue_assembler.assemble_transcription(owned)

        result: list[CaptionSegment] = []
        previous_end = source_start_ms
        for cue in cues:
            start = source_start_ms + round(cue.start_seconds * 1000)
            end = source_start_ms + round(cue.end_seconds * 1000)
            if start < source_start_ms or end > source_end_ms + 2_000:
                raise WhisperTranscriptionError(
                    "OpenAI caption timestamp exceeds its audio chunk",
                    code="STT_RESPONSE_INVALID",
                    retryable=False,
                    reason="CUE_TIMESTAMP_OUT_OF_RANGE",
                )
            start = max(start, previous_end)
            end = min(end, source_end_ms)
            text = cue.text.strip()
            if not text or end <= start:
                continue
            result.append(
                CaptionSegment(
                    local_segment_index=len(result),
                    start_ms=start,
                    end_ms=end,
                    text=text,
                )
            )
            previous_end = end
        if (accepted_segments or accepted_words) and transcription.text.strip() and not result:
            raise WhisperTranscriptionError(
                "OpenAI transcription produced no valid caption cues",
                code="STT_RESPONSE_INVALID",
                retryable=False,
                reason="CUES_EMPTY_AFTER_NORMALIZATION",
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
