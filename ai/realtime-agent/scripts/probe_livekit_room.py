"""Read an existing LiveKit room snapshot without joining or creating a room."""

from __future__ import annotations

import argparse
import asyncio
import os
from collections.abc import Iterable
from dataclasses import dataclass

from livekit import api

from app.connections import LiveKitConnectionSettings, create_livekit_api_client


@dataclass(frozen=True, slots=True)
class ProbeSettings:
    connection: LiveKitConnectionSettings
    room_name: str

    @classmethod
    def from_values(
        cls,
        url: str,
        api_key: str,
        api_secret: str,
        room_name: str,
    ) -> ProbeSettings:
        connection = LiveKitConnectionSettings(
            url=url.strip(),
            api_key=api_key.strip(),
            api_secret=api_secret.strip(),
        )
        connection.validate()
        settings = cls(connection=connection, room_name=room_name.strip())
        if not settings.room_name:
            raise RuntimeError("missing required probe setting: room name")
        return settings


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.getenv("LIVEKIT_URL", ""))
    parser.add_argument("--room", default=os.getenv("STT_ROOM", ""))
    return parser.parse_args(argv)


def _enum_name(value: object) -> str:
    name = getattr(value, "name", None)
    if name:
        return str(name)
    try:
        return api.TrackType.Name(value)
    except (TypeError, ValueError):
        return str(value)


def format_room_snapshot(room_name: str, participants: Iterable[object]) -> str:
    lines = [f"room: {room_name}", "remote participants:"]
    ordered = sorted(participants, key=lambda item: item.identity)
    if not ordered:
        return "\n".join([*lines, "- (none)"])
    for participant in ordered:
        lines.append(f"- {participant.identity}")
        microphones = [
            track for track in participant.tracks if track.source == api.TrackSource.MICROPHONE
        ]
        if not microphones:
            lines.append("  microphone: none")
        for track in sorted(microphones, key=lambda item: item.sid):
            lines.append(
                "  microphone: "
                f"sid={track.sid} name={track.name or '-'} "
                f"kind={_enum_name(track.type)} muted={str(track.muted).lower()}"
            )
    return "\n".join(lines)


async def probe_room(settings: ProbeSettings, client: api.LiveKitAPI | None = None) -> str:
    livekit = client or create_livekit_api_client(settings.connection)
    try:
        rooms = await livekit.room.list_rooms(api.ListRoomsRequest(names=[settings.room_name]))
        exact = [room for room in rooms.rooms if room.name == settings.room_name]
        if len(exact) != 1:
            raise RuntimeError(f"room must already exist exactly once: {settings.room_name!r}")
        participants = await livekit.room.list_participants(
            api.ListParticipantsRequest(room=settings.room_name)
        )
        return format_room_snapshot(settings.room_name, participants.participants)
    finally:
        if client is None:
            await livekit.aclose()


async def main() -> None:
    args = parse_args()
    settings = ProbeSettings.from_values(
        args.url,
        os.getenv("LIVEKIT_API_KEY", ""),
        os.getenv("LIVEKIT_API_SECRET", ""),
        args.room,
    )
    print(await probe_room(settings))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        raise SystemExit(f"LiveKit room probe failed: {error}") from error
