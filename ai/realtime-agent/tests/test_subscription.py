from dataclasses import dataclass

import pytest

from app.livekit.subscription import (
    TrackDescriptor,
    apply_selective_subscription,
    is_microphone,
)


@dataclass
class RecordingPublication:
    subscribed: bool = False

    def set_subscribed(self, subscribed: bool) -> None:
        self.subscribed = subscribed


@pytest.mark.parametrize(
    ("kind", "source", "expected"),
    [
        ("audio", "microphone", True),
        ("audio", "screen_share_audio", False),
        ("video", "microphone", False),
    ],
)
def test_microphone_selection_requires_audio_and_microphone_source(
    kind: str, source: str, expected: bool
) -> None:
    assert is_microphone(TrackDescriptor(kind, source)) is expected


def test_selective_subscription_only_subscribes_wanted_track() -> None:
    microphone = RecordingPublication()
    screen_audio = RecordingPublication()

    assert apply_selective_subscription(microphone, TrackDescriptor("audio", "microphone")) is True
    assert (
        apply_selective_subscription(screen_audio, TrackDescriptor("audio", "screen_share_audio"))
        is False
    )

    assert microphone.subscribed is True
    assert screen_audio.subscribed is False
