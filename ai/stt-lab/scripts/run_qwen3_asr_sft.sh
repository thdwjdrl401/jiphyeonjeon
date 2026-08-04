#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
stt_lab_data_home=${XDG_DATA_HOME:-$HOME/.local/share}
qwen_asr_version=${STT_LAB_QWEN_ASR_VERSION:-0.0.6}
torch_backend=${STT_LAB_QWEN_TORCH_BACKEND:-cu128}
training_venv=${STT_LAB_QWEN_TRAINING_VENV:-$stt_lab_data_home/liveclass/qwen3-asr-training/qwen-asr-$qwen_asr_version-$torch_backend}
cuda_visible_devices=${STT_LAB_CUDA_VISIBLE_DEVICES:-0}

if [ "$cuda_visible_devices" != "0" ]; then
  echo "This host permits Qwen training on physical GPU 0 only." >&2
  exit 2
fi
if [ ! -x "$training_venv/bin/python" ]; then
  echo "Qwen training environment is missing; run scripts/bootstrap_qwen_training.sh first." >&2
  exit 1
fi

export CUDA_VISIBLE_DEVICES=$cuda_visible_devices
exec "$training_venv/bin/python" "$script_dir/qwen3_asr_sft.py" "$@"
