from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import random
import sys
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any

from stt_lab.audio import read_pcm16_mono_wav
from stt_lab.contracts import EvaluationClip, load_manifest
from stt_lab.metrics import has_unresolved_dual_transcription


@dataclass(frozen=True)
class TrainingSelection:
    clips: tuple[EvaluationClip, ...]
    duration_ms: int
    excluded_too_long: int
    excluded_missing_duration: int
    excluded_invalid_reference: int


@dataclass(frozen=True)
class TrainingConfig:
    base_model: str
    train_manifest: str
    eval_manifest: str | None
    output_dir: str
    cuda_visible_devices: str
    precision: str
    epochs: int
    max_steps: int | None
    batch_size: int
    gradient_accumulation_steps: int
    log_every_steps: int
    learning_rate: float
    warmup_ratio: float
    weight_decay: float
    max_grad_norm: float
    lora_rank: int
    lora_alpha: int
    lora_dropout: float
    target_modules: tuple[str, ...]
    seed: int
    max_train_audio_hours: float | None
    max_train_clips: int | None
    max_duration_ms: int
    eval_limit: int


class WhisperBatchCollator:
    def __init__(
        self,
        processor: Any,
        *,
        max_target_positions: int,
        decoder_start_token_id: int | None,
    ) -> None:
        self._processor = processor
        self._max_target_positions = max_target_positions
        self._decoder_start_token_id = decoder_start_token_id

    def __call__(self, clips: Sequence[EvaluationClip]) -> dict[str, Any]:
        import torch

        audio_arrays = []
        for clip in clips:
            audio = read_pcm16_mono_wav(clip.audio_path, expected_sha256=clip.sha256)
            audio_arrays.append(audio.samples.astype("float32") / 32768.0)

        features = self._processor.feature_extractor(
            audio_arrays,
            sampling_rate=16_000,
            return_attention_mask=True,
            return_tensors="pt",
        )
        tokenized = self._processor.tokenizer(
            [clip.training_reference for clip in clips],
            padding=True,
            return_tensors="pt",
        )
        labels = tokenized.input_ids.masked_fill(tokenized.attention_mask.ne(1), -100)
        if (
            self._decoder_start_token_id is not None
            and labels.shape[1] > 0
            and torch.all(labels[:, 0].eq(self._decoder_start_token_id)).item()
        ):
            labels = labels[:, 1:]
        if labels.shape[1] > self._max_target_positions:
            raise ValueError(
                "training label exceeds Whisper max_target_positions for clips: "
                + ", ".join(clip.clip_id for clip in clips)
            )

        batch = {"input_features": features.input_features, "labels": labels}
        if "attention_mask" in features:
            batch["attention_mask"] = features.attention_mask
        return batch


