from __future__ import annotations

import argparse
import asyncio
import io
import wave
from collections.abc import Sequence
from contextlib import nullcontext
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from aiohttp import web


@dataclass(slots=True)
class NemoTranscriber:
    checkpoint: Path
    device: str = "cuda"
    language: str = "ko-KR"
    model: object | None = None
    stream: object | None = None

    def load(self) -> None:
        import torch
        from nemo.collections.asr.models import ASRModel

        model = ASRModel.restore_from(restore_path=str(self.checkpoint), map_location="cpu")
        if not hasattr(model, "set_inference_prompt"):
            raise TypeError("checkpoint is not a prompt-conditioned RNNT model")
        model.set_inference_prompt(self.language)
        if hasattr(model, "decoding") and hasattr(model.decoding, "set_strip_lang_tags"):
            model.decoding.set_strip_lang_tags(True)
        model.to(device=self.device, dtype=torch.float32)
        model.eval()
        self.model = model
        if self.device.startswith("cuda"):
            self.stream = torch.cuda.Stream(device=self.device)

    def transcribe(self, wav_payload: bytes) -> str:
        import torch

        if self.model is None:
            raise RuntimeError("model is not ready")
        samples = _decode_pcm16_wav(wav_payload)
        stream_context = (
            torch.cuda.stream(self.stream) if self.stream is not None else nullcontext()
        )
        with torch.inference_mode(), stream_context:
            results = self.model.transcribe(
                audio=samples,
                batch_size=1,
                num_workers=0,
                verbose=False,
                target_lang=self.language,
            )
        if self.stream is not None:
            self.stream.synchronize()
        result = results[0]
        return (result.text if hasattr(result, "text") else str(result)).strip()


def _decode_pcm16_wav(payload: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(payload), "rb") as source:
        if (
            source.getnchannels() != 1
            or source.getsampwidth() != 2
            or source.getframerate() != 16_000
        ):
            raise ValueError("audio must be mono PCM16 WAV at 16 kHz")
        pcm = source.readframes(source.getnframes())
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


class NemoTranscriberPool:
    def __init__(self, transcribers: Sequence[NemoTranscriber]) -> None:
        if not transcribers:
            raise ValueError("at least one transcriber replica is required")
        self._transcribers = tuple(transcribers)
        self._available: asyncio.Queue[NemoTranscriber] = asyncio.Queue(
            maxsize=len(self._transcribers)
        )
        for transcriber in self._transcribers:
            self._available.put_nowait(transcriber)

    @property
    def replica_count(self) -> int:
        return len(self._transcribers)

    @property
    def ready_replica_count(self) -> int:
        return sum(transcriber.model is not None for transcriber in self._transcribers)

    async def transcribe(self, wav_payload: bytes) -> str:
        transcriber = await self._available.get()
        try:
            return await asyncio.to_thread(transcriber.transcribe, wav_payload)
        finally:
            self._available.put_nowait(transcriber)


def create_app(pool: NemoTranscriberPool, served_model: str) -> web.Application:
    app = web.Application(client_max_size=32 * 1024 * 1024)

    async def live(_request: web.Request) -> web.Response:
        return web.json_response({"status": "live"})

    async def ready(_request: web.Request) -> web.Response:
        ready_replicas = pool.ready_replica_count
        status = 200 if ready_replicas == pool.replica_count else 503
        return web.json_response(
            {
                "status": "ready" if status == 200 else "notReady",
                "readyReplicaCount": ready_replicas,
                "expectedReplicaCount": pool.replica_count,
            },
            status=status,
        )

    async def models(_request: web.Request) -> web.Response:
        return web.json_response({"object": "list", "data": [{"id": served_model}]})

    async def transcriptions(request: web.Request) -> web.Response:
        reader = await request.multipart()
        model_name = ""
        audio = b""
        while part := await reader.next():
            if part.name == "model":
                model_name = await part.text()
            elif part.name == "file":
                audio = await part.read(decode=False)
        if model_name != served_model:
            raise web.HTTPBadRequest(text="unknown model")
        if not audio:
            raise web.HTTPBadRequest(text="audio file is required")
        try:
            text = await pool.transcribe(audio)
        except ValueError as exc:
            raise web.HTTPBadRequest(text=str(exc)) from exc
        return web.json_response({"text": text})

    app.router.add_get("/health/live", live)
    app.router.add_get("/health/ready", ready)
    app.router.add_get("/v1/models", models)
    app.router.add_post("/v1/audio/transcriptions", transcriptions)
    return app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--served-model", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18084)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--replicas", type=int, default=1)
    args = parser.parse_args()
    if args.host != "127.0.0.1":
        raise SystemExit("host must be 127.0.0.1")
    if not 1 <= args.replicas <= 12:
        parser.error("--replicas must be between 1 and 12")
    transcribers = [
        NemoTranscriber(args.checkpoint, device=args.device) for _ in range(args.replicas)
    ]
    for transcriber in transcribers:
        transcriber.load()
    pool = NemoTranscriberPool(transcribers)
    web.run_app(create_app(pool, args.served_model), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
