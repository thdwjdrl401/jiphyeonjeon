from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal

from livekit import rtc
from livekit.agents import AutoSubscribe, JobContext

from app.livekit.subscription import (
    TrackDescriptor,
    apply_selective_subscription,
    is_microphone,
)
from app.stt.engine import AudioChunk

_CLOSED = object()
_FRAME_SIZE_MS = 20
_OUTPUT_QUEUE_CAPACITY_FRAMES = 250
_SAMPLE_RATE = 48_000
_NANOSECONDS_PER_SECOND = 1_000_000_000

logger = logging.getLogger(__name__)

AudioCompletionReason = Literal["ROOM_DELETED", "SOURCE_EOF"]


@dataclass(frozen=True, slots=True)
class AudioCompletionRequest:
    reason: AudioCompletionReason
    requested_at_monotonic: float


class AudioSourceError(RuntimeError):
    """Raised when the selected instructor microphone cannot be consumed."""


class AudioBacklogError(RuntimeError):
    """Raised instead of silently dropping instructor audio under backpressure."""


@dataclass(frozen=True, slots=True)
class _AudioStreamFailure:
    track_sid: str
    error: BaseException


class LiveKitInstructorAudioSource:
    """Expose the only remote microphone publisher as PCM chunks.

    Spring grants publish permission only to the instructor. A second microphone publisher therefore
    violates the room authorization invariant and fails closed instead of mixing audio.
    """

    def __init__(
        self,
        context: JobContext,
        *,
        rtc_config: rtc.RtcConfiguration | None = None,
    ) -> None:
        self._context = context
        self._room = context.room
        self._rtc_config = rtc_config
        self._queue: asyncio.Queue[AudioChunk | _AudioStreamFailure | object] = asyncio.Queue(
            maxsize=_OUTPUT_QUEUE_CAPACITY_FRAMES
        )
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._retired_tasks: set[asyncio.Task[None]] = set()
        self._publisher_identity: str | None = None
        self._selected_track_sid: str | None = None
        self._captured_nanoseconds = 0
        self._connected = False
        self._closed = False
        self._accepting_tracks = True
        self._input_completed = False
        self._completion_requested = asyncio.Event()
        self._completion_request: AudioCompletionRequest | None = None
        self._chunks_taken = False

        self._room.on("track_published", self._on_track_published)
        self._room.on("track_unpublished", self._on_track_unpublished)
        self._room.on("track_subscribed", self._on_track_subscribed)
        self._room.on("track_unsubscribed", self._on_track_unsubscribed)
        self._room.on("track_subscription_failed", self._on_track_subscription_failed)
        self._room.on("disconnected", self._on_disconnected)

    async def connect(self) -> None:
        if self._closed:
            raise RuntimeError("audio source is closed")
        if self._connected:
            raise RuntimeError("audio source is already connected")
        self._connected = True
        if self._rtc_config is None:
            await self._context.connect(auto_subscribe=AutoSubscribe.SUBSCRIBE_NONE)
        else:
            await self._context.connect(
                auto_subscribe=AutoSubscribe.SUBSCRIBE_NONE,
                rtc_config=self._rtc_config,
            )
        for participant in self._room.remote_participants.values():
            for publication in participant.track_publications.values():
                self._consider_publication(publication, participant)

    async def chunks(self) -> AsyncIterator[AudioChunk]:
        if self._chunks_taken:
            raise RuntimeError("audio chunks can only be consumed once")
        self._chunks_taken = True
        while True:
            if self._input_completed and self._queue.empty():
                return
            item = await self._queue.get()
            if item is _CLOSED:
                return
            if isinstance(item, _AudioStreamFailure):
                raise AudioSourceError(
                    f"LiveKit audio stream failed: track_sid={item.track_sid}"
                ) from item.error
            assert isinstance(item, AudioChunk)
            yield item

    @property
    def completion_request(self) -> AudioCompletionRequest | None:
        return self._completion_request

    async def wait_completion_requested(self) -> AudioCompletionRequest:
        await self._completion_requested.wait()
        request = self._completion_request
        if request is None:
            raise RuntimeError("audio completion event was set without a request")
        return request

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._accepting_tracks = False
        self._remove_listeners()
        tasks = [*self._tasks.values(), *self._retired_tasks]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()
        self._retired_tasks.clear()
        self._complete_input()

    def _consider_publication(
        self,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> bool:
        if not self._accepting_tracks:
            return False
        descriptor = TrackDescriptor(
            kind="audio" if publication.kind == rtc.TrackKind.KIND_AUDIO else "other",
            source=(
                "microphone" if publication.source == rtc.TrackSource.SOURCE_MICROPHONE else "other"
            ),
        )
        if not is_microphone(descriptor):
            return False
        if self._publisher_identity is None:
            self._publisher_identity = participant.identity
        elif participant.identity != self._publisher_identity:
            self._fail(
                publication.sid,
                RuntimeError("multiple remote microphone publishers"),
            )
            return False
        if self._selected_track_sid not in (None, publication.sid):
            return False
        self._selected_track_sid = publication.sid
        return apply_selective_subscription(publication, descriptor)

    def _on_track_published(
        self,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        if self._accepting_tracks:
            self._consider_publication(publication, participant)

    def _on_track_unpublished(
        self,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        if publication.sid != self._selected_track_sid:
            return
        self._cancel_consumer(publication.sid)
        self._selected_track_sid = None
        if self._accepting_tracks:
            for candidate in participant.track_publications.values():
                if self._consider_publication(candidate, participant):
                    break

    def _on_track_subscribed(
        self,
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        if not self._accepting_tracks:
            return
        if publication.sid != self._selected_track_sid:
            return
        if not self._is_selected_track(track, publication, participant):
            return
        if publication.sid in self._tasks:
            return
        task = asyncio.create_task(self._consume_track(track, publication.sid))
        self._tasks[publication.sid] = task
        task.add_done_callback(
            lambda completed, sid=publication.sid: self._on_consumer_done(sid, completed)
        )

    def _on_track_unsubscribed(
        self,
        _track: rtc.Track | None,
        publication: rtc.RemoteTrackPublication,
        _participant: rtc.RemoteParticipant,
    ) -> None:
        self._cancel_consumer(publication.sid)

    def _on_track_subscription_failed(
        self,
        participant: rtc.RemoteParticipant,
        track_sid: str,
        error: str,
    ) -> None:
        if (
            not self._accepting_tracks
            or participant.identity != self._publisher_identity
            or track_sid != self._selected_track_sid
        ):
            return
        self._fail(track_sid, ConnectionError(error))

    def _on_disconnected(
        self,
        reason: int = rtc.DisconnectReason.UNKNOWN_REASON,
    ) -> None:
        if not self._accepting_tracks:
            return
        if reason == rtc.DisconnectReason.ROOM_DELETED:
            self._request_completion("ROOM_DELETED")
            self._accepting_tracks = False
            for active_track_sid in list(self._tasks):
                self._cancel_consumer(active_track_sid)
            self._complete_input()
            return
        self._fail(
            "room",
            ConnectionError(f"LiveKit room disconnected: reason={_disconnect_reason_name(reason)}"),
        )

    def _on_consumer_done(self, track_sid: str, task: asyncio.Task[None]) -> None:
        if self._tasks.get(track_sid) is task:
            self._tasks.pop(track_sid, None)
        self._retired_tasks.discard(task)
        if task.cancelled():
            return
        error = task.exception()
        if error is not None and not self._closed:
            self._fail(track_sid, error)

    def _cancel_consumer(self, track_sid: str) -> None:
        task = self._tasks.pop(track_sid, None)
        if task is None:
            return
        self._retired_tasks.add(task)
        task.cancel()

    def _is_selected_track(
        self,
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> bool:
        return (
            participant.identity == self._publisher_identity
            and track.kind == rtc.TrackKind.KIND_AUDIO
            and publication.source == rtc.TrackSource.SOURCE_MICROPHONE
        )

    async def _consume_track(self, track: rtc.Track, track_sid: str) -> None:
        stream = rtc.AudioStream(
            track,
            sample_rate=_SAMPLE_RATE,
            num_channels=1,
            frame_size_ms=_FRAME_SIZE_MS,
        )
        try:
            async for event in stream:
                frame = event.frame
                duration_ns = (
                    frame.samples_per_channel * _NANOSECONDS_PER_SECOND + frame.sample_rate // 2
                ) // frame.sample_rate
                self._captured_nanoseconds += duration_ns
                chunk = AudioChunk(
                    pcm=bytes(frame.data),
                    sample_rate=frame.sample_rate,
                    num_channels=frame.num_channels,
                    stream_elapsed_ms=self._captured_nanoseconds // 1_000_000,
                )
                try:
                    self._queue.put_nowait(chunk)
                except asyncio.QueueFull as exc:
                    queued_frames = self._queue.qsize()
                    logger.error(
                        "LiveKit audio backlog overflow: "
                        "track=%s queued=%d capacity=%d backlog_ms=%d",
                        track_sid,
                        queued_frames,
                        self._queue.maxsize,
                        queued_frames * _FRAME_SIZE_MS,
                    )
                    raise AudioBacklogError(
                        "audio backlog exceeded "
                        f"{_OUTPUT_QUEUE_CAPACITY_FRAMES} frames "
                        f"({_OUTPUT_QUEUE_CAPACITY_FRAMES * _FRAME_SIZE_MS} ms)"
                    ) from exc
        finally:
            await stream.aclose()
            current_task = asyncio.current_task()
            if self._tasks.get(track_sid) is current_task:
                self._tasks.pop(track_sid, None)

    def _remove_listeners(self) -> None:
        self._room.off("track_published", self._on_track_published)
        self._room.off("track_unpublished", self._on_track_unpublished)
        self._room.off("track_subscribed", self._on_track_subscribed)
        self._room.off("track_unsubscribed", self._on_track_unsubscribed)
        self._room.off("track_subscription_failed", self._on_track_subscription_failed)
        self._room.off("disconnected", self._on_disconnected)

    def _fail(self, track_sid: str, error: BaseException) -> None:
        self._accepting_tracks = False
        for active_track_sid in list(self._tasks):
            self._cancel_consumer(active_track_sid)
        while True:
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        self._signal(_AudioStreamFailure(track_sid, error))

    def _request_completion(self, reason: AudioCompletionReason) -> None:
        if self._completion_request is not None:
            return
        self._completion_request = AudioCompletionRequest(
            reason=reason,
            requested_at_monotonic=time.monotonic(),
        )
        self._completion_requested.set()

    def _complete_input(self) -> None:
        """Wake the sole consumer without discarding already captured audio."""
        if self._input_completed:
            return
        self._input_completed = True
        try:
            self._queue.put_nowait(_CLOSED)
        except asyncio.QueueFull:
            # chunks() observes _input_completed after draining the full queue.
            pass

    def _signal(self, item: _AudioStreamFailure | object) -> None:
        if self._queue.full():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                return
        try:
            self._queue.put_nowait(item)
        except asyncio.QueueFull:
            return


def _disconnect_reason_name(reason: int) -> str:
    try:
        return rtc.DisconnectReason.Name(reason)
    except ValueError:
        return f"UNKNOWN({reason})"
