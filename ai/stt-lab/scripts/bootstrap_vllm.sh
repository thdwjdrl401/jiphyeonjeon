#!/bin/sh
set -eu

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required" >&2
  exit 1
fi

stt_lab_data_home=${XDG_DATA_HOME:-$HOME/.local/share}
vllm_version=${STT_LAB_VLLM_VERSION:-0.11.2}
torch_backend=${STT_LAB_VLLM_TORCH_BACKEND:-cu128}
vllm_venv=${STT_LAB_VLLM_VENV:-$stt_lab_data_home/liveclass/stt-lab-vllm/vllm-$vllm_version-$torch_backend}

mkdir -p "$(dirname "$vllm_venv")"
if [ ! -x "$vllm_venv/bin/python" ]; then
  uv venv "$vllm_venv" --python 3.12 --seed
fi

uv pip install \
  --python "$vllm_venv/bin/python" \
  "vllm[audio]==$vllm_version" \
  --torch-backend="$torch_backend"

"$vllm_venv/bin/python" -c "import vllm; print(vllm.__version__)"
