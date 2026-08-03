from __future__ import annotations

import json
import wave
from pathlib import Path

from stt_lab.aihub import AihubSample, assign_group_disjoint_splits, prepare_aihub_dataset


def _write_wav(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(16_000)
        target.writeframes(b"\x00\x00" * 16_000)


def _write_annotation(
    path: Path,
    *,
    key: str,
    speaker_id: str,
    lecture_id: str,
    text: str = "(software)/(소프트웨어)를 확인합니다.",
    source_key: str | None = None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    value = {
        "01_dataset": {
            "3_src_path": f"source/{source_key or key}.wav",
            "5_category": "eng",
            "9_speech_length": "1.0",
        },
        "02_srcinfo": {"1_id": lecture_id},
        "03_lectureinfo": {"3_major_category": "comp"},
        "05_speakerinfo": {"1_id": speaker_id},
        "06_transcription": {"1_text": text},
    }
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def _sample(clip_id: str, speaker_id: str, lecture_id: str) -> AihubSample:
    return AihubSample(
        clip_id=clip_id,
        audio_path=Path(f"/audio/{clip_id}.wav"),
        annotation_path=Path(f"/labels/{clip_id}.json"),
        reference="정답",
        speaker_id=speaker_id,
        lecture_id=lecture_id,
        category="eng/comp",
        duration_ms=1_000,
        sha256=None,
    )


def test_prepare_matches_relative_paths_even_when_roots_have_arbitrary_names(
    tmp_path: Path,
) -> None:
    json_root = tmp_path / "folder-named-audio"
    wav_root = tmp_path / "folder-named-annotations"
    key = "eng/comp/C00001/U00001"
    annotation = json_root / f"{key}.json"
    audio = wav_root / f"{key}.wav"
    _write_annotation(
        annotation,
        key=key,
        speaker_id="S00001",
        lecture_id="C00001",
    )
    _write_wav(audio)

    report = prepare_aihub_dataset(
        json_root=json_root,
        wav_root=wav_root,
        output_root=tmp_path / "output",
        seed=20260803,
        hash_audio=True,
        golden_minutes=0.01,
    )

    assert report["validSamples"] == 1
    source_records = [
        json.loads(line)
        for line in (tmp_path / "output/manifests/source-index.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert source_records[0]["speakerId"] == "S00001"
    assert source_records[0]["reference"] == "(software)/(소프트웨어)를 확인합니다."
    assert source_records[0]["trainingReference"] == "software를 확인합니다."
    assert source_records[0]["lectureId"] == "C00001"
    assert source_records[0]["audioPath"] == str(audio.resolve())
    assert source_records[0]["sampleRateHz"] == 16_000
    assert source_records[0]["channels"] == 1
    assert source_records[0]["sampleWidthBytes"] == 2
    assert source_records[0]["audioDurationMs"] == 1_000
    assert source_records[0]["durationMs"] == 1_000
    assert source_records[0]["lectureId"] == "C00001"
    assert source_records[0]["category"] == "eng/comp"
    assert len(source_records[0]["sha256"]) == 64
    audit = json.loads((tmp_path / "output/reports/audit.json").read_text(encoding="utf-8"))
    assert audit["dualTranscriptionSampleCount"] == 1


def test_prepare_accepts_dataset_category_prefix_omitted_from_extracted_root(
    tmp_path: Path,
) -> None:
    json_root = tmp_path / "annotations"
    wav_root = tmp_path / "audio"
    key = "arch/C01748/U00000"
    annotation = json_root / f"{key}.json"
    audio = wav_root / f"{key}.wav"
    _write_annotation(
        annotation,
        key=key,
        source_key=f"eng/{key}",
        speaker_id="S00224",
        lecture_id="C01748",
    )
    _write_wav(audio)

    report = prepare_aihub_dataset(
        json_root=json_root,
        wav_root=wav_root,
        output_root=tmp_path / "output",
        seed=20260803,
        hash_audio=False,
        golden_minutes=0.01,
    )

    assert report["validSamples"] == 1
    record = json.loads(
        (tmp_path / "output/manifests/source-index.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()[0]
    )
    assert record["id"] == "arch.C01748.U00000"
    assert record["category"] == "eng/comp"


def test_split_keeps_connected_speakers_and_lectures_together() -> None:
    samples = (
        _sample("a", "speaker-1", "lecture-1"),
        _sample("b", "speaker-1", "lecture-2"),
        _sample("c", "speaker-2", "lecture-2"),
        _sample("d", "speaker-3", "lecture-3"),
        _sample("e", "speaker-4", "lecture-4"),
        _sample("f", "speaker-5", "lecture-5"),
    )

    assignments = assign_group_disjoint_splits(samples, seed=7)

    assert assignments["a"] == assignments["b"] == assignments["c"]
    for split in ("train", "dev", "test"):
        split_samples = [sample for sample in samples if assignments[sample.clip_id] == split]
        other_samples = [sample for sample in samples if assignments[sample.clip_id] != split]
        assert {sample.speaker_id for sample in split_samples}.isdisjoint(
            sample.speaker_id for sample in other_samples
        )
        assert {sample.lecture_id for sample in split_samples}.isdisjoint(
            sample.lecture_id for sample in other_samples
        )


def test_split_assigns_at_least_eight_speakers_to_each_holdout_when_available() -> None:
    samples = tuple(
        _sample(
            f"clip-{index:02d}",
            f"speaker-{index:02d}",
            f"lecture-{index:02d}",
        )
        for index in range(27)
    )

    assignments = assign_group_disjoint_splits(samples, seed=7)

    for split in ("dev", "test"):
        speakers = {sample.speaker_id for sample in samples if assignments[sample.clip_id] == split}
        assert len(speakers) >= 8


def test_prepare_reports_incomplete_upload_pairs(tmp_path: Path) -> None:
    json_root = tmp_path / "json"
    wav_root = tmp_path / "wav"
    key = "eng/comp/C00001/U00001"
    _write_annotation(
        json_root / f"{key}.json",
        key=key,
        speaker_id="S00001",
        lecture_id="C00001",
    )
    wav_root.mkdir()
    _write_wav(wav_root / ".ipynb_checkpoints/U00001-checkpoint.wav")

    report = prepare_aihub_dataset(
        json_root=json_root,
        wav_root=wav_root,
        output_root=tmp_path / "output",
        seed=1,
        hash_audio=False,
        golden_minutes=3,
    )

    assert report["status"] == "incomplete"
    assert any("no matching WAV" in warning for warning in report["warnings"])
    assert not any("no matching JSON" in warning for warning in report["warnings"])
