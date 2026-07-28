from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from types import SimpleNamespace

import pytest
from livekit import rtc
from livekit.agents import AutoSubscribe

from app.livekit.audio_source import (
    AudioBacklogError,
    AudioSourceError,
    LiveKitInstructorAudioSource,
)
from app.stt.engine import AudioChunk

INSTRUCTOR_IDENTITY = "861bdefa-69eb-4f2f-9b5a-3dd46e8a9646"
OTHER_IDENTITY = "cd2b5b79-5de0-4ac9-a30c-95dc339da606"


class FakeRoom:
    def __init__(self) -> None:
        self.handlers: dict[str, Callable[..., None]] = {}
        self.remote_participants: dict[str, FakeParticipant] = {}

    def on(self, event: str, callback: Callable[..., None]) -> None:
        self.handlers[event] = callback

    def off(self, event: str, callback: Callable[..., None]) -> None:
        if self.handlers.get(event) == callback:
            self.handlers.pop(event)


class FakeContext:
    def __init__(self, room: FakeRoom) -> None:
        self.room = room
        self.auto_subscribe: AutoSubscribe | None = None
        self.rtc_config: rtc.RtcConfiguration | None = None

    async def connect(
        self,
        *,
        auto_subscribe: AutoSubscribe,
        rtc_config: rtc.RtcConfiguration | None = None,
    ) -> None:
        self.auto_subscribe = auto_subscribe
        self.rtc_config = rtc_config


class FakePublication:
    def __init__(self, kind: object, source: object, sid: str = "track-1") -> None:
        self.kind = kind
        self.source = source
        self.sid = sid
        self.subscribed = False

    def set_subscribed(self, subscribed: bool) -> None:
        self.subscribed = subscribed


@dataclass
class FakeParticipant:
    identity: str
    track_publications: dict[str, FakePublication] = field(default_factory=dict)


def microphone(sid: str = "track-1") -> FakePublication:
    return FakePublication(
        rtc.TrackKind.KIND_AUDIO,
        rtc.TrackSource.SOURCE_MICROPHONE,
        sid,
    )


async def test_connect_disables_auto_subscribe_and_selects_one_microphone() -> None:
    room = FakeRoom()
    first_mic = microphone("track-1")
    second_mic = microphone("track-2")
    screen_audio = FakePublication(
        rtc.TrackKind.KIND_AUDIO,
        rtc.TrackSource.SOURCE_SCREENSHARE_AUDIO,
        "track-3",
    )
    participant = FakeParticipant(
        INSTRUCTOR_IDENTITY,
        {"track-1": first_mic, "track-2": second_mic, "track-3": screen_audio},
    )
    room.remote_participants[participant.identity] = participant
    context = FakeContext(room)
    source = LiveKitInstructorAudioSource(context)  # type: ignore[arg-type]

    await source.connect()

    assert context.auto_subscribe is AutoSubscribe.SUBSCRIBE_NONE
    assert first_mic.subscribed is True
    assert second_mic.subscribed is False
    assert screen_audio.subscribed is False
    await source.close()
    assert room.handlers == {}


async def test_connect_passes_explicit_rtc_configuration() -> None:
    room = FakeRoom()
    context = FakeContext(room)
    rtc_config = rtc.RtcConfiguration()
    source = LiveKitInstructorAudioSource(context, rtc_config=rtc_config)  # type: ignore[arg-type]

    await source.connect()

    assert context.rtc_config is rtc_config
    await source.close()


async def test_late_microphone_publication_uses_the_same_selection_policy() -> None:
    room = FakeRoom()
    context = FakeContext(room)
    source = LiveKitInstructorAudioSource(context)  # type: ignore[arg-type]
    participant = FakeParticipant(INSTRUCTOR_IDENTITY)
    screen_audio = FakePublication(
        rtc.TrackKind.KIND_AUDIO,
        rtc.TrackSource.SOURCE_SCREENSHARE_AUDIO,
        "track-1",
    )
    late_microphone = microphone("track-2")
    await source.connect()

    room.handlers["track_published"](screen_audio, participant)
    room.handlers["track_published"](late_microphone, participant)

    assert screen_audio.subscribed is False
    assert late_microphone.subscribed is True
    await source.close()


async def test_second_microphone_publisher_fails_closed() -> None:
    room = FakeRoom()
    instructor = FakeParticipant(INSTRUCTOR_IDENTITY, {"track-1": microphone("track-1")})
    unexpected = FakeParticipant(OTHER_IDENTITY, {"track-2": microphone("track-2")})
    room.remote_participants = {
        instructor.identity: instructor,
        unexpected.identity: unexpected,
    }
    source = LiveKitInstructorAudioSource(FakeContext(room))  # type: ignore[arg-type]

    await source.connect()

    with pytest.raises(AudioSourceError, match="track_sid=track-2") as exc_info:
        await anext(source.chunks())
    assert "multiple remote microphone publishers" in str(exc_info.value.__cause__)
    await source.close()


