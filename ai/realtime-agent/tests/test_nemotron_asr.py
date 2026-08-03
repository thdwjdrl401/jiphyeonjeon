from __future__ import annotations

import builtins
import gc
import sys
from queue import Queue
from threading import Event, Thread
from time import monotonic, sleep
from types import SimpleNamespace
from typing import Any
from weakref import ReferenceType, ref

import numpy as np
import pytest

from app.stt.nemotron_asr import NemotronStreamingASR


class FakeBatch(dict[str, Any]):
    def __init__(self, input_features: np.ndarray) -> None:
        super().__init__(input_features=input_features, num_lookahead_tokens=6)
        self.input_features = input_features

    def to(self, _device: str, *, dtype: str) -> FakeBatch:
        assert dtype == "float32"
        return self


class FakeProcessor:
    def __init__(self) -> None:
        self.feature_extractor = SimpleNamespace(
            sampling_rate=16_000,
            hop_length=160,
            n_fft=400,
        )
        self.num_samples_first_audio_chunk = 320
        self.num_mel_frames_first_audio_chunk = 2
        self.num_samples_per_audio_chunk = 320
        self.num_mel_frames_per_audio_chunk = 2
        self.tokenizer = object()
        self.calls = 0
        self.audio_lengths: list[int] = []
        self.lookahead_tokens: int | None = None

    def set_num_lookahead_tokens(self, value: int) -> None:
        self.lookahead_tokens = value

    def __call__(self, audio: np.ndarray, **kwargs: object) -> FakeBatch:
        self.calls += 1
        self.audio_lengths.append(audio.shape[0])
        assert kwargs["sampling_rate"] == 16_000
        assert kwargs["language"] == "ko-KR"
        return FakeBatch(np.zeros((1, 4, 3), dtype=np.float32))


class FakeStreamer:
    def __init__(
        self,
        _tokenizer: object,
        *,
        skip_special_tokens: bool,
        timeout: float,
    ) -> None:
        assert skip_special_tokens is True
        self._timeout = timeout
        self._items: Queue[str | None] = Queue()

    def on_finalized_text(self, text: str, *, stream_end: bool) -> None:
        if text:
            self._items.put_nowait(text)
        if stream_end:
            self._items.put_nowait(None)

    def __iter__(self) -> FakeStreamer:
        return self

    def __next__(self) -> str:
        item = self._items.get(timeout=self._timeout)
        if item is None:
            raise StopIteration
        return item


class FakeStoppingCriteriaList(list[object]):
    """Stand in for the Transformers stopping-criteria container."""


class FakeModel:
    device = "cpu"
    dtype = "float32"

    def __init__(self) -> None:
        self.generate_calls = 0

    def generate(self, **kwargs: object) -> None:
        self.generate_calls += 1
        assert kwargs["num_lookahead_tokens"] == 6
        stopping_criteria = kwargs["stopping_criteria"]
        assert isinstance(stopping_criteria, list)
        assert not stopping_criteria[0]()  # type: ignore[operator]
        feature_chunks = list(kwargs["input_features"])  # type: ignore[arg-type]
        assert len(feature_chunks) == 2
        streamer = kwargs["streamer"]
        assert isinstance(streamer, FakeStreamer)
        streamer.on_finalized_text("강의 시작", stream_end=True)


def test_public_load_eagerly_initializes_model_once(monkeypatch: pytest.MonkeyPatch) -> None:
    processor = FakeProcessor()
    model = FakeModel()
    processor_loads = 0
    model_loads = 0

    class AutoProcessor:
        @staticmethod
        def from_pretrained(model_id: str) -> FakeProcessor:
            nonlocal processor_loads
            assert model_id == "model"
            processor_loads += 1
            return processor

    class AutoModel:
        @staticmethod
        def from_pretrained(model_id: str, *, device_map: str) -> FakeModel:
            nonlocal model_loads
            assert model_id == "model"
            assert device_map == "auto"
            model_loads += 1
            return model

    monkeypatch.setitem(
        sys.modules,
        "transformers",
        SimpleNamespace(AutoModelForRNNT=AutoModel, AutoProcessor=AutoProcessor),
    )
    adapter = NemotronStreamingASR("model", "ko-KR")

    adapter.load()
    adapter.load()

    assert processor_loads == 1
    assert model_loads == 1
    assert processor.lookahead_tokens == 6
    adapter.close()


def test_transformers_adapter_overrides_batch_input_features_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setitem(
        sys.modules,
        "transformers",
        SimpleNamespace(
            StoppingCriteriaList=FakeStoppingCriteriaList,
            TextIteratorStreamer=FakeStreamer,
        ),
    )
    processor = FakeProcessor()
    model = FakeModel()
    adapter = NemotronStreamingASR("model", "ko-KR")
    adapter._processor = processor
    adapter._model = model

    result = list(
        adapter.transcribe_stream(
            np.zeros(640, dtype=np.int16),
            16_000,
        )
    )

    assert result == ["강의 시작"]
    assert processor.calls == 2
    assert model.generate_calls == 1


