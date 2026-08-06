from __future__ import annotations

from app.stt.providers.vllm_whisper import (
    VllmWhisperRuntimeConfiguration,
    VllmWhisperStreamingEngine,
    probe_vllm_whisper_runtime,
    vllm_whisper_runtime_is_ready,
)

NemotronNemoRuntimeConfiguration = VllmWhisperRuntimeConfiguration


class NemotronNemoStreamingEngine(VllmWhisperStreamingEngine):
    """Transcribe complete VAD segments with a tuned NeMo model owner."""

    # The NeMo model owner answers with one complete transcript, not a token stream,
    # so it carries no terminal finish reason to gate on. The output gates that read
    # the text itself still apply.
    _uses_streaming_transcription = False

    # ADR-0087 calibrated its output gates on Whisper. The tuned NeMo checkpoint has
    # its own failure modes and its own benchmark, so it keeps the empty-output check
    # only until thresholds are measured for it.
    _applies_hallucination_gates = False

    def __init__(self, configuration: NemotronNemoRuntimeConfiguration, **kwargs: object) -> None:
        super().__init__(configuration, **kwargs)
        self._provider = "nemotron-nemo"


probe_nemotron_nemo_runtime = probe_vllm_whisper_runtime
nemotron_nemo_runtime_is_ready = vllm_whisper_runtime_is_ready
