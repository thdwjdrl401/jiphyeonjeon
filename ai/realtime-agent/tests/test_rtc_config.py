from __future__ import annotations

import base64
import hashlib
import hmac

import pytest
from livekit import rtc

from app.livekit.rtc_config import build_turn_rtc_config


def test_empty_turn_url_keeps_livekit_default_ice_configuration() -> None:
    assert build_turn_rtc_config("", "") is None


def test_builds_relay_only_coturn_rest_credentials() -> None:
    config = build_turn_rtc_config(
        "turn:127.0.0.1:3478?transport=tcp",
        "separate-turn-secret",
        now=lambda: 1000.9,
    )

    assert config is not None
    assert config.ice_transport_type == rtc.IceTransportType.TRANSPORT_RELAY
    assert len(config.ice_servers) == 1
    server = config.ice_servers[0]
    assert server.urls == ["turn:127.0.0.1:3478?transport=tcp"]
    assert server.username == "4600:realtime-agent"
    expected = base64.b64encode(
        hmac.new(b"separate-turn-secret", server.username.encode(), hashlib.sha1).digest()
    ).decode()
    assert server.password == expected


def test_turn_url_never_falls_back_to_livekit_api_secret() -> None:
    with pytest.raises(RuntimeError, match="LIVEKIT_TURN_SECRET"):
        build_turn_rtc_config("turn:127.0.0.1:3478?transport=tcp", "")
