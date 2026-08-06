"""유령 Egress 회수 중계.

왜 이게 있나
    Egress 작업은 그것을 시작한 핸들러 **프로세스**가 소유한다. 녹화 도중 egress 컨테이너가
    재시작되면 그 프로세스가 완료 보고 없이 사라지고, LiveKit은 작업을 계속 진행 중으로 들고 있다.
    StopEgress는 소유 핸들러에게 보내는 RPC라 받아 줄 상대가 없어 408로 떨어진다. LiveKit에 고아를
    회수하는 API가 없어서, 기록은 LiveKit Redis에서 직접 지우는 수밖에 없다(ADR-0082 후속).

왜 백엔드가 직접 안 하나
    LiveKit Redis는 ``--bind 127.0.0.1`` + host 네트워크라 EC2 로컬에서만 닿는다. 백엔드는 브리지
    (liveclass_default)에 있어 경로가 없다. 브리지에 레디스를 열면 인증이 없는 제어 평면이 같은
    네트워크의 모든 컨테이너에 열린다 — 남이 egress 작업을 넣을 수도 있는 자리다.

    그래서 레디스는 지금처럼 비공개로 두고 **"유령 하나 제거"라는 동사 하나만** 내보낸다.
    노출되는 것은 임의의 레디스 명령이 아니라 이 검증된 절차 하나다.

안전 장치 — 호출자를 믿지 않는다
    진행 중인 녹화의 기록을 지우면 그 녹화는 완료 보고할 곳을 잃는다. 그래서 지우기 전에
    **여기서 다시** StopEgress를 보내고, 응답이 "소유자가 없다"(deadline_exceeded)일 때만 진행한다.
    백엔드가 이미 확인했더라도 한 번 더 본다 — 위험한 조작의 판단은 그 조작을 하는 쪽에 둔다.
"""
from __future__ import annotations

import hmac
import json
import logging
import os
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import jwt
import redis
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("egress-purger")

LISTEN_PORT = int(os.environ.get("PURGE_PORT", "9107"))
REDIS_URL = os.environ.get("LIVEKIT_REDIS_URL", "redis://127.0.0.1:6379")
LIVEKIT_API = os.environ.get("LIVEKIT_API_URL", "http://127.0.0.1:7880")
CREDENTIALS_FILE = os.environ.get("LIVEKIT_CREDENTIALS_FILE", "/out/egress.yaml")
SECRET = os.environ.get("EGRESS_PURGE_SECRET", "")

# LiveKit이 만드는 egress id 형태. 임의 문자열을 레디스 키로 쓰지 않으려고 좁게 받는다.
EGRESS_ID = re.compile(r"^EG_[A-Za-z0-9]{1,32}$")


def _credential(key: str) -> str:
    """egress.yaml에서 LiveKit API 자격증명을 읽는다(값은 로그에 남기지 않는다).

    **줄 끝 주석을 잘라야 한다.** 이 파일은 ``ws_url: ws://localhost:7880  # 주석`` 처럼 값 뒤에
    설명을 다는 형식이라, 콜론 뒤를 통째로 쓰면 주석까지 값에 들어간다. 실제로 그렇게 읽어
    api_secret이 64자 대신 106자가 되었고 JWT 서명이 무효가 됐다 — 공백 앞까지만 값으로 본다.
    """
    pattern = re.compile(rf"^{re.escape(key)}:\s*(\S+)")
    with open(CREDENTIALS_FILE, encoding="utf-8") as handle:
        for line in handle:
            found = pattern.match(line)
            if found:
                return found.group(1).strip("'\"")
    raise RuntimeError(f"{CREDENTIALS_FILE} 에 {key} 가 없다")


def _api_token() -> str:
    """Egress API 호출용 단명 토큰. roomRecord 권한만 준다."""
    now = int(time.time())
    api_key, api_secret = _credential("api_key"), _credential("api_secret")
    return jwt.encode(
        {"iss": api_key, "sub": api_key, "nbf": now - 10, "exp": now + 60,
         "video": {"roomRecord": True}},
        api_secret, algorithm="HS256")


def _stop_egress(egress_id: str) -> tuple[int, str]:
    """StopEgress를 보내고 (HTTP 상태, 본문)을 돌려준다."""
    response = requests.post(
        f"{LIVEKIT_API}/twirp/livekit.Egress/StopEgress",
        headers={"Authorization": f"Bearer {_api_token()}", "Content-Type": "application/json"},
        data=json.dumps({"egress_id": egress_id}), timeout=15)
    return response.status_code, response.text


def _purge(client: redis.Redis, egress_id: str) -> dict:
    """레코드와 방 인덱스에서 지운다. 방 인덱스가 비면 키 자체를 지운다(빈 껍데기를 남기지 않는다)."""
    backup = client.hget("egress", egress_id)
    client.hdel("egress", egress_id)
    rooms = []
    for key in client.scan_iter(match="egress:room:*"):
        if client.srem(key, egress_id):
            rooms.append(key.decode())
            if client.scard(key) == 0:
                client.delete(key)
    return {"purged": True, "roomKeys": rooms, "backupBytes": len(backup or b"")}


class Handler(BaseHTTPRequestHandler):
    server_version = "egress-purger"

    def _reply(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # 기본 구현은 stderr로 요청줄을 찍는다 — 우리 로거로 모은다.
        log.info("%s", fmt % args)

    def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler 규약
        if self.path == "/health":
            self._reply(200, {"ok": True})
        else:
            self._reply(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if self.path != "/purge":
            self._reply(404, {"error": "not found"})
            return
        # 공유 시크릿. 타이밍 차이로 값을 추측당하지 않게 상수시간 비교한다.
        if not SECRET or not hmac.compare_digest(self.headers.get("X-Purge-Secret", ""), SECRET):
            self._reply(401, {"error": "unauthorized"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        try:
            egress_id = json.loads(self.rfile.read(length) or b"{}").get("egressId", "")
        except json.JSONDecodeError:
            self._reply(400, {"error": "bad json"})
            return
        if not EGRESS_ID.match(egress_id):
            self._reply(400, {"error": "egressId 형식이 아니다"})
            return

        client = redis.from_url(REDIS_URL)
        if not client.hexists("egress", egress_id):
            self._reply(404, {"error": "기록이 없다 — 이미 정리됨", "egressId": egress_id})
            return

        try:
            status, body = _stop_egress(egress_id)
        except requests.RequestException as exc:
            log.warning("StopEgress 호출 실패 %s: %s", egress_id, exc)
            self._reply(502, {"error": f"LiveKit 확인 실패: {exc}"})
            return

        # 408/deadline_exceeded = 소유 핸들러가 없다. 이때만 유령이다.
        orphaned = status == 408 or "deadline_exceeded" in body or "request timed out" in body
        if not orphaned:
            log.info("유령이 아니어서 거부 %s status=%s", egress_id, status)
            self._reply(409, {"error": "유령이 아니다 — 지우지 않는다",
                              "livekitStatus": status, "livekitBody": body[:300]})
            return

        result = _purge(client, egress_id)
        log.warning("유령 Egress 제거 %s %s", egress_id, result)
        self._reply(200, {"egressId": egress_id, **result})


if __name__ == "__main__":
    if not SECRET:
        raise SystemExit("EGRESS_PURGE_SECRET 이 없다 — 인증 없이 뜨지 않는다")
    log.info("egress-purger 기동 port=%s redis=%s livekit=%s", LISTEN_PORT, REDIS_URL, LIVEKIT_API)
    ThreadingHTTPServer(("0.0.0.0", LISTEN_PORT), Handler).serve_forever()
