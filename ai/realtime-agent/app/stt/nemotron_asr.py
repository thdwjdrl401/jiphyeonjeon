from __future__ import annotations

from collections.abc import Iterator
from queue import Empty
from threading import Event, Lock, Thread, current_thread
from time import monotonic
from typing import Any

import numpy as np

_GENERATION_JOIN_TIMEOUT_SECONDS = 0.5
_STREAMER_POLL_TIMEOUT_SECONDS = 0.05


class _StopOnEvent:
    def __init__(self, stop_requested: Event) -> None:
        self._stop_requested = stop_requested

    def __call__(self, *_args: object, **_kwargs: object) -> bool:
        return self._stop_requested.is_set()


class NemotronStreamingASR:
    """Lazy Transformers adapter for nvidia/nemotron-3.5-asr-streaming-0.6b."""

    def __init__(self, model_id: str, language: str) -> None:
        self._model_id = model_id
        self._language = language
        self._processor: Any | None = None
        self._model: Any | None = None
        self._closed = Event()
        self._load_lock = Lock()
        self._state_lock = Lock()
        self._active_lock = Lock()
        self._active_generations: dict[Thread, Event] = {}

    def load(self) -> None:
        """Synchronously load the processor and model in the owning job process."""

        self._ensure_loaded()

    def _ensure_loaded(self) -> tuple[Any, Any]:
        with self._state_lock:
            if self._closed.is_set():
                raise RuntimeError("Nemotron recognizer is closed")
            if self._model is not None:
                assert self._processor is not None
                return self._processor, self._model

        # Loading happens outside the state lock so close() can mark the adapter
        # closed immediately. The second check prevents a late GPU model from ever
        # becoming owned by an already-closed adapter.
        with self._load_lock:
            with self._state_lock:
                if self._closed.is_set():
                    raise RuntimeError("Nemotron recognizer is closed")
                if self._model is not None:
                    assert self._processor is not None
                    return self._processor, self._model

            try:
                from transformers import AutoModelForRNNT, AutoProcessor
            except ImportError as exc:
                raise RuntimeError(
                    "Nemotron dependencies are missing or incompatible; "
                    "run `uv sync --extra nemotron`"
                ) from exc

            processor = AutoProcessor.from_pretrained(self._model_id)
            model = AutoModelForRNNT.from_pretrained(self._model_id, device_map="auto")
            processor.set_num_lookahead_tokens(6)

            with self._state_lock:
                if self._closed.is_set():
                    # Locals are deliberately not transferred to object state. They
                    # are released as this frame unwinds, including GPU allocations.
                    raise RuntimeError("Nemotron recognizer closed while loading")
                self._processor = processor
                self._model = model
                return processor, model

    def transcribe_stream(
        self,
        pcm_int16: np.ndarray[Any, np.dtype[np.int16]],
        input_sample_rate: int,
        stop_requested: Event | None = None,
    ) -> Iterator[str]:
        stop_requested = stop_requested or Event()
        if stop_requested.is_set():
            return

        processor, model = self._ensure_loaded()
        from transformers import StoppingCriteriaList, TextIteratorStreamer

        if self._closed.is_set() or stop_requested.is_set():
            return
        if input_sample_rate != processor.feature_extractor.sampling_rate:
            raise ValueError("Nemotron adapter expects normalized 16 kHz PCM")

        audio = pcm_int16.astype(np.float32) / 32768.0
        first = processor(
            audio[: processor.num_samples_first_audio_chunk],
            sampling_rate=input_sample_rate,
            is_streaming=True,
            is_first_audio_chunk=True,
            language=self._language,
            return_tensors="pt",
        ).to(model.device, dtype=model.dtype)

        def features() -> Iterator[Any]:
            if stop_requested.is_set():
                return
            yield first.input_features[:, : processor.num_mel_frames_first_audio_chunk, :]
            mel_index = processor.num_mel_frames_first_audio_chunk
            hop = processor.feature_extractor.hop_length
            n_fft = processor.feature_extractor.n_fft
            start = mel_index * hop - n_fft // 2
            while (end := start + processor.num_samples_per_audio_chunk) < audio.shape[0]:
                if stop_requested.is_set():
                    return
                inputs = processor(
                    audio[start:end],
                    sampling_rate=input_sample_rate,
                    is_streaming=True,
                    is_first_audio_chunk=False,
                    language=self._language,
                    return_tensors="pt",
                ).to(model.device, dtype=model.dtype)
                yield inputs.input_features
                mel_index += processor.num_mel_frames_per_audio_chunk
                start = mel_index * hop - n_fft // 2

        streamer = TextIteratorStreamer(
            processor.tokenizer,
            skip_special_tokens=True,
            timeout=_STREAMER_POLL_TIMEOUT_SECONDS,
        )
        failures: list[Exception] = []

        def generate() -> None:
            try:
                generate_kwargs = {
                    **first,
                    "input_features": features(),
                    "streamer": streamer,
                    "stopping_criteria": StoppingCriteriaList([_StopOnEvent(stop_requested)]),
                }
                model.generate(**generate_kwargs)
            except Exception as exc:  # noqa: BLE001 - wake the streamer before re-raising
                failures.append(exc)
                streamer.on_finalized_text("", stream_end=True)
            finally:
                with self._active_lock:
                    self._active_generations.pop(current_thread(), None)

        thread = Thread(target=generate, name="nemotron-generate", daemon=True)
        with self._active_lock:
            if self._closed.is_set() or stop_requested.is_set():
                return
            self._active_generations[thread] = stop_requested
            thread.start()
        try:
            iterator = iter(streamer)
            while True:
                try:
                    text = next(iterator)
                except StopIteration:
                    break
                except Empty:
                    if self._closed.is_set() or stop_requested.is_set():
                        break
                    continue
                yield text
        finally:
            stop_requested.set()
            thread.join(timeout=_GENERATION_JOIN_TIMEOUT_SECONDS)
        if failures:
            raise failures[0]

    def close(self) -> None:
        self._closed.set()
        with self._active_lock:
            active = tuple(self._active_generations.items())
        for _thread, stop_requested in active:
            stop_requested.set()

        deadline = monotonic() + _GENERATION_JOIN_TIMEOUT_SECONDS
        for thread, _stop_requested in active:
            if thread is current_thread():
                continue
            thread.join(timeout=max(0.0, deadline - monotonic()))

        with self._state_lock:
            self._processor = None
            self._model = None
