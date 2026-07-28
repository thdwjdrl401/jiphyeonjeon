from __future__ import annotations

import base64
import hashlib
import hmac
import time
from collections.abc import Callable

from livekit import rtc


def build_turn_rtc_config(
    turn_url: str,
    shared_secret: str,
    *,
    credential_ttl_seconds: int = 3600,
    identity: str = "realtime-agent",
    now: Callable[[], float] = time.time,
) -> rtc.RtcConfiguration | None:
    """Build relay-only ICE configuration using coturn REST credentials."""
    if not turn_url:
        return None
    if not shared_secret.strip():
        raise RuntimeError("LIVEKIT_TURN_SECRET is required when LIVEKIT_TURN_URL is set")
    username = f"{int(now()) + credential_ttl_seconds}:{identity}"
    password = base64.b64encode(
        hmac.new(shared_secret.encode("utf-8"), username.encode("utf-8"), hashlib.sha1).digest()
    ).decode("ascii")
    server = rtc.IceServer(urls=[turn_url], username=username, password=password)
    return rtc.RtcConfiguration(
        ice_transport_type=rtc.IceTransportType.TRANSPORT_RELAY,
        ice_servers=[server],
    )
