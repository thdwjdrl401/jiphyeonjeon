from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class TrackDescriptor:
    kind: str
    source: str


class RemoteTrackPublication(Protocol):
    def set_subscribed(self, subscribed: bool) -> None: ...


def is_microphone(track: TrackDescriptor) -> bool:
    return track.kind == "audio" and track.source == "microphone"


def apply_selective_subscription(
    publication: RemoteTrackPublication,
    track: TrackDescriptor,
) -> bool:
    wanted = is_microphone(track)
    if wanted:
        publication.set_subscribed(True)
    return wanted