def select_training_clips(
    clips: Sequence[EvaluationClip],
    *,
    max_audio_hours: float | None,
    max_clips: int | None,
    max_duration_ms: int,
    seed: int,
) -> TrainingSelection:
    eligible: list[tuple[EvaluationClip, int]] = []
    excluded_too_long = 0
    excluded_missing_duration = 0
    excluded_invalid_reference = 0
    for clip in clips:
        if clip.split != "train":
            continue
        if has_unresolved_dual_transcription(clip.training_reference):
            excluded_invalid_reference += 1
            continue

        duration_ms = clip.duration_ms
        if duration_ms is None:
            excluded_missing_duration += 1
            continue
        if duration_ms > max_duration_ms:
            excluded_too_long += 1
            continue
        eligible.append((clip, duration_ms))

    if not eligible:
        raise ValueError("no eligible train clips with duration metadata")

    grouped: dict[tuple[str, str, str], list[tuple[EvaluationClip, int]]] = defaultdict(list)
    for clip, duration_ms in eligible:
        grouped[(clip.category or "", clip.speaker_id, clip.lecture_id or "")].append(
            (clip, duration_ms)
        )

    randomizer = random.Random(seed)
    group_keys = sorted(grouped)
    randomizer.shuffle(group_keys)
    for key in group_keys:
        grouped[key].sort(key=lambda item: item[0].clip_id)
        randomizer.shuffle(grouped[key])

    round_robin: list[tuple[EvaluationClip, int]] = []
    while any(grouped.values()):
        for key in group_keys:
            if grouped[key]:
                round_robin.append(grouped[key].pop())

    budget_ms = None if max_audio_hours is None else round(max_audio_hours * 3_600_000)
    selected: list[EvaluationClip] = []
    selected_duration_ms = 0
    for clip, duration_ms in round_robin:
        if max_clips is not None and len(selected) >= max_clips:
            break
        if budget_ms is not None and selected_duration_ms + duration_ms > budget_ms:
            continue
        selected.append(clip)
        selected_duration_ms += duration_ms

    if not selected:
        raise ValueError("training budget did not admit any clip")
    return TrainingSelection(
        clips=tuple(selected),
        duration_ms=selected_duration_ms,
        excluded_too_long=excluded_too_long,
        excluded_missing_duration=excluded_missing_duration,
        excluded_invalid_reference=excluded_invalid_reference,
    )


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    os.environ["CUDA_VISIBLE_DEVICES"] = args.cuda_visible_devices
    train_manifest = args.train_manifest.resolve()
    eval_manifest = args.eval_manifest.resolve() if args.eval_manifest is not None else None
    train_clips = load_manifest(train_manifest)
    selection = select_training_clips(
        train_clips,
        max_audio_hours=args.max_train_audio_hours,
        max_clips=args.max_train_clips,
        max_duration_ms=args.max_duration_ms,
        seed=args.seed,
    )
    eval_clips = _select_eval_clips(
        eval_manifest,
        limit=args.eval_limit,
        max_duration_ms=args.max_duration_ms,
    )
    selection_report = _selection_report(selection, train_manifest, eval_clips)
    if args.dry_run:
        print(json.dumps(selection_report, ensure_ascii=False))
        return 0

    output_dir = args.output_dir.resolve()
    _require_empty_output(output_dir)
    output_dir.mkdir(parents=True)
    config = TrainingConfig(
        base_model=str(args.base_model.resolve()),
        train_manifest=str(train_manifest),
        eval_manifest=str(eval_manifest) if eval_manifest is not None else None,
        output_dir=str(output_dir),
        cuda_visible_devices=args.cuda_visible_devices,
        precision=args.precision,
        epochs=args.epochs,
        max_steps=args.max_steps,
        batch_size=args.batch_size,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        log_every_steps=args.log_every_steps,
        learning_rate=args.learning_rate,
        warmup_ratio=args.warmup_ratio,
        weight_decay=args.weight_decay,
        max_grad_norm=args.max_grad_norm,
        lora_rank=args.lora_rank,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        target_modules=args.target_modules,
        seed=args.seed,
        max_train_audio_hours=args.max_train_audio_hours,
        max_train_clips=args.max_train_clips,
        max_duration_ms=args.max_duration_ms,
        eval_limit=args.eval_limit,
    )
    report = _train(config, selection, eval_clips, train_manifest)
    (output_dir / "training-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report["summary"], ensure_ascii=False))
    return 0


def _train(
    config: TrainingConfig,
    selection: TrainingSelection,
    eval_clips: tuple[EvaluationClip, ...],
    train_manifest: Path,
) -> dict[str, Any]:
    import torch
    from peft import LoraConfig, TaskType
    from torch.utils.data import DataLoader
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
    from transformers.optimization import get_linear_schedule_with_warmup

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for Whisper large-v3 LoRA training")
    torch.manual_seed(config.seed)
    torch.cuda.manual_seed_all(config.seed)
    torch.backends.cuda.matmul.allow_tf32 = True

    dtype = {"bfloat16": torch.bfloat16, "float32": torch.float32}[config.precision]
    processor = AutoProcessor.from_pretrained(config.base_model, local_files_only=True)
    processor.tokenizer.set_prefix_tokens(
        language="korean",
        task="transcribe",
        predict_timestamps=False,
    )
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        config.base_model,
        dtype=dtype,
        low_cpu_mem_usage=True,
        local_files_only=True,
    )
    preflight = _preflight_inputs(
        processor,
        (*selection.clips, *eval_clips),
        max_duration_ms=config.max_duration_ms,
        max_target_positions=int(model.config.max_target_positions),
        decoder_start_token_id=model.config.decoder_start_token_id,
    )
    _emit_progress("preflight.completed", **preflight)
    model.config.use_cache = False
    model.add_adapter(
        LoraConfig(
            task_type=TaskType.SEQ_2_SEQ_LM,
            r=config.lora_rank,
            lora_alpha=config.lora_alpha,
            lora_dropout=config.lora_dropout,
            target_modules=list(config.target_modules),
            bias="none",
        )
    )
    model.gradient_checkpointing_enable()
    if hasattr(model, "enable_input_require_grads"):
        model.enable_input_require_grads()
    model.to("cuda:0")
    model.train()

    collator = WhisperBatchCollator(
        processor,
        max_target_positions=int(model.config.max_target_positions),
        decoder_start_token_id=model.config.decoder_start_token_id,
    )
    generator = torch.Generator().manual_seed(config.seed)
    train_loader = DataLoader(
        selection.clips,
        batch_size=config.batch_size,
        shuffle=True,
        collate_fn=collator,
        num_workers=0,
        generator=generator,
    )
    eval_loader = (
        DataLoader(
            eval_clips,
            batch_size=config.batch_size,
            shuffle=False,
            collate_fn=collator,
            num_workers=0,
        )
        if eval_clips
        else None
    )

    trainable_parameters = [
        parameter for parameter in model.parameters() if parameter.requires_grad
    ]
    trainable_count = sum(parameter.numel() for parameter in trainable_parameters)
    total_count = sum(parameter.numel() for parameter in model.parameters())
    optimizer = torch.optim.AdamW(
        trainable_parameters,
        lr=config.learning_rate,
        weight_decay=config.weight_decay,
    )
    updates_per_epoch = math.ceil(len(train_loader) / config.gradient_accumulation_steps)
    planned_steps = updates_per_epoch * config.epochs
    total_steps = min(planned_steps, config.max_steps) if config.max_steps else planned_steps
    warmup_steps = round(total_steps * config.warmup_ratio)
    scheduler = get_linear_schedule_with_warmup(
        optimizer,
        num_warmup_steps=warmup_steps,
        num_training_steps=total_steps,
    )
    _emit_progress(
        "training.started",
        totalSteps=total_steps,
        trainBatches=len(train_loader),
        effectiveBatchSize=config.batch_size * config.gradient_accumulation_steps,
        trainableParameters=trainable_count,
    )

    started_at = datetime.now(UTC)
    started = perf_counter()
    optimizer.zero_grad(set_to_none=True)
    global_step = 0
    history: list[dict[str, Any]] = []
    stop = False
    for epoch in range(1, config.epochs + 1):
        epoch_losses: list[float] = []
        for batch_index, batch in enumerate(train_loader, start=1):
            batch = _move_batch(batch, dtype=dtype)
            with torch.autocast(
                device_type="cuda",
                dtype=dtype,
                enabled=config.precision == "bfloat16",
            ):
                loss = model(**batch).loss
                accumulation_start = (
                    (batch_index - 1) // config.gradient_accumulation_steps
                ) * config.gradient_accumulation_steps
                accumulation_size = min(
                    config.gradient_accumulation_steps, len(train_loader) - accumulation_start
                )
                scaled_loss = loss / accumulation_size
            scaled_loss.backward()
            epoch_losses.append(float(loss.detach().cpu()))

            should_update = (
                batch_index % config.gradient_accumulation_steps == 0
                or batch_index == len(train_loader)
            )
            if not should_update:
                continue
            torch.nn.utils.clip_grad_norm_(trainable_parameters, config.max_grad_norm)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad(set_to_none=True)
            global_step += 1
            if (
                global_step == 1
                or global_step % config.log_every_steps == 0
                or global_step == total_steps
            ):
                elapsed_seconds = perf_counter() - started
                seconds_per_step = elapsed_seconds / global_step
                _emit_progress(
                    "training.progress",
                    epoch=epoch,
                    globalStep=global_step,
                    totalSteps=total_steps,
                    loss=epoch_losses[-1],
                    elapsedSeconds=elapsed_seconds,
                    etaSeconds=max(total_steps - global_step, 0) * seconds_per_step,
                    peakCudaAllocatedBytes=torch.cuda.max_memory_allocated(),
                )
            if config.max_steps is not None and global_step >= config.max_steps:
                stop = True
                break

        _emit_progress("evaluation.started", epoch=epoch, evalBatches=len(eval_loader or ()))
        eval_loss = _evaluate_loss(model, eval_loader, dtype=dtype)
        _emit_progress("evaluation.completed", epoch=epoch, meanEvalLoss=eval_loss)
        history.append(
            {
                "epoch": epoch,
                "globalStep": global_step,
                "meanTrainLoss": sum(epoch_losses) / len(epoch_losses),
                "meanEvalLoss": eval_loss,
            }
        )
        _save_adapter(model, processor, Path(config.output_dir) / f"checkpoint-epoch-{epoch}")
        if stop:
            break

    _save_adapter(model, processor, Path(config.output_dir) / "adapter-final")
    elapsed_seconds = perf_counter() - started
    completed_at = datetime.now(UTC)
    return {
        "schemaVersion": 1,
        "createdAt": completed_at.isoformat(),
        "startedAt": started_at.isoformat(),
        "config": asdict(config),
        "dataset": {
            **_selection_report(selection, train_manifest, eval_clips),
            "manifestSha256": _sha256(train_manifest),
            "selectedClipIdsSha256": hashlib.sha256(
                "\n".join(clip.clip_id for clip in selection.clips).encode()
            ).hexdigest(),
        },
        "runtime": {
            "pythonVersion": platform.python_version(),
            "torchVersion": torch.__version__,
            "cudaDevice": torch.cuda.get_device_name(0),
            "cudaVisibleDevices": config.cuda_visible_devices,
            "trainableParameters": trainable_count,
            "totalParameters": total_count,
            "trainablePercent": trainable_count / total_count * 100,
            "peakCudaAllocatedBytes": torch.cuda.max_memory_allocated(),
            "peakCudaReservedBytes": torch.cuda.max_memory_reserved(),
        },
        "history": history,
        "summary": {
            "completedSteps": global_step,
            "elapsedSeconds": elapsed_seconds,
            "selectedClips": len(selection.clips),
            "selectedAudioHours": selection.duration_ms / 3_600_000,
            "finalTrainLoss": history[-1]["meanTrainLoss"],
            "finalEvalLoss": history[-1]["meanEvalLoss"],
            "adapterPath": str(Path(config.output_dir) / "adapter-final"),
        },
    }


