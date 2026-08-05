"""Prepare isolated NVIDIA NeMo manifests for Nemotron ASR fine-tuning.

The source AIHub manifests remain immutable. This module converts only the
speaker-disjoint train/dev splits and deliberately has no test-manifest input.
"""

from __future__ import annotations

import hashlib
import json
import math
import tarfile
import wave
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Protocol

from stt_lab.training import TrainingDataset, TrainingDatasetPair

EXPECTED_SAMPLE_RATE = 16_000
EXPECTED_CHANNELS = 1
EXPECTED_SAMPLE_WIDTH = 2
EXPECTED_MODEL_CLASS = (
    "nemo.collections.asr.models.rnnt_bpe_models_prompt.EncDecRNNTBPEModelWithPrompt"
)
EXPECTED_MODEL_SHA256 = "210214ed94039bf6bfbb9a047c7fa289628db75b103e2bf6381fa78285436a74"
EXPECTED_NEMO_VERSION = "2.8.0rc0"
EXPECTED_ENCODER_LAYERS = 24
EXPECTED_SUBSAMPLING_FACTOR = 8
EXPECTED_WINDOW_STRIDE_SECONDS = 0.01
EXPECTED_KOREAN_PROMPT_ID = 14
EXPECTED_TOKENIZER_SHA256 = "ce3895e40806f02a26c3a225161b96ef682d6c0054bae32a245dec4258d7d291"
PROMPT_MODE = "langID"


class Tokenizer(Protocol):
    """Small tokenizer surface needed by manifest validation."""

    unk_token_id: int

    def encode(self, text: str) -> list[int]: ...


@dataclass(frozen=True)
class TokenizerContract:
    archive_member: str
    sha256: str
    vocabulary_size: int
    unknown_token_id: int


class _SentencePieceTokenizer:
    def __init__(self, processor: Any, *, unknown_token_id: int) -> None:
        self._processor = processor
        self.unk_token_id = unknown_token_id

    def encode(self, text: str) -> list[int]:
        return list(self._processor.encode(text, out_type=int))


@dataclass(frozen=True)
class PreparationPolicy:
    target_language: str = "ko-KR"
    max_duration_ms: int = 20_000
    max_token_frame_ratio: float = 1.0


@dataclass(frozen=True)
class ModelContract:
    target_class: str
    sample_rate: int
    encoder_layers: int
    subsampling_factor: int
    feature_window_stride_seconds: float
    korean_prompt_id: int
    nemo_version: str | None


@dataclass(frozen=True)
class PreparedSplit:
    source_manifest: str
    source_manifest_sha256: str
    source_count: int
    selected_count: int
    selected_duration_hours: float
    exclusions: dict[str, int]


@dataclass(frozen=True)
class PreparationReport:
    model_path: str
    model_sha256: str
    model_contract: ModelContract
    tokenizer_contract: TokenizerContract
    policy: PreparationPolicy
    train: PreparedSplit
    dev: PreparedSplit
    outputs: dict[str, str]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_model_config(model_path: Path) -> Mapping[str, Any]:
    try:
        import yaml
    except ImportError as exc:  # pragma: no cover - environment guard
        raise RuntimeError("PyYAML is required to inspect the .nemo model") from exc

    with tarfile.open(model_path, mode="r:*") as archive:
        try:
            member = archive.getmember("./model_config.yaml")
        except KeyError:
            member = archive.getmember("model_config.yaml")
        extracted = archive.extractfile(member)
        if extracted is None:
            raise ValueError(f"model_config.yaml could not be read from {model_path}")
        config = yaml.safe_load(extracted)
    if not isinstance(config, Mapping):
        raise TypeError(f"invalid model_config.yaml in {model_path}")
    return config