def test_short_audio_is_padded_to_the_required_first_chunk(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class ShortAudioModel(FakeModel):
        def generate(self, **kwargs: object) -> None:
            self.generate_calls += 1
            feature_chunks = list(kwargs["input_features"])  # type: ignore[arg-type]
            assert len(feature_chunks) == 1
            streamer = kwargs["streamer"]
            assert isinstance(streamer, FakeStreamer)
            streamer.on_finalized_text("짧은 발화", stream_end=True)

    monkeypatch.setitem(
        sys.modules,
        "transformers",
        SimpleNamespace(
            StoppingCriteriaList=FakeStoppingCriteriaList,
            TextIteratorStreamer=FakeStreamer,
        ),
    )
    processor = FakeProcessor()
    model = ShortAudioModel()
    adapter = NemotronStreamingASR("model", "ko-KR")
    adapter._processor = processor
    adapter._model = model

    result = list(adapter.transcribe_stream(np.zeros(100, dtype=np.int16), 16_000))

    assert result == ["짧은 발화"]
    assert processor.calls == 1
    assert processor.audio_lengths == [processor.num_samples_first_audio_chunk]
    assert model.generate_calls == 1


def test_external_stop_unblocks_streamer_without_waiting_for_generate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    release_generate = Event()
    generate_exited = Event()

    class UncooperativeModel(FakeModel):
        def generate(self, **kwargs: object) -> None:
            streamer = kwargs["streamer"]
            assert isinstance(streamer, FakeStreamer)
            streamer.on_finalized_text("partial", stream_end=False)
            release_generate.wait(timeout=2)
            streamer.on_finalized_text("", stream_end=True)
            generate_exited.set()

    monkeypatch.setitem(
        sys.modules,
        "transformers",
        SimpleNamespace(
            StoppingCriteriaList=FakeStoppingCriteriaList,
            TextIteratorStreamer=FakeStreamer,
        ),
    )
    adapter = NemotronStreamingASR("model", "ko-KR")
    adapter._processor = FakeProcessor()
    adapter._model = UncooperativeModel()
    stop_requested = Event()
    transcript = adapter.transcribe_stream(
        np.zeros(640, dtype=np.int16),
        16_000,
        stop_requested,
    )
    assert next(transcript) == "partial"

    consumer_exited = Event()

    def consume_remainder() -> None:
        list(transcript)
        consumer_exited.set()

    consumer = Thread(target=consume_remainder, daemon=True)
    started_at = monotonic()
    consumer.start()
    stop_requested.set()

    assert consumer_exited.wait(timeout=0.8)
    assert monotonic() - started_at < 0.8
    assert not release_generate.is_set()
    assert not generate_exited.is_set()

    release_generate.set()
    assert generate_exited.wait(timeout=0.5)
    consumer.join(timeout=0.5)
    adapter.close()


def test_generator_close_cooperatively_stops_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    generate_exited = Event()

    class CooperativeModel(FakeModel):
        def generate(self, **kwargs: object) -> None:
            streamer = kwargs["streamer"]
            stopping_criteria = kwargs["stopping_criteria"]
            assert isinstance(streamer, FakeStreamer)
            assert isinstance(stopping_criteria, list)
            streamer.on_finalized_text("partial", stream_end=False)
            while not stopping_criteria[0]():  # type: ignore[operator]
                sleep(0.005)
            streamer.on_finalized_text("", stream_end=True)
            generate_exited.set()

    monkeypatch.setitem(
        sys.modules,
        "transformers",
        SimpleNamespace(
            StoppingCriteriaList=FakeStoppingCriteriaList,
            TextIteratorStreamer=FakeStreamer,
        ),
    )
    adapter = NemotronStreamingASR("model", "ko-KR")
    adapter._processor = FakeProcessor()
    adapter._model = CooperativeModel()
    transcript = adapter.transcribe_stream(np.zeros(640, dtype=np.int16), 16_000)

    assert next(transcript) == "partial"
    transcript.close()

    assert generate_exited.wait(timeout=0.2)
    adapter.close()


def test_close_during_lazy_load_never_assigns_late_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model_load_started = Event()
    allow_model_return = Event()
    loaded_model_ref: list[ReferenceType[FakeModel]] = []
    processor = FakeProcessor()

    class AutoProcessor:
        @staticmethod
        def from_pretrained(_model_id: str) -> FakeProcessor:
            return processor

    class AutoModel:
        @staticmethod
        def from_pretrained(_model_id: str, *, device_map: str) -> FakeModel:
            assert device_map == "auto"
            model = FakeModel()
            loaded_model_ref.append(ref(model))
            model_load_started.set()
            if not allow_model_return.wait(timeout=2):
                raise TimeoutError("test did not release model loader")
            return model

    monkeypatch.setitem(
        sys.modules,
        "transformers",
        SimpleNamespace(
            AutoModelForRNNT=AutoModel,
            AutoProcessor=AutoProcessor,
            TextIteratorStreamer=FakeStreamer,
        ),
    )
    adapter = NemotronStreamingASR("model", "ko-KR")
    load_error: list[str] = []

    def start_transcription() -> None:
        try:
            list(adapter.transcribe_stream(np.zeros(640, dtype=np.int16), 16_000))
        except RuntimeError as exc:
            load_error.append(str(exc))

    loader = Thread(target=start_transcription, daemon=True)
    loader.start()
    assert model_load_started.wait(timeout=0.5)

    started_at = monotonic()
    adapter.close()
    assert monotonic() - started_at < 0.2
    assert not allow_model_return.is_set()

    allow_model_return.set()
    loader.join(timeout=0.5)
    assert not loader.is_alive()
    assert load_error == ["Nemotron recognizer closed while loading"]
    assert adapter._processor is None
    assert adapter._model is None
    gc.collect()
    assert loaded_model_ref[0]() is None


def test_missing_optional_dependencies_raise_actionable_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_import = builtins.__import__

    def reject_transformers(name: str, *args: object, **kwargs: object) -> object:
        if name == "transformers":
            raise ModuleNotFoundError("No module named 'transformers'", name="transformers")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", reject_transformers)

    with pytest.raises(RuntimeError, match="uv sync --extra nemotron"):
        NemotronStreamingASR("model", "ko-KR")._ensure_loaded()