def _move_batch(batch: dict[str, Any], *, dtype: Any) -> dict[str, Any]:
    moved = {}
    for key, value in batch.items():
        target_dtype = dtype if key == "input_features" else None
        moved[key] = value.to("cuda:0", dtype=target_dtype, non_blocking=True)
    return moved


def _evaluate_loss(model: Any, loader: Any, *, dtype: Any) -> float | None:
    if loader is None:
        return None
    import torch

    losses: list[float] = []
    model.eval()
    with torch.inference_mode():
        for batch in loader:
            batch = _move_batch(batch, dtype=dtype)
            with torch.autocast(
                device_type="cuda",
                dtype=dtype,
                enabled=dtype == torch.bfloat16,
            ):
                losses.append(float(model(**batch).loss.detach().cpu()))
    model.train()
    return sum(losses) / len(losses)


def _save_adapter(model: Any, processor: Any, path: Path) -> None:
    path.mkdir(parents=True, exist_ok=False)
    model.save_pretrained(path)
    processor.save_pretrained(path)


def _select_eval_clips(
    path: Path | None,
    *,
    limit: int,
    max_duration_ms: int,
) -> tuple[EvaluationClip, ...]:
    if path is None:
        return ()
    clips = tuple(
        clip
        for clip in load_manifest(path)
        if clip.split == "dev"
        and clip.duration_ms is not None
        and clip.duration_ms <= max_duration_ms
        and not has_unresolved_dual_transcription(clip.training_reference)
    )
    if not clips:
        raise ValueError("eval manifest does not contain eligible dev clips")
    return clips[:limit]


