# syntax=docker/dockerfile:1

FROM python:3.12-slim-bookworm AS build

ARG UV_VERSION=0.11.27
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
WORKDIR /app

RUN pip install --no-cache-dir "uv==${UV_VERSION}"
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
RUN uv sync --frozen --no-dev

FROM python:3.12-slim-bookworm AS runtime

WORKDIR /app
RUN groupadd --system liveclass \
 && useradd --system --gid liveclass --create-home liveclass

COPY --from=build --chown=liveclass:liveclass /app/.venv /app/.venv
COPY --chown=liveclass:liveclass app ./app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

USER liveclass
EXPOSE 8010
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8010/healthz', timeout=2)"]
ENTRYPOINT ["python", "-m", "app.main"]
