"""Join an existing LiveKit room and print a credential-free snapshot."""

from __future__ import annotations

import argparse
import asyncio
import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol

from livekit import rtc


class TrackPublication(Protocol):
    sid: str
    name: str
    kind: object
    source: object
    muted: bool


class Participant(Protocol):
    identity: str
    track_publications: Mapping[str, TrackPublication]


class ProbeRoom(Protocol):
    name: str
    local_participant: Participant
    remote_participants: Mapping[str, Participant]

    async def connect(self, url: str, token: str, options: rtc.RoomOptions) -> None: ...

    async def disconnect(self) -> None: ...


@dataclass(frozen=True, slots=True)
class ProbeSettings:
    url: str
    token: str

    @classmethod
    def from_values(cls, url: str, token: str) -> ProbeSettings:
        settings = cls(url=url.strip(), token=token.strip())
        missing = [
            name
            for name, value in (("LIVEKIT_URL", settings.url), ("LIVEKIT_TOKEN", settings.token))
            if not value
        ]
        if missing:
            raise RuntimeError(f"missing required probe settings: {', '.join(missing)}")
        return settings


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.getenv("LIVEKIT_URL", ""))
    parser.add_argument("--token", default=os.getenv("LIVEKIT_TOKEN", ""))
    return parser.parse_args(argv)


def _enum_name(value: object) -> str:
    name = getattr(value, "name", None)
    return str(name) if name else str(value)


def format_room_snapshot(room: ProbeRoom) -> str:
    lines = [
        f"room: {room.name}",
        f"local identity: {room.local_participant.identity}",
        "remote participants:",
    ]
    participants = sorted(room.remote_participants.values(), key=lambda item: item.identity)
    if not participants:
        return "\n".join([*lines, "- (none)"])

    for participant in participants:
        lines.append(f"- {participant.identity}")
        microphones = [
            publication
            for publication in participant.track_publications.values()
            if publication.source == rtc.TrackSource.SOURCE_MICROPHONE
        ]
        if not microphones:
            lines.append("  microphone: none")
        for publication in sorted(microphones, key=lambda item: item.sid):
            lines.append(
                "  microphone: "
                f"sid={publication.sid} name={publication.name or '-'} "
                f"kind={_enum_name(publication.kind)} muted={str(publication.muted).lower()}"
            )
    return "\n".join(lines)


async def probe_room(settings: ProbeSettings, room: ProbeRoom | None = None) -> str:
    livekit_room = room or rtc.Room()
    try:
        await livekit_room.connect(
            settings.url,
            settings.token,
            rtc.RoomOptions(auto_subscribe=False),
        )
        return format_room_snapshot(livekit_room)
    finally:
        await livekit_room.disconnect()


async def main() -> None:
    args = parse_args()
    print(await probe_room(ProbeSettings.from_values(args.url, args.token)))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        raise SystemExit(f"LiveKit room probe failed: {error}") from error
