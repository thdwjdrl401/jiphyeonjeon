from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol

from livekit import api

from app.jobs.metadata import JobMetadata


class DispatchSafetyError(RuntimeError):
    """A manual dispatch precondition was not satisfied."""


class RoomService(Protocol):
    async def list_rooms(self, request: api.ListRoomsRequest): ...

    async def list_participants(self, request: api.ListParticipantsRequest): ...


class DispatchService(Protocol):
    async def list_dispatch(self, room_name: str): ...

    async def create_dispatch(self, request: api.CreateAgentDispatchRequest): ...


@dataclass(frozen=True, slots=True)
class ManualDispatchRequest:
    room_name: str
    agent_name: str
    session_id: str
    lesson_id: str
    instructor_identity: str
    correlation_id: str

    def metadata_json(self) -> str:
        raw = json.dumps(
            {
                "contractVersion": "1",
                "sessionId": self.session_id,
                "lessonId": self.lesson_id,
                "correlationId": self.correlation_id,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        JobMetadata.parse(raw)
        return raw

    def validate(self) -> None:
        metadata = JobMetadata.parse(self.metadata_json())
        expected_room = f"session-{metadata.session_id}"
        if self.room_name != expected_room:
            raise DispatchSafetyError(f"room must match dispatch session: {expected_room!r}")
        if not self.agent_name.strip():
            raise DispatchSafetyError("agent name must not be blank")
        if not self.instructor_identity.strip():
            raise DispatchSafetyError("instructor identity must not be blank")


async def create_verified_dispatch(
    room_service: RoomService,
    dispatch_service: DispatchService,
    request: ManualDispatchRequest,
):
    request.validate()
    rooms = await room_service.list_rooms(api.ListRoomsRequest(names=[request.room_name]))
    exact_rooms = [room for room in rooms.rooms if room.name == request.room_name]
    if len(exact_rooms) != 1:
        raise DispatchSafetyError(f"room must already exist exactly once: {request.room_name!r}")

    participants = await room_service.list_participants(
        api.ListParticipantsRequest(room=request.room_name)
    )
    instructor = next(
        (
            participant
            for participant in participants.participants
            if participant.identity == request.instructor_identity
        ),
        None,
    )
    if instructor is None:
        raise DispatchSafetyError(f"instructor is not in room: {request.instructor_identity!r}")
    if not any(
        track.source == api.TrackSource.MICROPHONE and not track.muted
        for track in instructor.tracks
    ):
        raise DispatchSafetyError(
            f"instructor has no unmuted microphone publication: {request.instructor_identity!r}"
        )

    metadata = request.metadata_json()
    existing = await dispatch_service.list_dispatch(request.room_name)
    duplicate = next(
        (
            dispatch
            for dispatch in existing
            if dispatch.agent_name == request.agent_name and dispatch.metadata == metadata
        ),
        None,
    )
    if duplicate is not None:
        return duplicate, False

    created = await dispatch_service.create_dispatch(
        api.CreateAgentDispatchRequest(
            room=request.room_name,
            agent_name=request.agent_name,
            metadata=metadata,
        )
    )
    return created, True
