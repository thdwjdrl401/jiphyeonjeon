from __future__ import annotations

from types import SimpleNamespace

import pytest
from livekit import rtc

from scripts.monitor_caption_stream import format_entry
from scripts.monitor_caption_stream import parse_args as parse_monitor_args
from scripts.probe_livekit_room import ProbeSettings, format_room_snapshot


def test_probe_settings_reject_missing_credentials_without_exposing_values() -> None:
    with pytest.raises(RuntimeError, match="LIVEKIT_TOKEN") as error:
        ProbeSettings.from_values("wss://livekit.example", "")
    assert "wss://livekit.example" not in str(error.value)


def test_probe_snapshot_reports_only_microphone_state() -> None:
    microphone = SimpleNamespace(
        sid="TR_audio",
        name="mic",
        kind=SimpleNamespace(name="KIND_AUDIO"),
        source=rtc.TrackSource.SOURCE_MICROPHONE,
        muted=False,
    )
    camera = SimpleNamespace(
        sid="TR_video",
        name="camera",
        kind=SimpleNamespace(name="KIND_VIDEO"),
        source=rtc.TrackSource.SOURCE_CAMERA,
        muted=False,
    )
    room = SimpleNamespace(
        name="session-1",
        local_participant=SimpleNamespace(identity="probe"),
        remote_participants={
            "teacher": SimpleNamespace(
                identity="teacher", track_publications={"a": microphone, "v": camera}
            )
        },
    )

    snapshot = format_room_snapshot(room)

    assert "TR_audio" in snapshot
    assert "TR_video" not in snapshot
    assert "token" not in snapshot.lower()


def test_caption_formatter_preserves_utf8_and_completion() -> None:
    assert format_entry("1-0", {"type": "caption.delta", "delta": "안녕하세요"}, raw=False) == (
        "안녕하세요"
    )
    completed = format_entry(
        "2-0",
        {
            "type": "caption.stream.completed",
            "sessionId": "session-1",
            "lastSequence": "7",
            "reason": "room_deleted",
        },
        raw=False,
    )
    assert completed is not None and "sequence=7" in completed


def test_caption_monitor_requires_session_filter() -> None:
    with pytest.raises(SystemExit):
        parse_monitor_args([])
