import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from app.recorded_stt.contracts import CompletedChunk, SttProgress
from app.recorded_stt.caption_cues import CaptionCueAssembler
from app.recorded_stt.handler import PermanentRecordedSttJobError, RecordedSttJobHandler
from app.recorded_stt.media import AudioChunk, RecordedAudioError, SourceProbe
from app.recorded_stt.openai_whisper import WhisperResult, WhisperSegment, WhisperWord
from app.recorded_stt.transcription_normalizer import normalize_transcription

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
                text="중복 새 자막입니다. 다음 문장입니다.",
                words=(
                    WhisperWord(start=0.1, end=0.4, word=" 중복 "),
                    WhisperWord(start=1.5, end=1.9, word=" 새"),
                    WhisperWord(start=2.0, end=2.4, word=" 자막입니다."),
                    WhisperWord(start=2.6, end=3.0, word=" 다음"),
                    WhisperWord(start=3.1, end=3.5, word=" 문장입니다."),
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
        cue_assembler=CaptionCueAssembler(),
    )

    await handler.handle(_body())

    whisper.transcribe.assert_awaited_once_with(Path("chunk-1.mp3"), prompt=None)
    submitted = spring.submit_chunk.await_args.args[2]
    assert [segment.text for segment in submitted.segments] == [
        "새 자막입니다.",
        "다음 문장입니다.",
    ]
    assert submitted.segments[0].start_ms == 900_500
    terminal = spring.send_terminal.await_args.kwargs
    assert terminal["status"] == "SUCCEEDED"
    assert terminal["output"]["chunkCount"] == 2
    assert terminal["output"]["segmentCount"] == 3


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
        cue_assembler=CaptionCueAssembler(),
    )

    with pytest.raises(PermanentRecordedSttJobError):
        await handler.handle(_body())

    assert spring.send_terminal.await_args.kwargs["failure_code"] == "SOURCE_AUDIO_MISSING"


def test_reproduced_zero_duration_word_produces_timed_segment_captions() -> None:
    handler = RecordedSttJobHandler(
        spring=SimpleNamespace(),
        whisper=SimpleNamespace(),
        media=SimpleNamespace(),
        model="whisper-1",
        language="ko",
        overlap_ms=1000,
        cue_assembler=CaptionCueAssembler(),
    )
    transcription = normalize_transcription(
        WhisperResult(
            duration=13.65,
            text=(
                "안녕하세요. 이 영상은 테스트 영상입니다. "
                "자막이 잘 생성되는지 확인하기 위한 테스트용 영상입니다. 감사합니다."
            ),
            segments=(
                WhisperSegment(start=0.0, end=2.02, text="안녕하세요."),
                WhisperSegment(start=2.96, end=4.86, text="이 영상은 테스트 영상입니다."),
                WhisperSegment(
                    start=5.74,
                    end=9.4,
                    text="자막이 잘 생성되는지 확인하기 위한 테스트용 영상입니다.",
                ),
                WhisperSegment(start=11.24, end=11.56, text="감사합니다."),
            ),
            words=(
                WhisperWord(start=0.0, end=2.02, word="안녕하세요"),
                WhisperWord(start=2.96, end=2.96, word="이"),
                WhisperWord(start=2.96, end=3.6, word="영상은"),
                WhisperWord(start=3.6, end=3.86, word="테스트"),
                WhisperWord(start=3.86, end=4.86, word="영상입니다"),
                WhisperWord(start=5.74, end=5.96, word="자막이"),
                WhisperWord(start=5.96, end=6.24, word="잘"),
                WhisperWord(start=6.24, end=6.96, word="생성되는지"),
                WhisperWord(start=6.96, end=7.7, word="확인하기"),
                WhisperWord(start=7.7, end=8.04, word="위한"),
                WhisperWord(start=8.04, end=8.72, word="테스트용"),
                WhisperWord(start=8.72, end=9.4, word="영상입니다"),
                WhisperWord(start=11.24, end=11.56, word="감사합니다"),
            ),
        )
    )

    segments = handler._global_cues(
        transcription,
        source_start_ms=0,
        source_end_ms=13_664,
        chunk_index=0,
    )

    assert [(segment.start_ms, segment.end_ms, segment.text) for segment in segments] == [
        (0, 2020, "안녕하세요."),
        (2960, 4860, "이 영상은 테스트 영상입니다."),
        (5740, 9400, "자막이 잘 생성되는지 확인하기 위한 테스트용 영상입니다."),
        (11240, 11560, "감사합니다."),
    ]


def test_audio_errors_expose_stable_retry_classification() -> None:
    error = RecordedAudioError("failed", code="AUDIO_EXTRACTION_FAILED")
    assert error.code == "AUDIO_EXTRACTION_FAILED"
    assert error.retryable is False
