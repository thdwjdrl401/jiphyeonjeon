import pytest
from pydantic import ValidationError

from app.recorded_stt.config import RecordedSttSettings


def _settings(**overrides: object) -> RecordedSttSettings:
    values = {
        "instance_id": "recorded-stt-test-1",
        "rabbitmq_url": "amqp://guest:guest@localhost:5672/",
        "source_hmac_secret": "source-secret",
        "callback_hmac_secret": "callback-secret",
        "openai_api_key": "openai-secret",
        **overrides,
    }
    return RecordedSttSettings(**values)  # type: ignore[arg-type]


def test_uses_official_openai_and_readable_cue_defaults() -> None:
    settings = _settings()

    assert settings.openai_base_url == "https://api.openai.com/v1"
    assert settings.model == "whisper-1"
    assert settings.cue_max_duration_ms == 6000
    assert settings.cue_max_chars == 42
    assert settings.cue_pause_break_ms == 500


def test_rejects_a_pause_boundary_longer_than_the_cue() -> None:
    with pytest.raises(ValidationError, match="cue pause boundary"):
        _settings(cue_pause_break_ms=2000, cue_max_duration_ms=1500)