async def test_unpublished_selected_track_falls_back_within_same_publisher() -> None:
    room = FakeRoom()
    first = microphone("track-1")
    second = microphone("track-2")
    participant = FakeParticipant(
        INSTRUCTOR_IDENTITY,
        {"track-1": first, "track-2": second},
    )
    room.remote_participants[participant.identity] = participant
    source = LiveKitInstructorAudioSource(FakeContext(room))  # type: ignore[arg-type]
    await source.connect()

    participant.track_publications.pop("track-1")
    room.handlers["track_unpublished"](first, participant)

    assert second.subscribed is True
    await source.close()


async def test_pcm_frames_are_mono_and_use_cumulative_sample_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    room = FakeRoom()
    publication = microphone()
    participant = FakeParticipant(INSTRUCTOR_IDENTITY, {publication.sid: publication})
    room.remote_participants[participant.identity] = participant
    source = LiveKitInstructorAudioSource(FakeContext(room))  # type: ignore[arg-type]
    await source.connect()
    captured: dict[str, object] = {}
    frames = [
        SimpleNamespace(
            frame=SimpleNamespace(
                data=b"first",
                samples_per_channel=480,
                sample_rate=48_000,
                num_channels=1,
            )
        ),
        SimpleNamespace(
            frame=SimpleNamespace(
                data=b"second",
                samples_per_channel=960,
                sample_rate=48_000,
                num_channels=1,
            )
        ),
    ]

    class ScriptedAudioStream:
        def __init__(self, _track: object, **kwargs: object) -> None:
            captured.update(kwargs)
            self._frames = iter(frames)
            self.closed = False

        def __aiter__(self) -> ScriptedAudioStream:
            return self

        async def __anext__(self) -> object:
            try:
                return next(self._frames)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

        async def aclose(self) -> None:
            self.closed = True

    monkeypatch.setattr(rtc, "AudioStream", ScriptedAudioStream)
    track = SimpleNamespace(kind=rtc.TrackKind.KIND_AUDIO)
    room.handlers["track_subscribed"](track, publication, participant)

    chunks = source.chunks()
    first = await anext(chunks)
    second = await anext(chunks)

    assert (first.pcm, first.stream_elapsed_ms) == (b"first", 10)
    assert (second.pcm, second.stream_elapsed_ms) == (b"second", 30)
    assert first.sample_rate == second.sample_rate == 48_000
    assert first.num_channels == second.num_channels == 1
    assert captured == {
        "sample_rate": 48_000,
        "num_channels": 1,
        "frame_size_ms": 20,
    }
    await source.close()


async def test_audio_stream_failure_reaches_chunk_consumer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    room = FakeRoom()
    publication = microphone()
    participant = FakeParticipant(INSTRUCTOR_IDENTITY, {publication.sid: publication})
    room.remote_participants[participant.identity] = participant
    source = LiveKitInstructorAudioSource(FakeContext(room))  # type: ignore[arg-type]
    await source.connect()
    stream_closed = asyncio.Event()

    class FailingAudioStream:
        def __init__(self, _track: object, **_kwargs: object) -> None:
            self.created = True

        def __aiter__(self) -> FailingAudioStream:
            return self

        async def __anext__(self) -> object:
            raise RuntimeError("audio read failed")

        async def aclose(self) -> None:
            stream_closed.set()

    monkeypatch.setattr(rtc, "AudioStream", FailingAudioStream)
    room.handlers["track_subscribed"](
        SimpleNamespace(kind=rtc.TrackKind.KIND_AUDIO),
        publication,
        participant,
    )

    with pytest.raises(AudioSourceError, match="track_sid=track-1") as exc_info:
        await anext(source.chunks())

    assert isinstance(exc_info.value.__cause__, RuntimeError)
    assert stream_closed.is_set()
    await source.close()