def _load_tokenizer(model_path: Path) -> tuple[Tokenizer, TokenizerContract]:
    try:
        import sentencepiece as spm
    except ImportError as exc:  # pragma: no cover - environment guard
        raise RuntimeError("sentencepiece is required to inspect the .nemo tokenizer") from exc

    with tarfile.open(model_path, mode="r:*") as archive:
        candidates = [
            member
            for member in archive.getmembers()
            if member.isfile()
            and (
                Path(member.name).name == "tokenizer.model"
                or Path(member.name).name.endswith("_tokenizer.model")
            )
        ]
        if len(candidates) != 1:
            names = [member.name for member in candidates]
            raise ValueError(f"expected exactly one SentencePiece model in {model_path}: {names}")
        member = candidates[0]
        extracted = archive.extractfile(member)
        if extracted is None:
            raise ValueError(f"tokenizer could not be read from {model_path}")
        model_proto = extracted.read()

    processor = spm.SentencePieceProcessor(model_proto=model_proto)
    contract = TokenizerContract(
        archive_member=member.name,
        sha256=hashlib.sha256(model_proto).hexdigest(),
        vocabulary_size=int(processor.get_piece_size()),
        unknown_token_id=int(processor.unk_id()),
    )
    if (
        contract.sha256 != EXPECTED_TOKENIZER_SHA256
        or contract.vocabulary_size != 13_087
        or contract.unknown_token_id != 0
    ):
        raise ValueError(f"unexpected Nemotron tokenizer contract: {contract}")
    return (
        _SentencePieceTokenizer(
            processor,
            unknown_token_id=contract.unknown_token_id,
        ),
        contract,
    )


def validate_model_contract(model_path: Path) -> ModelContract:
    """Fail closed when the checkpoint is not the pinned Korean prompt RNNT."""

    config = _load_model_config(model_path)
    target_class = str(config.get("target", ""))
    sample_rate = int(config.get("sample_rate", 0))
    encoder = config.get("encoder")
    if not isinstance(encoder, Mapping):
        raise TypeError("model encoder configuration is missing")
    encoder_layers = int(encoder.get("n_layers", 0))
    subsampling_factor = int(encoder.get("subsampling_factor", 0))

    preprocessor = config.get("preprocessor")
    if not isinstance(preprocessor, Mapping):
        raise TypeError("model preprocessor configuration is missing")
    feature_window_stride_seconds = float(preprocessor.get("window_stride", 0))

    model_defaults = config.get("model_defaults")
    if not isinstance(model_defaults, Mapping):
        raise TypeError("model_defaults configuration is missing")
    prompt_dictionary = model_defaults.get("prompt_dictionary")
    if not isinstance(prompt_dictionary, Mapping):
        raise TypeError("model prompt_dictionary is missing")
    korean_prompt_id = int(prompt_dictionary.get("ko-KR", -1))

    contract = ModelContract(
        target_class=target_class,
        sample_rate=sample_rate,
        encoder_layers=encoder_layers,
        subsampling_factor=subsampling_factor,
        feature_window_stride_seconds=feature_window_stride_seconds,
        korean_prompt_id=korean_prompt_id,
        nemo_version=(str(config["nemo_version"]) if config.get("nemo_version") else None),
    )
    expected = ModelContract(
        target_class=EXPECTED_MODEL_CLASS,
        sample_rate=EXPECTED_SAMPLE_RATE,
        encoder_layers=EXPECTED_ENCODER_LAYERS,
        subsampling_factor=EXPECTED_SUBSAMPLING_FACTOR,
        feature_window_stride_seconds=EXPECTED_WINDOW_STRIDE_SECONDS,
        korean_prompt_id=EXPECTED_KOREAN_PROMPT_ID,
        nemo_version=EXPECTED_NEMO_VERSION,
    )
    if contract != expected:
        raise ValueError(f"unexpected Nemotron model contract: {contract}")
    return contract


def _validate_wave(audio_path: Path) -> None:
    with wave.open(str(audio_path), "rb") as wav:
        actual = (wav.getframerate(), wav.getnchannels(), wav.getsampwidth())
    expected = (EXPECTED_SAMPLE_RATE, EXPECTED_CHANNELS, EXPECTED_SAMPLE_WIDTH)
    if actual != expected:
        raise ValueError(f"unsupported WAV format {actual}; expected {expected}")


def _approx_encoder_frames(duration_ms: int) -> int:
    # The checkpoint consumes 10 ms feature frames and subsamples them by 8.
    return max(1, math.ceil(math.ceil(duration_ms / 10) / 8))


