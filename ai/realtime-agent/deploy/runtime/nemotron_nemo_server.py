from __future__ import annotations

import argparse
import asyncio
import io
import socket
import wave
from collections.abc import Callable
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

    def transcribe(self, wav_payload: bytes) -> str:
        import torch

        if self.model is None:
            raise RuntimeError("model is not ready")
        samples = _decode_pcm16_wav(wav_payload)
        with torch.inference_mode():
            results = self.model.transcribe(
                audio=samples,
                batch_size=1,
                num_workers=0,
                verbose=False,
                target_lang=self.language,
            )
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


def create_app(
    transcriber: NemoTranscriber,
    served_model: str,
    *,
    ready_replica_count: Callable[[], int] = lambda: 1,
    expected_replicas: int = 1,
) -> web.Application:
    app = web.Application(client_max_size=32 * 1024 * 1024)
    inference_lock = asyncio.Lock()

    async def live(_request: web.Request) -> web.Response:
        return web.json_response({"status": "live"})

    async def ready(_request: web.Request) -> web.Response:
        ready_replicas = ready_replica_count()
        status = (
            200 if transcriber.model is not None and ready_replicas == expected_replicas else 503
        )
        return web.json_response(
            {
                "status": "ready" if status == 200 else "notReady",
                "readyReplicaCount": ready_replicas,
                "expectedReplicaCount": expected_replicas,
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
        async with inference_lock:
            try:
                text = await asyncio.to_thread(transcriber.transcribe, audio)
            except ValueError as exc:
                raise web.HTTPBadRequest(text=str(exc)) from exc
        return web.json_response({"text": text})

    app.router.add_get("/health/live", live)
    app.router.add_get("/health/ready", ready)
    app.router.add_get("/v1/models", models)
    app.router.add_post("/v1/audio/transcriptions", transcriptions)
    return app


def _bind_server_socket(host: str, port: int, *, reuse_port: bool) -> socket.socket:
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    if reuse_port:
        server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
    server_socket.bind((host, port))
    server_socket.listen(128)
    server_socket.setblocking(False)
    return server_socket


def _count_ready_replicas(ready_dir: Path) -> int:
    return sum(1 for _ in ready_dir.glob("replica-*.ready"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--served-model", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18084)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--replica-index", type=int, default=1)
    parser.add_argument("--replicas", type=int, default=1)
    parser.add_argument("--ready-dir", type=Path)
    parser.add_argument("--reuse-port", action="store_true")
    args = parser.parse_args()
    if args.host != "127.0.0.1":
        raise SystemExit("host must be 127.0.0.1")
    if not 1 <= args.replicas <= 5:
        parser.error("--replicas must be between 1 and 5")
    if not 1 <= args.replica_index <= args.replicas:
        parser.error("--replica-index must be between 1 and --replicas")
    if args.replicas > 1 and not args.reuse_port:
        parser.error("--reuse-port is required when --replicas is greater than 1")
    ready_dir = args.ready_dir or Path("/tmp/liveclass-nemotron-nemo")
    ready_dir.mkdir(parents=True, exist_ok=True)
    ready_file = ready_dir / f"replica-{args.replica_index}.ready"
    ready_file.unlink(missing_ok=True)
    server_socket = _bind_server_socket(args.host, args.port, reuse_port=args.reuse_port)
    transcriber = NemoTranscriber(args.checkpoint, device=args.device)
    try:
        transcriber.load()
        ready_file.touch()
        app = create_app(
            transcriber,
            args.served_model,
            ready_replica_count=lambda: _count_ready_replicas(ready_dir),
            expected_replicas=args.replicas,
        )
        web.run_app(app, sock=server_socket)
    finally:
        ready_file.unlink(missing_ok=True)
        server_socket.close()


if __name__ == "__main__":
    main()
