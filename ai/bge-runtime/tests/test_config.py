import pytest
from pydantic import ValidationError

from app.config import Settings
from app.embedding import BGE_M3_REVISION

TOKEN = "x" * 32


def test_defaults_pin_full_immutable_revision_and_admission_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in (
        "BGE_RUNTIME_HOST",
        "BGE_RUNTIME_REVISION",
        "BGE_RUNTIME_MAX_INFLIGHT_REQUESTS",
    ):
        monkeypatch.delenv(name, raising=False)

    settings = Settings(internal_token=TOKEN)

    assert settings.host == "127.0.0.1"
    assert settings.revision == BGE_M3_REVISION
    assert len(settings.revision) == 40
    assert settings.batch_size == 4
    assert settings.max_batch_size == 4
    assert settings.max_inflight_requests == 8
    assert settings.max_text_chars == 4_000
    assert settings.max_request_body_bytes == 128 * 1024
    assert settings.request_body_timeout_seconds == 5.0


@pytest.mark.parametrize(
    "device",
    ["CPU", "CUDA", "cuda0", "cuda:", "cuda:-1", "cuda:01", "cuda:1.0", "cuda:0:1", " cuda"],
)
def test_settings_rejects_noncanonical_device(device: str) -> None:
    with pytest.raises(ValidationError, match="canonical non-negative"):
        Settings(internal_token=TOKEN, device=device)


@pytest.mark.parametrize("device", ["cpu", "cuda", "cuda:0", "cuda:12"])
def test_settings_accepts_canonical_device(device: str) -> None:
    assert Settings(internal_token=TOKEN, device=device).device == device


@pytest.mark.parametrize("revision", ["5617a9f", "main", "A" * 40, "0" * 39, "0" * 41])
def test_settings_rejects_mutable_or_noncanonical_revision(revision: str) -> None:
    with pytest.raises(ValidationError):
        Settings(internal_token=TOKEN, revision=revision)


def test_settings_rejects_encoder_batch_larger_than_request_limit() -> None:
    with pytest.raises(ValidationError, match="batch_size must not exceed max_batch_size"):
        Settings(internal_token=TOKEN, batch_size=9, max_batch_size=8)


@pytest.mark.parametrize(
    ("field", "value"),
    [("host", " "), ("host", " localhost"), ("model", "\t"), ("model", "model ")],
)
def test_settings_rejects_blank_or_padded_host_and_model(field: str, value: str) -> None:
    with pytest.raises(ValidationError, match="blank or have surrounding whitespace"):
        Settings(internal_token=TOKEN, **{field: value})


@pytest.mark.parametrize("token", [" " * 32, f" {TOKEN}", f"{TOKEN} "])
def test_settings_rejects_blank_or_padded_internal_token(token: str) -> None:
    with pytest.raises(ValidationError, match="internal_token"):
        Settings(internal_token=token)


@pytest.mark.parametrize("limit", [0, 65])
def test_settings_bounds_inflight_request_limit(limit: int) -> None:
    with pytest.raises(ValidationError):
        Settings(internal_token=TOKEN, max_inflight_requests=limit)