def _prepare_split(
    dataset: TrainingDataset,
    tokenizer: Tokenizer,
    policy: PreparationPolicy,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], PreparedSplit]:
    rows: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()

    for example in dataset.examples:
        reason: str | None = None
        token_count: int | None = None
        frame_count: int | None = None

        if example.language != policy.target_language:
            reason = "language_mismatch"
        elif not example.transcript.strip():
            reason = "empty_transcript"
        elif example.duration_ms > policy.max_duration_ms:
            reason = "duration_over_limit"
        elif not example.audio_path.is_file():
            reason = "missing_audio"
        else:
            try:
                _validate_wave(example.audio_path)
            except (ValueError, wave.Error, EOFError):
                reason = "invalid_audio_format"

        token_ids: list[int] = []
        if reason is None:
            token_ids = tokenizer.encode(example.transcript)
            token_count = len(token_ids)
            if not token_ids:
                reason = "empty_token_sequence"
            elif tokenizer.unk_token_id in token_ids:
                reason = "tokenizer_unknown"

        if reason is None:
            frame_count = _approx_encoder_frames(example.duration_ms)
            if len(token_ids) / frame_count > policy.max_token_frame_ratio:
                reason = "token_frame_ratio"

        if reason is not None:
            counts[reason] += 1
            excluded.append(
                {
                    "id": example.example_id,
                    "split": dataset.split,
                    "reason": reason,
                    "durationMs": example.duration_ms,
                    "tokenCount": token_count,
                    "approxEncoderFrames": frame_count,
                }
            )
            continue

        rows.append(
            {
                "id": example.example_id,
                "audio_filepath": str(example.audio_path.resolve()),
                "duration": example.duration_ms / 1000,
                "text": example.transcript,
                "lang": policy.target_language,
                "target_lang": policy.target_language,
                "prompt_mode": PROMPT_MODE,
                "sampling_rate": EXPECTED_SAMPLE_RATE,
            }
        )

    report = PreparedSplit(
        source_manifest=str(dataset.manifest_path.resolve()),
        source_manifest_sha256=dataset.manifest_sha256,
        source_count=len(dataset.examples),
        selected_count=len(rows),
        selected_duration_hours=sum(float(row["duration"]) for row in rows) / 3600,
        exclusions=dict(sorted(counts.items())),
    )
    return rows, excluded, report


def _write_jsonl(path: Path, rows: Iterable[Mapping[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
            handle.write("\n")


def prepare_nemotron_manifests(
    pair: TrainingDatasetPair,
    model_path: Path,
    output_dir: Path,
    policy: PreparationPolicy | None = None,
) -> PreparationReport:
    """Create immutable train/dev-only manifests accepted by NeMo/Lhotse."""

    if output_dir.exists():
        raise FileExistsError(f"refusing to overwrite output directory: {output_dir}")
    if pair.train.split != "train" or pair.dev.split != "dev":
        raise ValueError("Nemotron preparation accepts only train/dev splits")
    if policy is None:
        policy = PreparationPolicy()
    if policy.max_duration_ms <= 0 or policy.max_token_frame_ratio <= 0:
        raise ValueError(f"invalid preparation policy: {policy}")

    model_path = model_path.resolve()
    model_sha256 = _sha256(model_path)
    if model_sha256 != EXPECTED_MODEL_SHA256:
        raise ValueError(f"unexpected Nemotron model SHA-256: {model_sha256}")
    model_contract = validate_model_contract(model_path)
    tokenizer, tokenizer_contract = _load_tokenizer(model_path)
    train_rows, train_excluded, train_report = _prepare_split(pair.train, tokenizer, policy)
    dev_rows, dev_excluded, dev_report = _prepare_split(pair.dev, tokenizer, policy)
    if not train_rows or not dev_rows:
        raise ValueError("prepared train/dev manifests must both be non-empty")

    output_dir.mkdir(parents=True)
    train_path = output_dir / "train.nemo.jsonl"
    dev_path = output_dir / "dev.nemo.jsonl"
    excluded_path = output_dir / "excluded.jsonl"
    report_path = output_dir / "preparation-report.json"
    _write_jsonl(train_path, train_rows)
    _write_jsonl(dev_path, dev_rows)
    _write_jsonl(excluded_path, [*train_excluded, *dev_excluded])

    report = PreparationReport(
        model_path=str(model_path),
        model_sha256=model_sha256,
        model_contract=model_contract,
        tokenizer_contract=tokenizer_contract,
        policy=policy,
        train=train_report,
        dev=dev_report,
        outputs={
            "train": str(train_path.resolve()),
            "dev": str(dev_path.resolve()),
            "excluded": str(excluded_path.resolve()),
        },
    )
    report_path.write_text(
        json.dumps(asdict(report), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return report
