from __future__ import annotations

import hashlib
import hmac
import json
import logging
import mimetypes
import os
import subprocess
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import boto3
import pika
import requests


logging.basicConfig(
    level=os.getenv("MEDIA_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("media-worker")


@dataclass(frozen=True)
class Config:
    rabbitmq_url: str
    backend_url: str
    source_secret: bytes
    callback_secret: bytes
    output_endpoint: str
    output_access_key: str
    output_secret_key: str
    output_bucket: str
    output_region: str
    max_source_bytes: int
    max_duration_seconds: int
    segment_seconds: int

    @staticmethod
    def from_env() -> "Config":
        return Config(
            rabbitmq_url=_required("MEDIA_RABBITMQ_URL"),
            backend_url=_required("MEDIA_BACKEND_URL").rstrip("/"),
            source_secret=_required("MEDIA_SOURCE_SECRET").encode(),
            callback_secret=_required("MEDIA_CALLBACK_SECRET").encode(),
            output_endpoint=_required("MEDIA_OUTPUT_ENDPOINT"),
            output_access_key=_required("MEDIA_OUTPUT_ACCESS_KEY"),
            output_secret_key=_required("MEDIA_OUTPUT_SECRET_KEY"),
            output_bucket=os.getenv("MEDIA_OUTPUT_BUCKET", "recordings"),
            output_region=os.getenv("MEDIA_OUTPUT_REGION", "us-east-1"),
            max_source_bytes=int(os.getenv("MEDIA_MAX_SOURCE_BYTES", str(5 * 1024**3))),
            max_duration_seconds=int(os.getenv("MEDIA_MAX_DURATION_SECONDS", str(6 * 60 * 60))),
            segment_seconds=int(os.getenv("MEDIA_HLS_SEGMENT_SECONDS", "6")),
        )


class WorkerFailure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class BackendClient:
    def __init__(self, config: Config):
        self.config = config
        self.session = requests.Session()

    def source_url(self, job_id: str) -> str:
        body = b""
        response = self.session.post(
            f"{self.config.backend_url}/api/internal/media/transcode-jobs/{job_id}/source-url",
            data=body,
            headers={"X-Signature": _signature(self.config.source_secret, body)},
            timeout=15,
        )
        if response.status_code != 200:
            raise WorkerFailure("SOURCE_DOWNLOAD_FAILED", f"source URL 발급 실패: {response.status_code}")
        url = response.json().get("url")
        if not url:
            raise WorkerFailure("SOURCE_DOWNLOAD_FAILED", "source URL 응답이 비어 있습니다")
        return str(url)

    def callback(
        self,
        message: dict[str, Any],
        status: str,
        *,
        output: dict[str, Any] | None = None,
        failure_code: str | None = None,
    ) -> None:
        event = {
            "eventId": f"media-{uuid.uuid4()}",
            "jobId": message["jobId"],
            "recordedVideoId": message["recordedVideoId"],
            "status": status,
            "output": output,
            "failureCode": failure_code,
        }
        body = json.dumps(event, separators=(",", ":"), ensure_ascii=False).encode()
        signature = _signature(self.config.callback_secret, body)
        last_error: Exception | None = None
        for attempt in range(1, 6):
            try:
                response = self.session.post(
                    f"{self.config.backend_url}/api/internal/media/transcode-callbacks",
                    data=body,
                    headers={"Content-Type": "application/json", "X-Signature": signature},
                    timeout=20,
                )
                if 200 <= response.status_code < 300:
                    return
                if response.status_code < 500:
                    raise WorkerFailure("WORKER_INTERNAL_ERROR", f"callback 거절: {response.status_code}")
                last_error = RuntimeError(f"callback 일시 실패: {response.status_code}")
            except requests.RequestException as exc:
                last_error = exc
            time.sleep(min(16, 2 ** (attempt - 1)))
        raise WorkerFailure("WORKER_INTERNAL_ERROR", f"callback 재시도 소진: {last_error}")


class MediaWorker:
    def __init__(self, config: Config):
        self.config = config
        self.backend = BackendClient(config)
        self.s3 = boto3.client(
            "s3",
            endpoint_url=config.output_endpoint,
            aws_access_key_id=config.output_access_key,
            aws_secret_access_key=config.output_secret_key,
            region_name=config.output_region,
        )

    def run(self) -> None:
        parameters = pika.URLParameters(self.config.rabbitmq_url)
        parameters.heartbeat = 60
        parameters.blocked_connection_timeout = 60
        connection = pika.BlockingConnection(parameters)
        channel = connection.channel()
        channel.queue_declare(queue="media.transcode.dlq", durable=True)
        channel.queue_declare(
            queue="media.transcode",
            durable=True,
            arguments={
                "x-dead-letter-exchange": "",
                "x-dead-letter-routing-key": "media.transcode.dlq",
            },
        )
        channel.basic_qos(prefetch_count=1)
        channel.basic_consume(queue="media.transcode", on_message_callback=self._consume)
        log.info("media.transcode 소비 시작")
        channel.start_consuming()

    def _consume(self, channel: Any, method: Any, _properties: Any, body: bytes) -> None:
        message: dict[str, Any] | None = None
        try:
            message = json.loads(body)
            self._validate_message(message)
            self._process(message)
            channel.basic_ack(delivery_tag=method.delivery_tag)
        except WorkerFailure as exc:
            log.error("변환 실패 code=%s message=%s", exc.code, exc)
            if message is None:
                channel.basic_reject(delivery_tag=method.delivery_tag, requeue=False)
                return
            try:
                self.backend.callback(message, "FAILED", failure_code=exc.code)
                channel.basic_ack(delivery_tag=method.delivery_tag)
            except WorkerFailure:
                log.exception("실패 callback 전송 실패 — 메시지 재큐잉")
                channel.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
        except Exception:
            log.exception("예상하지 못한 worker 오류")
            if message is None:
                channel.basic_reject(delivery_tag=method.delivery_tag, requeue=False)
                return
            try:
                self.backend.callback(message, "FAILED", failure_code="WORKER_INTERNAL_ERROR")
                channel.basic_ack(delivery_tag=method.delivery_tag)
            except WorkerFailure:
                channel.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

    def _process(self, message: dict[str, Any]) -> None:
        self.backend.callback(message, "RUNNING")
        with tempfile.TemporaryDirectory(prefix=f"media-{message['jobId']}-") as temp:
            workdir = Path(temp)
            source = workdir / "source.mp4"
            output_dir = workdir / "hls"
            output_dir.mkdir()

            self._download(self.backend.source_url(message["jobId"]), source)
            probe = self._probe(source)
            duration_ms = round(float(probe["format"]["duration"]) * 1000)
            if duration_ms <= 0:
                raise WorkerFailure("SOURCE_INVALID", "영상 길이가 올바르지 않습니다")
            if duration_ms > self.config.max_duration_seconds * 1000:
                raise WorkerFailure("DURATION_LIMIT_EXCEEDED", "영상 길이 제한을 초과했습니다")

            self._transcode(source, output_dir, probe)
            manifest = output_dir / "index.m3u8"
            segments = sorted(output_dir.glob("segment-*.ts"))
            if not manifest.exists() or not segments or "#EXT-X-ENDLIST" not in manifest.read_text():
                raise WorkerFailure("FFMPEG_FAILED", "완성된 HLS 재생목록을 만들지 못했습니다")

            size_bytes = self._upload_outputs(message["outputPrefix"], output_dir, manifest)
            self.backend.callback(
                message,
                "SUCCEEDED",
                output={
                    "bucket": self.config.output_bucket,
                    "hlsManifestKey": f"{message['outputPrefix']}/index.m3u8",
                    "durationMs": duration_ms,
                    "sizeBytes": size_bytes,
                    "segmentCount": len(segments),
                },
            )
            log.info("변환 완료 jobId=%s segments=%d", message["jobId"], len(segments))

    def _download(self, url: str, target: Path) -> None:
        try:
            with requests.get(url, stream=True, timeout=(10, 300)) as response:
                response.raise_for_status()
                written = 0
                with target.open("wb") as file:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if not chunk:
                            continue
                        written += len(chunk)
                        if written > self.config.max_source_bytes:
                            raise WorkerFailure("SOURCE_TOO_LARGE", "원본 MP4 크기 제한을 초과했습니다")
                        file.write(chunk)
        except WorkerFailure:
            raise
        except requests.RequestException as exc:
            raise WorkerFailure("SOURCE_DOWNLOAD_FAILED", str(exc)) from exc

    def _probe(self, source: Path) -> dict[str, Any]:
        command = [
            "ffprobe", "-v", "error", "-print_format", "json",
            "-show_format", "-show_streams", str(source),
        ]
        try:
            result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=120)
            probe = json.loads(result.stdout)
        except (subprocess.SubprocessError, json.JSONDecodeError) as exc:
            raise WorkerFailure("FFPROBE_FAILED", "ffprobe 검증에 실패했습니다") from exc
        streams = probe.get("streams", [])
        if not any(stream.get("codec_type") == "video" for stream in streams):
            raise WorkerFailure("SOURCE_INVALID", "video stream이 없는 MP4입니다")
        try:
            float(probe["format"]["duration"])
        except (KeyError, TypeError, ValueError) as exc:
            raise WorkerFailure("SOURCE_INVALID", "영상 길이를 확인할 수 없습니다") from exc
        return probe

    def _transcode(self, source: Path, output_dir: Path, probe: dict[str, Any]) -> None:
        streams = probe["streams"]
        video = next(stream for stream in streams if stream.get("codec_type") == "video")
        audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
        compatible = video.get("codec_name") == "h264" and (audio is None or audio.get("codec_name") == "aac")

        if compatible:
            try:
                self._run_ffmpeg(source, output_dir, copy_codecs=True)
                return
            except WorkerFailure:
                log.info("remux 실패 — transcode fallback")
                for path in output_dir.iterdir():
                    path.unlink()
        self._run_ffmpeg(source, output_dir, copy_codecs=False)

    def _run_ffmpeg(self, source: Path, output_dir: Path, *, copy_codecs: bool) -> None:
        segment_pattern = output_dir / "segment-%06d.ts"
        manifest = output_dir / "index.m3u8"
        command = ["ffmpeg", "-y", "-v", "error", "-i", str(source), "-map", "0:v:0", "-map", "0:a:0?"]
        if copy_codecs:
            command += ["-c", "copy"]
        else:
            command += [
                "-c:v", "libx264", "-profile:v", "main", "-preset", "veryfast", "-crf", "23",
                "-force_key_frames", f"expr:gte(t,n_forced*{self.config.segment_seconds})",
                "-c:a", "aac", "-b:a", "128k",
            ]
        command += [
            "-f", "hls",
            "-hls_time", str(self.config.segment_seconds),
            "-hls_playlist_type", "vod",
            "-hls_segment_filename", str(segment_pattern),
            str(manifest),
        ]
        try:
            subprocess.run(command, check=True, capture_output=True, timeout=self.config.max_duration_seconds * 2)
        except subprocess.SubprocessError as exc:
            raise WorkerFailure("FFMPEG_FAILED", "FFmpeg HLS 변환에 실패했습니다") from exc

    def _upload_outputs(self, prefix: str, output_dir: Path, manifest: Path) -> int:
        files = sorted(path for path in output_dir.iterdir() if path != manifest)
        files.append(manifest)  # 부분 업로드가 완료로 보이지 않도록 manifest를 반드시 마지막에 쓴다.
        total = 0
        try:
            for path in files:
                content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                if path.suffix == ".m3u8":
                    content_type = "application/vnd.apple.mpegurl"
                self.s3.upload_file(
                    str(path), self.config.output_bucket, f"{prefix}/{path.name}",
                    ExtraArgs={"ContentType": content_type},
                )
                total += path.stat().st_size
        except Exception as exc:
            raise WorkerFailure("OUTPUT_UPLOAD_FAILED", "HLS 산출물 업로드에 실패했습니다") from exc
        return total

    def _validate_message(self, message: dict[str, Any]) -> None:
        required = ("jobId", "recordedVideoId", "lessonId", "sourceAssetId", "outputPrefix")
        if message.get("taskType") != "MP4_TO_HLS" or message.get("contractVersion") != 1:
            raise WorkerFailure("SOURCE_INVALID", "지원하지 않는 작업 계약입니다")
        if any(not message.get(field) for field in required):
            raise WorkerFailure("SOURCE_INVALID", "작업 메시지 필수 필드가 없습니다")
        expected_prefix = f"recorded/{message['recordedVideoId']}"
        if message["outputPrefix"] != expected_prefix:
            raise WorkerFailure("SOURCE_INVALID", "출력 prefix가 recordedVideoId와 일치하지 않습니다")


def _required(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise RuntimeError(f"필수 환경변수가 없습니다: {name}")
    return value.strip()


def _signature(secret: bytes, body: bytes) -> str:
    import base64

    return base64.b64encode(hmac.new(secret, body, hashlib.sha256).digest()).decode()


if __name__ == "__main__":
    config = Config.from_env()
    worker = MediaWorker(config)
    while True:
        try:
            worker.run()
        except KeyboardInterrupt:
            raise
        except Exception:
            log.exception("worker 연결 종료 — 5초 후 재연결")
            time.sleep(5)
