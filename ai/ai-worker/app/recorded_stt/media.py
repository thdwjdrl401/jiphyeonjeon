from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path


class RecordedAudioError(RuntimeError):
    def __init__(self, message: str, *, code: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True, slots=True)
class SourceProbe:
    duration_ms: int
    has_audio: bool


@dataclass(frozen=True, slots=True)
class AudioChunk:
    index: int
    source_start_ms: int
    source_end_ms: int
    path: Path
    sha256: str


class FfmpegRecordedAudioProcessor:
    def __init__(
        self,
        *,
        ffmpeg_binary: str,
        ffprobe_binary: str,
        chunk_seconds: int,
        chunk_overlap_ms: int,
        chunk_max_bytes: int,
        source_max_duration_ms: int,
    ) -> None:
        self._ffmpeg = ffmpeg_binary
        self._ffprobe = ffprobe_binary
        self._chunk_ms = chunk_seconds * 1000
        self._overlap_ms = chunk_overlap_ms
        self._chunk_max_bytes = chunk_max_bytes
        self._source_max_duration_ms = source_max_duration_ms

    async def probe(self, source: Path) -> SourceProbe:
        output = await self._run(
            self._ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type",
            "-of",
            "json",
            str(source),
            failure_code="SOURCE_NOT_READY",
        )
        try:
            payload = json.loads(output)
            duration_ms = round(float(payload["format"]["duration"]) * 1000)
            has_audio = any(stream.get("codec_type") == "audio" for stream in payload["streams"])
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise RecordedAudioError(
                "ffprobe response was invalid", code="SOURCE_NOT_READY"
            ) from exc
        if duration_ms <= 0:
            raise RecordedAudioError("recorded source duration is invalid", code="SOURCE_NOT_READY")
        if duration_ms > self._source_max_duration_ms:
            raise RecordedAudioError(
                "recorded source exceeds the duration limit",
                code="DURATION_LIMIT_EXCEEDED",
            )
        return SourceProbe(duration_ms=duration_ms, has_audio=has_audio)

    async def extract(self, source: Path, destination: Path) -> None:
        await self._run(
            self._ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-af",
            "asetpts=PTS-STARTPTS",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "64k",
            str(destination),
            failure_code="AUDIO_EXTRACTION_FAILED",
        )
        if not destination.is_file() or destination.stat().st_size == 0:
            raise RecordedAudioError("FFmpeg produced no audio", code="AUDIO_EXTRACTION_FAILED")

    async def chunks(
        self, audio: Path, directory: Path, duration_ms: int
    ) -> tuple[AudioChunk, ...]:
        spans: list[tuple[int, int]] = []
        start_ms = 0
        while start_ms < duration_ms:
            end_ms = min(duration_ms, start_ms + self._chunk_ms)
            spans.append((start_ms, end_ms))
            if end_ms == duration_ms:
                break
            start_ms = end_ms - self._overlap_ms

        completed: list[tuple[int, int, Path]] = []
        candidate = 0
        while spans:
            start_ms, end_ms = spans.pop(0)
            chunk_path = directory / f"chunk-candidate-{candidate:05d}.mp3"
            candidate += 1
            await self._run(
                self._ffmpeg,
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-ss",
                f"{start_ms / 1000:.3f}",
                "-t",
                f"{(end_ms - start_ms) / 1000:.3f}",
                "-i",
                str(audio),
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "libmp3lame",
                "-b:a",
                "64k",
                str(chunk_path),
                failure_code="AUDIO_EXTRACTION_FAILED",
            )
            size = chunk_path.stat().st_size if chunk_path.is_file() else 0
            if size == 0:
                raise RecordedAudioError(
                    "FFmpeg produced an empty chunk", code="AUDIO_EXTRACTION_FAILED"
                )
            if size > self._chunk_max_bytes:
                chunk_path.unlink(missing_ok=True)
                if end_ms - start_ms <= 60_000:
                    raise RecordedAudioError(
                        "audio chunk exceeds the hard byte limit",
                        code="AUDIO_CHUNK_TOO_LARGE",
                    )
                midpoint = start_ms + (end_ms - start_ms) // 2
                spans[0:0] = [
                    (start_ms, midpoint),
                    (max(start_ms, midpoint - self._overlap_ms), end_ms),
                ]
                continue
            completed.append((start_ms, end_ms, chunk_path))

        return tuple(
            AudioChunk(
                index=index,
                source_start_ms=start_ms,
                source_end_ms=end_ms,
                path=chunk_path,
                sha256=hashlib.sha256(chunk_path.read_bytes()).hexdigest(),
            )
            for index, (start_ms, end_ms, chunk_path) in enumerate(completed)
        )

    async def _run(self, *arguments: str, failure_code: str) -> str:
        try:
            process = await asyncio.create_subprocess_exec(
                *arguments,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _stderr = await process.communicate()
        except (OSError, asyncio.SubprocessError) as exc:
            raise RecordedAudioError("media command could not start", code=failure_code) from exc
        if process.returncode != 0:
            raise RecordedAudioError("media command failed", code=failure_code)
        return stdout.decode("utf-8")
