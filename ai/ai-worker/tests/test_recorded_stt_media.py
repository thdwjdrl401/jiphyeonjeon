from pathlib import Path

import pytest

from app.recorded_stt.media import FfmpegRecordedAudioProcessor, RecordedAudioError


def _processor(**overrides: int) -> FfmpegRecordedAudioProcessor:
    return FfmpegRecordedAudioProcessor(
        ffmpeg_binary="ffmpeg",
        ffprobe_binary="ffprobe",
        chunk_seconds=overrides.get("chunk_seconds", 900),
        chunk_overlap_ms=overrides.get("chunk_overlap_ms", 1000),
        chunk_max_bytes=overrides.get("chunk_max_bytes", 24 * 1024 * 1024),
        source_max_duration_ms=overrides.get("source_max_duration_ms", 6 * 60 * 60 * 1000),
    )


async def test_probe_rejects_a_source_over_six_hours(monkeypatch) -> None:
    processor = _processor(source_max_duration_ms=21_600_000)

    async def fake_run(*_arguments: str, failure_code: str) -> str:
        assert failure_code == "SOURCE_NOT_READY"
        return '{"format":{"duration":"21601.0"},"streams":[{"codec_type":"audio"}]}'

    monkeypatch.setattr(processor, "_run", fake_run)

    with pytest.raises(RecordedAudioError) as captured:
        await processor.probe(Path("source.mp4"))

    assert captured.value.code == "DURATION_LIMIT_EXCEEDED"


async def test_oversized_chunk_is_split_until_every_file_is_below_the_hard_limit(
    monkeypatch, tmp_path
) -> None:
    processor = _processor(chunk_seconds=120, chunk_max_bytes=5)

    async def fake_run(*arguments: str, failure_code: str) -> str:
        assert failure_code == "AUDIO_EXTRACTION_FAILED"
        duration = float(arguments[arguments.index("-t") + 1])
        output = Path(arguments[-1])
        output.write_bytes(b"large!" if duration > 60 else b"safe")
        return ""

    monkeypatch.setattr(processor, "_run", fake_run)
    chunks = await processor.chunks(tmp_path / "audio.mp3", tmp_path, 240_000)

    assert chunks[0].source_start_ms == 0
    assert chunks[-1].source_end_ms == 240_000
    assert all(chunk.path.stat().st_size <= 5 for chunk in chunks)
    assert all(
        0 <= chunks[index - 1].source_end_ms - chunks[index].source_start_ms <= 1000
        for index in range(1, len(chunks))
    )
