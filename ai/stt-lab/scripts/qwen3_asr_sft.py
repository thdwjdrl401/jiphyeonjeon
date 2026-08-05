#!/usr/bin/env python3
# Copyright 2026 The Alibaba Qwen team and LiveClass contributors.
# SPDX-License-Identifier: Apache-2.0
"""GPU-0-only Qwen3-ASR full SFT runner based on the official Qwen recipe.

Upstream source:
https://github.com/QwenLM/Qwen3-ASR/blob/main/finetuning/qwen3_asr_sft.py
The LiveClass variant adds dataset target validation, bounded audio/text input,
gradient checkpointing, final standalone checkpoint saving, and GPU policy checks.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import librosa
import torch
from datasets import load_dataset
from qwen_asr import Qwen3ASRModel
from transformers import GenerationConfig, Trainer, TrainerCallback, TrainingArguments

_CKPT_RE = re.compile(r"^checkpoint-(\d+)$")
_TARGET_PREFIX = "language Korean<asr_text>"


def patch_outer_forward(model: Any) -> None:
    cls = model.__class__
    if getattr(cls, "_forward_patched", False):
        return
    if not hasattr(model, "thinker") or not hasattr(model.thinker, "forward"):
        raise RuntimeError("Qwen3-ASR model has no compatible thinker.forward")

    def forward(
        self: Any,
        input_ids: Any = None,
        attention_mask: Any = None,
        input_features: Any = None,
        feature_attention_mask: Any = None,
        labels: Any = None,
        **kwargs: Any,
    ) -> Any:
        return self.thinker.forward(
            input_ids=input_ids,
            attention_mask=attention_mask,
            input_features=input_features,
            feature_attention_mask=feature_attention_mask,
            labels=labels,
            **kwargs,
        )

    cls.forward = forward
    cls._forward_patched = True


def find_latest_checkpoint(output_dir: Path) -> Path | None:
    if not output_dir.is_dir():
        return None
    candidates = []
    for path in output_dir.iterdir():
        match = _CKPT_RE.fullmatch(path.name)
        if path.is_dir() and match:
            candidates.append((int(match.group(1)), path))
    return max(candidates)[1] if candidates else None


def build_prefix_messages(prompt: str, audio_array: Any) -> list[dict[str, Any]]:
    return [
        {"role": "system", "content": prompt or ""},
        {"role": "user", "content": [{"type": "audio", "audio": audio_array}]},
    ]


def make_preprocess_fn_prefix_only(processor: Any):
    def preprocess(example: dict[str, Any]) -> dict[str, Any]:
        prompt = example.get("prompt", "")
        prefix_text = processor.apply_chat_template(
            [build_prefix_messages(prompt, None)],
            add_generation_prompt=True,
            tokenize=False,
        )[0]
        return {
            "prompt": prompt,
            "audio": example["audio"],
            "target": example["text"],
            "prefix_text": prefix_text,
        }

    return preprocess


@dataclass
class DataCollatorForQwen3ASRFinetuning:
    processor: Any
    sampling_rate: int = 16_000
    max_audio_seconds: float = 90.0
    max_text_tokens: int = 512

    def __call__(self, features: list[dict[str, Any]]) -> dict[str, torch.Tensor]:
        audio_paths = [feature["audio"] for feature in features]
        prefix_texts = [feature["prefix_text"] for feature in features]
        targets = [feature["target"] for feature in features]
        eos = self.processor.tokenizer.eos_token or ""
        full_texts = [prefix + target + eos for prefix, target in zip(prefix_texts, targets)]
        target_token_ids = self.processor.tokenizer(
            targets,
            add_special_tokens=False,
            padding=False,
            truncation=False,
        )["input_ids"]
        if any(
            len(token_ids) + (1 if eos else 0) > self.max_text_tokens
            for token_ids in target_token_ids
        ):
            raise ValueError("Qwen training target exceeds max_text_tokens")
        audios = [self._load_audio(path) for path in audio_paths]

        full_inputs = self.processor(
            text=full_texts,
            audio=audios,
            return_tensors="pt",
            padding=True,
            truncation=False,
        )
        prefix_inputs = self.processor(
            text=prefix_texts,
            audio=audios,
            return_tensors="pt",
            padding=True,
            truncation=False,
        )

        prefix_lengths = prefix_inputs["attention_mask"].sum(dim=1).tolist()
        labels = full_inputs["input_ids"].clone()
        for index, prefix_length in enumerate(prefix_lengths):
            labels[index, :prefix_length] = -100
        pad_id = self.processor.tokenizer.pad_token_id
        if pad_id is not None:
            labels[labels == pad_id] = -100
        full_inputs["labels"] = labels
        return full_inputs

    def _load_audio(self, path: str) -> Any:
        audio, _ = librosa.load(path, sr=self.sampling_rate, mono=True)
        if len(audio) > round(self.max_audio_seconds * self.sampling_rate):
            raise ValueError(f"Qwen training audio exceeds max_audio_seconds: {path}")
        return audio


class CastFloatInputsTrainer(Trainer):
    def _prepare_inputs(self, inputs: Any) -> Any:
        inputs = super()._prepare_inputs(inputs)
        model_dtype = getattr(self.model, "dtype", None)
        if model_dtype is not None:
            for key, value in list(inputs.items()):
                if torch.is_tensor(value) and value.is_floating_point():
                    inputs[key] = value.to(dtype=model_dtype)
        return inputs


def copy_required_hf_files_for_qwen_asr(source_dir: Path, destination_dir: Path) -> None:
    destination_dir.mkdir(parents=True, exist_ok=True)
    required = (
        "config.json",
        "generation_config.json",
        "preprocessor_config.json",
        "processor_config.json",
        "tokenizer_config.json",
        "tokenizer.json",
        "special_tokens_map.json",
        "chat_template.json",
        "merges.txt",
        "vocab.json",
    )
    for filename in required:
        source = source_dir / filename
        if source.exists():
            shutil.copy2(source, destination_dir / filename)


class MakeEveryCheckpointInferableCallback(TrainerCallback):
    def __init__(self, base_model_path: Path) -> None:
        self.base_model_path = base_model_path

    def on_save(self, args: TrainingArguments, state: Any, control: Any, **kwargs: Any) -> Any:
        if args.process_index != 0:
            return control
        checkpoint = Path(args.output_dir) / f"checkpoint-{state.global_step}"
        copy_required_hf_files_for_qwen_asr(self.base_model_path, checkpoint)
        return control


def main() -> None:
    args = _parse_args()
    _validate_args(args)
    use_bf16 = torch.cuda.get_device_capability(0)[0] >= 8
    wrapper = Qwen3ASRModel.from_pretrained(
        str(args.model_path),
        dtype=torch.bfloat16 if use_bf16 else torch.float16,
        device_map=None,
    )
    model = wrapper.model
    processor = wrapper.processor
    patch_outer_forward(model)
    model.generation_config = GenerationConfig.from_model_config(model.config)
    model.config.use_cache = False
    if args.gradient_checkpointing:
        model.gradient_checkpointing_enable()

    raw_dataset = load_dataset(
        "json",
        data_files={"train": str(args.train_file), "validation": str(args.eval_file)},
    )
    dataset = raw_dataset.map(make_preprocess_fn_prefix_only(processor), num_proc=1)
    keep = {"prompt", "audio", "target", "prefix_text"}
    for split in dataset:
        drop = [column for column in dataset[split].column_names if column not in keep]
        if drop:
            dataset[split] = dataset[split].remove_columns(drop)

    if args.max_train_samples:
        limit = min(args.max_train_samples, len(dataset["train"]))
        dataset["train"] = dataset["train"].select(range(limit))
    if args.max_eval_samples:
        limit = min(args.max_eval_samples, len(dataset["validation"]))
        dataset["validation"] = dataset["validation"].select(range(limit))

    training_args = TrainingArguments(
        output_dir=str(args.output_dir),
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.eval_batch_size,
        gradient_accumulation_steps=args.grad_acc,
        learning_rate=args.lr,
        num_train_epochs=args.epochs,
        max_steps=args.max_steps,
        logging_steps=args.log_steps,
        lr_scheduler_type="linear",
        warmup_ratio=args.warmup_ratio,
        dataloader_num_workers=args.num_workers,
        dataloader_pin_memory=args.num_workers > 0,
        dataloader_persistent_workers=args.num_workers > 0,
        dataloader_prefetch_factor=2 if args.num_workers > 0 else None,
        save_strategy="steps",
        save_steps=args.save_steps,
        save_total_limit=args.save_total_limit,
        save_safetensors=True,
        eval_strategy=args.eval_strategy,
        eval_steps=args.eval_steps if args.eval_strategy == "steps" else None,
        do_eval=True,
        bf16=use_bf16,
        fp16=not use_bf16,
        gradient_checkpointing=args.gradient_checkpointing,
        ddp_find_unused_parameters=False,
        remove_unused_columns=False,
        report_to="none",
        seed=args.seed,
        data_seed=args.seed,
    )
    collator = DataCollatorForQwen3ASRFinetuning(
        processor=processor,
        max_audio_seconds=args.max_audio_seconds,
        max_text_tokens=args.max_text_tokens,
    )
    trainer = CastFloatInputsTrainer(
        model=model,
        args=training_args,
        train_dataset=dataset["train"],
        eval_dataset=dataset["validation"],
        data_collator=collator,
        processing_class=processor.tokenizer,
        callbacks=[MakeEveryCheckpointInferableCallback(args.model_path)],
    )
    resume_from = args.resume_from
    if args.resume_latest and resume_from is None:
        latest = find_latest_checkpoint(args.output_dir)
        if latest is None:
            raise ValueError("--resume-latest found no checkpoint")
        resume_from = latest
    trainer.train(resume_from_checkpoint=str(resume_from) if resume_from else None)

    final_dir = args.output_dir / "final"
    trainer.save_model(str(final_dir))
    processor.save_pretrained(final_dir)
    copy_required_hf_files_for_qwen_asr(args.model_path, final_dir)
    _write_metadata(args, final_dir, trainer.state.global_step)


def _validate_args(args: argparse.Namespace) -> None:
    if os.environ.get("CUDA_VISIBLE_DEVICES") != "0":
        raise ValueError("Qwen training is restricted to physical GPU 0")
    if not torch.cuda.is_available() or torch.cuda.device_count() != 1:
        raise RuntimeError("Qwen training requires exactly one visible CUDA device")
    for path, label in (
        (args.model_path, "model"),
        (args.train_file, "train file"),
        (args.eval_file, "eval file"),
    ):
        if not path.exists():
            raise ValueError(f"Qwen {label} does not exist: {path}")
    if args.output_dir.exists() and any(args.output_dir.iterdir()):
        if args.resume_from is None and not args.resume_latest:
            raise ValueError("non-empty output_dir requires --resume-from or --resume-latest")
    else:
        args.output_dir.mkdir(parents=True, exist_ok=True)
    if args.batch_size <= 0 or args.grad_acc <= 0 or args.eval_batch_size <= 0:
        raise ValueError("Qwen batch sizes and gradient accumulation must be positive")
    if args.max_steps == 0 or args.max_steps < -1:
        raise ValueError("max_steps must be -1 or positive")
    if args.max_train_samples < 0 or args.max_eval_samples < 0:
        raise ValueError("sample limits must be zero or positive")
    if args.resume_from is not None and not args.resume_from.is_dir():
        raise ValueError(f"resume checkpoint does not exist: {args.resume_from}")
    _validate_target_file(args.train_file)
    _validate_target_file(args.eval_file)


def _validate_target_file(path: Path) -> None:
    count = 0
    with path.open(encoding="utf-8") as source:
        for line_number, line in enumerate(source, start=1):
            value = json.loads(line)
            if set(value) - {"audio", "text", "prompt"}:
                raise ValueError(f"unexpected Qwen target fields at {path}:{line_number}")
            if not str(value.get("text", "")).startswith(_TARGET_PREFIX):
                raise ValueError(f"invalid Korean Qwen target at {path}:{line_number}")
            if not Path(str(value.get("audio", ""))).is_file():
                raise ValueError(f"missing Qwen audio at {path}:{line_number}")
            count += 1
    if count == 0:
        raise ValueError(f"Qwen target file is empty: {path}")


def _write_metadata(args: argparse.Namespace, final_dir: Path, global_step: int) -> None:
    value = {
        "baseModel": str(args.model_path.resolve()),
        "trainFileSha256": _sha256(args.train_file),
        "evalFileSha256": _sha256(args.eval_file),
        "seed": args.seed,
        "method": "full-parameter-sft",
        "precision": "bfloat16" if torch.cuda.get_device_capability(0)[0] >= 8 else "float16",
        "globalStep": global_step,
        "eosSupervised": True,
        "physicalGpu": 0,
    }
    (final_dir / "liveclass-training.json").write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser("LiveClass Qwen3-ASR full SFT")
    parser.add_argument("--model-path", type=Path, required=True)
    parser.add_argument("--train-file", type=Path, required=True)
    parser.add_argument("--eval-file", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--eval-batch-size", type=int, default=1)
    parser.add_argument("--grad-acc", type=int, default=16)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--max-steps", type=int, default=-1)
    parser.add_argument("--max-train-samples", type=int, default=0)
    parser.add_argument("--max-eval-samples", type=int, default=0)
    parser.add_argument("--log-steps", type=int, default=10)
    parser.add_argument("--warmup-ratio", type=float, default=0.02)
    parser.add_argument("--num-workers", type=int, default=2)
    parser.add_argument("--save-steps", type=int, default=200)
    parser.add_argument("--save-total-limit", type=int, default=5)
    parser.add_argument("--eval-strategy", choices=("epoch", "steps"), default="epoch")
    parser.add_argument("--eval-steps", type=int, default=200)
    parser.add_argument("--seed", type=int, default=37)
    parser.add_argument("--max-audio-seconds", type=float, default=90.0)
    parser.add_argument("--max-text-tokens", type=int, default=512)
    parser.add_argument(
        "--gradient-checkpointing", action=argparse.BooleanOptionalAction, default=True
    )
    resume = parser.add_mutually_exclusive_group()
    resume.add_argument("--resume-from", type=Path)
    resume.add_argument("--resume-latest", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    main()
