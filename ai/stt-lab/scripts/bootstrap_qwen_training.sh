#!/bin/sh
set -eu

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required" >&2
  exit 1
fi

stt_lab_data_home=${XDG_DATA_HOME:-$HOME/.local/share}
qwen_asr_version=${STT_LAB_QWEN_ASR_VERSION:-0.0.6}
datasets_version=${STT_LAB_DATASETS_VERSION:-4.0.0}
torch_backend=${STT_LAB_QWEN_TORCH_BACKEND:-cu128}
training_venv=${STT_LAB_QWEN_TRAINING_VENV:-$stt_lab_data_home/liveclass/qwen3-asr-training/qwen-asr-$qwen_asr_version-$torch_backend}

mkdir -p "$(dirname "$training_venv")"
if [ ! -x "$training_venv/bin/python" ]; then
  uv venv "$training_venv" --python 3.12 --seed
fi

uv pip install \
  --python "$training_venv/bin/python" \
  "qwen-asr==$qwen_asr_version" \
  "datasets==$datasets_version" \
  --torch-backend="$torch_backend"

"$training_venv/bin/python" -c "import datasets, qwen_asr, torch; print('datasets', datasets.__version__, 'torch', torch.__version__)"