def _preflight_inputs(
    processor: Any,
    clips: Sequence[EvaluationClip],
    *,
    max_duration_ms: int,
    max_target_positions: int,
    decoder_start_token_id: int | None,
) -> dict[str, Any]:
    total_duration_ms = 0
    max_label_tokens = 0
    for clip in clips:
        audio = read_pcm16_mono_wav(clip.audio_path, expected_sha256=clip.sha256)
        if audio.duration_ms > max_duration_ms:
            raise ValueError(
                f"audio exceeds max duration after decoding for {clip.clip_id}: "
                f"{audio.duration_ms} > {max_duration_ms}"
            )
        total_duration_ms += audio.duration_ms
        input_ids = processor.tokenizer(
            clip.training_reference,
            add_special_tokens=True,
            truncation=False,
        ).input_ids
        if input_ids and input_ids[0] == decoder_start_token_id:
            input_ids = input_ids[1:]
        label_tokens = len(input_ids)
        max_label_tokens = max(max_label_tokens, label_tokens)
        if label_tokens > max_target_positions:
            raise ValueError(
                f"training label exceeds Whisper max_target_positions for {clip.clip_id}: "
                f"{label_tokens} > {max_target_positions}"
            )
    return {
        "verifiedClips": len(clips),
        "verifiedAudioHours": total_duration_ms / 3_600_000,
        "maxLabelTokens": max_label_tokens,
    }


