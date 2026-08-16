# syntax=docker/dockerfile:1

FROM python:3.12-slim-bookworm AS build

ARG UV_VERSION=0.11.27
# cuda or cpu — picks the torch build. The two extras conflict, so exactly one is installed.
ARG TORCH_EXTRA=cuda
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
WORKDIR /app

RUN pip install --no-cache-dir "uv==${UV_VERSION}"
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv,sharing=locked \
    uv sync --frozen --no-dev --extra "${TORCH_EXTRA}" --no-install-project

COPY app ./app
RUN --mount=type=cache,target=/root/.cache/uv,sharing=locked \
    uv sync --frozen --no-dev --extra "${TORCH_EXTRA}"

FROM python:3.12-slim-bookworm AS runtime

WORKDIR /app
RUN groupadd --system liveclass \
 && useradd --system --gid liveclass --create-home liveclass \
 && mkdir -p /home/liveclass/.cache/huggingface \
 && chown -R liveclass:liveclass /home/liveclass/.cache
# HF_HOME은 named 볼륨이 붙는 자리다. 이미지에 이 경로가 없으면 Docker가 볼륨을 root 소유로
# 새로 만들어, liveclass 사용자가 가중치를 못 받고 기동에 실패한다. 미리 만들어 두면 Docker가
# 이 디렉토리의 소유권을 그대로 볼륨에 복사한다.

COPY --from=build --chown=liveclass:liveclass /app/.venv /app/.venv
COPY --chown=liveclass:liveclass app ./app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/home/liveclass/.cache/huggingface

USER liveclass
EXPOSE 8020
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=120s \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8020/healthz', timeout=2)"]
ENTRYPOINT ["python", "-m", "app.main"]
