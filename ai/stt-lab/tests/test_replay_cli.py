from __future__ import annotations

import argparse
import asyncio
import wave
from pathlib import Path

import numpy as np
import pytest
from app.audio.segmentation import SpeechSegment
from app.stt.engine import AudioChunk, StreamingSttEngine
from app.stt.providers.segmented import SpeechSegmenter

from stt_lab.audio import PcmAudio
from stt_lab.contracts import EvaluationClip
from stt_lab.replay_backends import BackendMetadata, FinalOnlySegmentedEngine
from stt_lab.replay_cli import CandidateSpec, _parse_candidate, evaluate_candidates
from stt_lab.runners import Transcription


class WholeClipSegmenter:
    def __init__(self) -> None:
        self._pcm = bytearray()
        self._end_ms = 0

    def push(self, chunk: AudioChunk) -> list[SpeechSegment]:
        self._pcm.extend(chunk.pcm)
        self._end_ms = chunk.stream_elapsed_ms
        return []

    def finish(self) -> list[SpeechSegment]:
        return [SpeechSegment(bytes(self._pcm), 16_000, 0, self._end_ms, "STREAM_END")]


class NamedTranscriber:
    precision = "float32"

    def __init__(self, model_id: str) -> None:
        self.model_id = model_id

    def load(self) -> None:
        return None

    def transcribe(self, audio: PcmAudio, language: str) -> Transcription:
        assert audio.duration_ms == 40
        assert language == "ko-KR"
        return Transcription(self.model_id, first_delta_ms=1.0, total_ms=1.0)

    def close(self) -> None:
        return None


class FakeSlot:
    def __init__(self, backend: str, model_id: str, precision: str) -> None:
        self._metadata = BackendMetadata(backend, model_id, precision, "SEGMENT_FINAL_ONLY")
        self._transcriber = NamedTranscriber(model_id)
        self.loaded = False
        self.closed = False

    @property
    def metadata(self) -> BackendMetadata:
        return self._metadata

    def load(self) -> None:
        self.loaded = True

    def create_engine(self, segmenter: SpeechSegmenter) -> StreamingSttEngine:
        assert self.loaded
        return FinalOnlySegmentedEngine(
            provider=self._metadata.backend,
            transcriber=self._transcriber,
            segmenter=segmenter,
        )

    def close(self) -> None:
        self.closed = True


def _write_wav(path: Path, value: int) -> None:
    samples = np.full(640, value, dtype="<i2")
    with wave.open(str(path), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(16_000)
        target.writeframes(samples.tobytes())


def _clips(tmp_path: Path) -> tuple[EvaluationClip, ...]:
    clips = []
    for index in range(2):
        audio_path = tmp_path / f"clip-{index}.wav"
        _write_wav(audio_path, index + 1)
        clips.append(
            EvaluationClip(
                clip_id=f"clip-{index}",
                audio_path=audio_path,
                reference="model alpha",
                language="ko-KR",
                speaker_id=f"speaker-{index}",
                split="dev",
                terms=(),
                consent="internal-evaluation",
            )
        )
    return tuple(clips)


def test_candidates_share_one_segment_plan_and_use_requested_worker_slots(tmp_path: Path) -> None:
    created: list[FakeSlot] = []

    def build_slot(
        backend: str,
        model_id: str,
        language: str,
        device: str,
        precision: str,
    ) -> FakeSlot:
        assert language == "ko-KR"
        assert device == "cpu"
        slot = FakeSlot(backend, model_id, precision)
        created.append(slot)
        return slot

    report = asyncio.run(
        evaluate_candidates(
            [
                CandidateSpec("alpha", "whisper", "model alpha"),
                CandidateSpec("beta", "whisper", "model beta"),
            ],
            _clips(tmp_path),
            mode="accuracy",
            workers=2,
            language="ko-KR",
            device="cpu",
            precision="float32",
            slot_builder=build_slot,
            segmenter_factory=WholeClipSegmenter,
        )
    )

    assert report["workers"] == 2
    assert [candidate["name"] for candidate in report["candidates"]] == ["alpha", "beta"]
    first_hashes = [clip["segmentPlanSha256"] for clip in report["candidates"][0]["clips"]]
    second_hashes = [clip["segmentPlanSha256"] for clip in report["candidates"][1]["clips"]]
    assert first_hashes == second_hashes
    assert all(candidate["workerSlots"] == 2 for candidate in report["candidates"])
    assert len(created) == 4
    assert all(slot.loaded and slot.closed for slot in created)


def test_workers_are_bounded_before_loading_models(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="between 1 and 12"):
        asyncio.run(
            evaluate_candidates(
                [CandidateSpec("candidate", "whisper", "model")],
                _clips(tmp_path),
                mode="accuracy",
                workers=13,
                language="ko-KR",
                device="cpu",
                precision="float32",
            )
        )


def test_candidate_parser_requires_explicit_backend_and_model() -> None:
    assert _parse_candidate("base=whisper@openai/whisper-large-v3") == CandidateSpec(
        "base", "whisper", "openai/whisper-large-v3"
    )
    assert _parse_candidate("server=vllm@liveclass-whisper-large-v3") == CandidateSpec(
        "server", "vllm", "liveclass-whisper-large-v3"
    )
    with pytest.raises(argparse.ArgumentTypeError, match="NAME=BACKEND@MODEL"):
        _parse_candidate("whisper-large-v3")
    with pytest.raises(argparse.ArgumentTypeError, match="nemotron, whisper, or vllm"):
        _parse_candidate("base=unknown@model")
