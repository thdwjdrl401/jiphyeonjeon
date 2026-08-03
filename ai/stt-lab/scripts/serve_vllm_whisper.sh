#!/bin/sh
set -eu

stt_lab_data_home=${XDG_DATA_HOME:-$HOME/.local/share}
vllm_version=${STT_LAB_VLLM_VERSION:-0.11.2}
torch_backend=${STT_LAB_VLLM_TORCH_BACKEND:-cu128}
vllm_venv=${STT_LAB_VLLM_VENV:-$stt_lab_data_home/liveclass/stt-lab-vllm/vllm-$vllm_version-$torch_backend}
vllm_bin=$vllm_venv/bin/vllm
model_path=${STT_LAB_WHISPER_MODEL:-/home/liveclass/ai/models/whisper-large-v3}
served_model_name=${STT_LAB_VLLM_MODEL_NAME:-liveclass-whisper-large-v3}
port=${STT_LAB_VLLM_PORT:-18083}
gpu_memory_utilization=${STT_LAB_VLLM_GPU_MEMORY_UTILIZATION:-0.08}
cuda_visible_devices=${STT_LAB_CUDA_VISIBLE_DEVICES:-0}

if [ "$cuda_visible_devices" != "0" ]; then
  echo "This host permits the STT experiment on GPU 0 only." >&2
  exit 2
fi
if [ ! -x "$vllm_bin" ]; then
  echo "vLLM is not installed; run scripts/bootstrap_vllm.sh first." >&2
  exit 1
fi
if [ ! -d "$model_path" ]; then
  echo "Whisper model directory does not exist: $model_path" >&2
  exit 1
fi

export CUDA_VISIBLE_DEVICES=$cuda_visible_devices
exec "$vllm_bin" serve "$model_path" \
  --host 127.0.0.1 \
  --port "$port" \
  --served-model-name "$served_model_name" \
  --dtype bfloat16 \
  --gpu-memory-utilization "$gpu_memory_utilization" \
  --max-num-seqs 16