async def test_full_output_backlog_fails_closed_instead_of_dropping_audio(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    room = FakeRoom()
    publication = microphone()
    participant = FakeParticipant(INSTRUCTOR_IDENTITY, {publication.sid: publication})
    room.remote_participants[participant.identity] = participant
    source = LiveKitInstructorAudioSource(FakeContext(room))  # type: ignore[arg-type]
    await source.connect()
    while not source._queue.full():
        source._queue.put_nowait(AudioChunk(b"queued", 48_000, 1, 20))

    class OneFrameAudioStream:
        def __init__(self, _track: object, **_kwargs: object) -> None:
            self._sent = False

        def __aiter__(self) -> OneFrameAudioStream:
            return self

        async def __anext__(self) -> object:
            if self._sent:
                raise StopAsyncIteration
            self._sent = True
            return SimpleNamespace(
                frame=SimpleNamespace(
                    data=b"overflow",
                    samples_per_channel=480,
                    sample_rate=48_000,
                    num_channels=1,
                )
            )

        async def aclose(self) -> None:
            return None

    monkeypatch.setattr(rtc, "AudioStream", OneFrameAudioStream)
    caplog.set_level(logging.ERROR, logger="app.livekit.audio_source")
    room.handlers["track_subscribed"](
        SimpleNamespace(kind=rtc.TrackKind.KIND_AUDIO),
        publication,
        participant,
    )
    consumer = source._tasks[publication.sid]
    await asyncio.gather(consumer, return_exceptions=True)
    await asyncio.sleep(0)

    with pytest.raises(AudioSourceError) as exc_info:
        await anext(source.chunks())
    assert isinstance(exc_info.value.__cause__, AudioBacklogError)
    assert "250 frames (5000 ms)" in str(exc_info.value.__cause__)
    assert (
        "LiveKit audio backlog overflow: track=track-1 queued=250 capacity=250 backlog_ms=5000"
    ) in caplog.messages
    await source.close()


async def test_subscription_failure_reaches_chunk_consumer() -> None:
    room = FakeRoom()
    publication = microphone()
    participant = FakeParticipant(INSTRUCTOR_IDENTITY, {publication.sid: publication})
    room.remote_participants[participant.identity] = participant
    source = LiveKitInstructorAudioSource(FakeContext(room))  # type: ignore[arg-type]
    await source.connect()

    room.handlers["track_subscription_failed"](
        participant,
        publication.sid,
        "permission denied",
    )

    with pytest.raises(AudioSourceError, match="track_sid=track-1") as exc_info:
        await anext(source.chunks())
    assert isinstance(exc_info.value.__cause__, ConnectionError)
    await source.close()


async def test_disconnect_is_a_failure_and_late_tracks_are_ignored() -> None:
    room = FakeRoom()
    source = LiveKitInstructorAudioSource(FakeContext(room))  # type: ignore[arg-type]
    room.handlers["disconnected"]()
    late_microphone = microphone()
    room.handlers["track_published"](
        late_microphone,
        FakeParticipant(INSTRUCTOR_IDENTITY),
    )

    with pytest.raises(AudioSourceError, match="track_sid=room") as exc_info:
        await anext(source.chunks())

    assert isinstance(exc_info.value.__cause__, ConnectionError)
    assert late_microphone.subscribed is False
    await source.close()
    assert room.handlers == {}


async def test_terminal_failure_preempts_buffered_audio() -> None:
    room = FakeRoom()
    source = LiveKitInstructorAudioSource(FakeContext(room))  # type: ignore[arg-type]
    source._queue.put_nowait(AudioChunk(b"stale", 48_000, 1, 20))

    room.handlers["disconnected"]()

    with pytest.raises(AudioSourceError, match="track_sid=room"):
        await anext(source.chunks())
    await source.close()


async def test_chunks_allows_only_one_consumer_and_close_releases_it() -> None:
    room = FakeRoom()
    source = LiveKitInstructorAudioSource(FakeContext(room))  # type: ignore[arg-type]
    first_consumer = asyncio.create_task(anext(source.chunks()))
    await asyncio.sleep(0)

    with pytest.raises(RuntimeError, match="only be consumed once"):
        await anext(source.chunks())

    await source.close()
    with pytest.raises(StopAsyncIteration):
        await first_consumer

    with pytest.raises(RuntimeError, match="only be consumed once"):
        await anext(source.chunks())


async def test_same_sid_resubscribe_keeps_new_consumer_tracked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    room = FakeRoom()
    publication = microphone()
    participant = FakeParticipant(INSTRUCTOR_IDENTITY, {publication.sid: publication})
    room.remote_participants[participant.identity] = participant
    source = LiveKitInstructorAudioSource(FakeContext(room))  # type: ignore[arg-type]
    await source.connect()

    class BlockingAudioStream:
        def __init__(self, _track: object, **_kwargs: object) -> None:
            self._wait_forever = asyncio.Event()

        def __aiter__(self) -> BlockingAudioStream:
            return self

        async def __anext__(self) -> object:
            await self._wait_forever.wait()
            raise StopAsyncIteration

        async def aclose(self) -> None:
            return None

    monkeypatch.setattr(rtc, "AudioStream", BlockingAudioStream)
    track = SimpleNamespace(kind=rtc.TrackKind.KIND_AUDIO)
    subscribed = room.handlers["track_subscribed"]
    unsubscribed = room.handlers["track_unsubscribed"]

    subscribed(track, publication, participant)
    await asyncio.sleep(0)
    old_task = source._tasks[publication.sid]
    unsubscribed(track, publication, participant)
    subscribed(track, publication, participant)
    new_task = source._tasks[publication.sid]
    await asyncio.sleep(0)

    assert old_task is not new_task
    assert source._tasks[publication.sid] is new_task
    await source.close()
    assert new_task.done()
