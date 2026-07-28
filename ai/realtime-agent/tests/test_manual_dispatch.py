from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from livekit import api

from app.livekit.manual_dispatch import (
    DispatchSafetyError,
    ManualDispatchRequest,
    create_verified_dispatch,
)
from scripts.dispatch_existing_room import parse_args

SESSION_ID = "11111111-1111-4111-8111-111111111111"
LESSON_ID = "22222222-2222-4222-8222-222222222222"


class FakeRoomService:
    def __init__(
        self,
        *,
        room: bool = True,
        microphone: bool = True,
        unexpected_microphone: bool = False,
    ) -> None:
        self.room = room
        self.microphone = microphone
        self.unexpected_microphone = unexpected_microphone

    async def list_rooms(self, request):
        return SimpleNamespace(rooms=[SimpleNamespace(name=request.names[0])] if self.room else [])

    async def list_participants(self, _request):
        track = SimpleNamespace(source=api.TrackSource.MICROPHONE, muted=not self.microphone)
        participants = [SimpleNamespace(identity="av-bot", tracks=[track])]
        if self.unexpected_microphone:
            participants.append(
                SimpleNamespace(
                    identity="unexpected-publisher",
                    tracks=[SimpleNamespace(source=api.TrackSource.MICROPHONE, muted=True)],
                )
            )
        return SimpleNamespace(participants=participants)


class FakeDispatchService:
    def __init__(self) -> None:
        self.existing = []
        self.created = []

    async def list_dispatch(self, _room_name):
        return self.existing

    async def create_dispatch(self, request):
        self.created.append(request)
        return SimpleNamespace(
            id="dispatch-1",
            room=request.room,
            agent_name=request.agent_name,
            metadata=request.metadata,
        )


def request(**changes: str) -> ManualDispatchRequest:
    values = {
        "room_name": f"session-{SESSION_ID}",
        "agent_name": "liveclass-realtime-stt",
        "session_id": SESSION_ID,
        "lesson_id": LESSON_ID,
        "instructor_identity": "av-bot",
        "correlation_id": "manual-1",
        **changes,
    }
    return ManualDispatchRequest(**values)


async def test_creates_strict_contract_dispatch_after_microphone_verification() -> None:
    service = FakeDispatchService()
    dispatch, created = await create_verified_dispatch(FakeRoomService(), service, request())

    assert created is True
    assert dispatch.id == "dispatch-1"
    assert json.loads(service.created[0].metadata) == {
        "contractVersion": "1",
        "sessionId": SESSION_ID,
        "lessonId": LESSON_ID,
        "correlationId": "manual-1",
    }


@pytest.mark.parametrize(
    ("rooms", "manual_request", "message"),
    [
        (FakeRoomService(room=False), request(), "room must already exist"),
        (FakeRoomService(microphone=False), request(), "no unmuted microphone"),
        (
            FakeRoomService(unexpected_microphone=True),
            request(),
            "unexpected participants",
        ),
        (FakeRoomService(), request(room_name="wrong-room"), "room must match"),
    ],
)
async def test_rejects_unsafe_dispatch(rooms, manual_request, message: str) -> None:
    service = FakeDispatchService()
    with pytest.raises(DispatchSafetyError, match=message):
        await create_verified_dispatch(rooms, service, manual_request)
    assert service.created == []


async def test_reuses_identical_dispatch() -> None:
    service = FakeDispatchService()
    existing = SimpleNamespace(
        id="dispatch-existing",
        room=request().room_name,
        agent_name=request().agent_name,
        metadata=request().metadata_json(),
    )
    service.existing = [existing]

    dispatch, created = await create_verified_dispatch(FakeRoomService(), service, request())

    assert created is False
    assert dispatch is existing
    assert service.created == []


async def test_reuses_semantically_identical_dispatch_metadata() -> None:
    service = FakeDispatchService()
    existing = SimpleNamespace(
        id="dispatch-existing",
        room=request().room_name,
        agent_name=request().agent_name,
        metadata=json.dumps(
            {
                "correlationId": "manual-1",
                "lessonId": LESSON_ID,
                "sessionId": SESSION_ID,
                "contractVersion": "1",
            },
            indent=2,
        ),
    )
    service.existing = [existing]

    dispatch, created = await create_verified_dispatch(FakeRoomService(), service, request())

    assert created is False
    assert dispatch is existing
    assert service.created == []


async def test_rejects_conflicting_dispatch_for_same_room_and_agent() -> None:
    service = FakeDispatchService()
    conflicting = request(correlation_id="different-correlation")
    service.existing = [
        SimpleNamespace(
            id="dispatch-existing",
            room=request().room_name,
            agent_name=request().agent_name,
            metadata=conflicting.metadata_json(),
        )
    ]

    with pytest.raises(DispatchSafetyError, match="different metadata"):
        await create_verified_dispatch(FakeRoomService(), service, request())

    assert service.created == []


def test_dispatch_cli_keeps_uuid_identifiers_as_strings() -> None:
    args = parse_args(
        [
            "--room",
            f"session-{SESSION_ID}",
            "--instructor",
            "av-bot",
            "--session-id",
            SESSION_ID,
            "--lesson-id",
            LESSON_ID,
            "--correlation-id",
            "manual-1",
        ]
    )
    assert args.session_id == SESSION_ID
    assert args.lesson_id == LESSON_ID
