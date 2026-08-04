import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from app.recorded_stt.contracts import CompletedChunk, SttProgress
from app.recorded_stt.gms_whisper import WhisperResult, WhisperSegment
from app.recorded_stt.handler import PermanentRecordedSttJobError, RecordedSttJobHandler
from app.recorded_stt.media import AudioChunk, RecordedAudioError, SourceProbe

JOB_ID = UUID("80000000-0000-4000-8000-000000000001")
VIDEO_ID = UUID("50000000-0000-4000-8000-000000000001")
SHA_ZERO = "a" * 64
SHA_ONE = "b" * 64


def _body() -> bytes:
    return json.dumps(
        {
            "taskType": "RECORDED_STT",
            "jobId": str(JOB_ID),
            "recordedVideoId": str(VIDEO_ID),
            "lessonId": "10000000-0000-4000-8000-000000000001",
            "sourceAssetId": "60000000-0000-4000-8000-000000000001",
            "language": "ko",
            "contractVersion": 1,
        }
    ).encode()


async def test_resumes_completed_chunks_and_assigns_overlap_to_the_earlier_chunk() -> None:
    spring = SimpleNamespace(
        progress=AsyncMock(
            return_value=SttProgress(
                job_id=JOB_ID,
                status="RUNNING",
                terminal=False,
                completed_chunks=(
                    CompletedChunk(chunk_index=0, source_sha256=SHA_ZERO, segment_count=1),
                ),
            )
        ),
        issue_source_url=AsyncMock(return_value="http://storage/source.mp4"),
        download_source=AsyncMock(return_value=12),
        submit_chunk=AsyncMock(),
        send_terminal=AsyncMock(),
    )
    media = SimpleNamespace(
        probe=AsyncMock(return_value=SourceProbe(duration_ms=1_800_000, has_audio=True)),
        extract=AsyncMock(),
        chunks=AsyncMock(
            return_value=(
                AudioChunk(0, 0, 900_000, Path("chunk-0.mp3"), SHA_ZERO),
                AudioChunk(1, 899_000, 1_799_000, Path("chunk-1.mp3"), SHA_ONE),
            )
        ),
    )
    whisper = SimpleNamespace(
        transcribe=AsyncMock(
            return_value=WhisperResult(
                duration=900.0,
                segments=(
                    WhisperSegment(start=0.1, end=0.4, text=" overlap duplicate "),
                    WhisperSegment(start=1.5, end=3.0, text=" 새 자막 "),
                ),
            )
        )
    )
    handler = RecordedSttJobHandler(
        spring=spring,
        whisper=whisper,
        media=media,
        model="whisper-1",
        language="ko",
        overlap_ms=1000,
    )

    await handler.handle(_body())

    whisper.transcribe.assert_awaited_once_with(Path("chunk-1.mp3"), prompt=None)
    submitted = spring.submit_chunk.await_args.args[2]
    assert [segment.text for segment in submitted.segments] == ["새 자막"]
    assert submitted.segments[0].start_ms == 900_500
    terminal = spring.send_terminal.await_args.kwargs
    assert terminal["status"] == "SUCCEEDED"
    assert terminal["output"]["chunkCount"] == 2
    assert terminal["output"]["segmentCount"] == 2


async def test_reports_missing_audio_as_a_stable_failure() -> None:
    spring = SimpleNamespace(
        progress=AsyncMock(
            return_value=SttProgress(
                job_id=JOB_ID,
                status="RUNNING",
                terminal=False,
                completed_chunks=(),
            )
        ),
        issue_source_url=AsyncMock(return_value="http://storage/source.mp4"),
        download_source=AsyncMock(return_value=12),
        send_terminal=AsyncMock(),
    )
    media = SimpleNamespace(probe=AsyncMock(return_value=SourceProbe(6000, False)))
    handler = RecordedSttJobHandler(
        spring=spring,
        whisper=SimpleNamespace(),
        media=media,
        model="whisper-1",
        language="ko",
        overlap_ms=1000,
    )

    with pytest.raises(PermanentRecordedSttJobError):
        await handler.handle(_body())

    assert spring.send_terminal.await_args.kwargs["failure_code"] == "SOURCE_AUDIO_MISSING"


def test_audio_errors_expose_stable_retry_classification() -> None:
    error = RecordedAudioError("failed", code="AUDIO_EXTRACTION_FAILED")
    assert error.code == "AUDIO_EXTRACTION_FAILED"
    assert error.retryable is False