def _emit_progress(event: str, **fields: Any) -> None:
    print(
        json.dumps(
            {"event": event, "occurredAt": datetime.now(UTC).isoformat(), **fields},
            ensure_ascii=False,
        ),
        file=sys.stderr,
        flush=True,
    )


def _selection_report(
    selection: TrainingSelection,
    train_manifest: Path,
    eval_clips: Sequence[EvaluationClip],
) -> dict[str, Any]:
    return {
        "trainManifest": str(train_manifest),
        "selectedClips": len(selection.clips),
        "selectedAudioHours": selection.duration_ms / 3_600_000,
        "selectedSpeakers": len({clip.speaker_id for clip in selection.clips}),
        "selectedLectures": len({clip.lecture_id for clip in selection.clips}),
        "selectedCategories": sorted({clip.category for clip in selection.clips if clip.category}),
        "excludedTooLong": selection.excluded_too_long,
        "excludedMissingDuration": selection.excluded_missing_duration,
        "evalClips": len(eval_clips),
        "excludedInvalidReference": selection.excluded_invalid_reference,
    }


def _require_empty_output(path: Path) -> None:
    if path.exists() and (not path.is_dir() or any(path.iterdir())):
        raise ValueError(f"output directory must be absent or empty: {path}")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("value must be positive")
    return parsed


def _positive_float(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("value must be positive")
    return parsed


def _unit_float(value: str) -> float:
    parsed = float(value)
    if not 0 <= parsed <= 1:
        raise argparse.ArgumentTypeError("value must be between 0 and 1")
    return parsed


def _target_modules(value: str) -> tuple[str, ...]:
    modules = tuple(module.strip() for module in value.split(",") if module.strip())
    if not modules:
        raise argparse.ArgumentTypeError("at least one target module is required")
    return modules


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Train a Whisper large-v3 LoRA adapter")
    parser.add_argument("--base-model", type=Path, required=True)
    parser.add_argument("--train-manifest", type=Path, required=True)
    parser.add_argument("--eval-manifest", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--cuda-visible-devices", default="0")
    parser.add_argument("--precision", choices=("bfloat16", "float32"), default="bfloat16")
    parser.add_argument("--epochs", type=_positive_int, default=1)
    parser.add_argument("--max-steps", type=_positive_int)
    parser.add_argument("--batch-size", type=_positive_int, default=4)
    parser.add_argument("--gradient-accumulation-steps", type=_positive_int, default=4)
    parser.add_argument("--learning-rate", type=_positive_float, default=1e-4)
    parser.add_argument("--warmup-ratio", type=_unit_float, default=0.05)
    parser.add_argument("--weight-decay", type=_unit_float, default=0.01)
    parser.add_argument("--log-every-steps", type=_positive_int, default=5)
    parser.add_argument("--max-grad-norm", type=_positive_float, default=1.0)
    parser.add_argument("--lora-rank", type=_positive_int, default=8)
    parser.add_argument("--lora-alpha", type=_positive_int, default=32)
    parser.add_argument("--lora-dropout", type=_unit_float, default=0.05)
    parser.add_argument("--target-modules", type=_target_modules, default=("q_proj", "v_proj"))
    parser.add_argument("--seed", type=int, default=20260803)
    parser.add_argument("--max-train-audio-hours", type=_positive_float, default=5.0)
    parser.add_argument("--max-train-clips", type=_positive_int)
    parser.add_argument("--max-duration-ms", type=_positive_int, default=30_000)
    parser.add_argument("--eval-limit", type=_positive_int, default=128)
    parser.add_argument("--dry-run", action="store_true")
    return parser


if __name__ == "__main__":
    raise SystemExit(main())
