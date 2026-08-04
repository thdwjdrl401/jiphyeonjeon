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

    def __init__(self, configuration: NemotronNemoRuntimeConfiguration, **kwargs: object) -> None:
        super().__init__(configuration, **kwargs)
        self._provider = "nemotron-nemo"


probe_nemotron_nemo_runtime = probe_vllm_whisper_runtime
nemotron_nemo_runtime_is_ready = vllm_whisper_runtime_is_ready
