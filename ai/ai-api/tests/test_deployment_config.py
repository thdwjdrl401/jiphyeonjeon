import re

from conftest import REPO_ROOT as ROOT

AI_PROD_COMPOSE = ROOT / "docker-compose.ai-prod.yml"
AI_DEV_COMPOSE = ROOT / "docker-compose.ai-dev.yml"
AI_PROD_ENV_EXAMPLE = ROOT / ".env.ai-prod.example"
AI_DEV_ENV_EXAMPLE = ROOT / ".env.ai-dev.example"


def test_ec2_compose_pins_ai_api_to_one_replica() -> None:
    compose = AI_PROD_COMPOSE.read_text(encoding="utf-8")
    service = re.search(r"(?ms)^  ai-api:\n(?P<body>.*?)(?=^  [a-z][a-z0-9-]*:\n|\Z)", compose)

    assert service is not None
    body = service.group("body")
    assert re.search(r"(?m)^    container_name: liveclass-ai-api-prod$", body)
    assert re.search(r"(?m)^    deploy:\n      replicas: 1$", body)


def test_prod_and_dev_compose_share_operational_shape() -> None:
    prod = AI_PROD_COMPOSE.read_text(encoding="utf-8")
    dev = AI_DEV_COMPOSE.read_text(encoding="utf-8")

    for compose in (prod, dev):
        assert "AI_WORKER_MANAGEMENT_HOST: 0.0.0.0" in compose
        assert "AI_WORKER_MANAGEMENT_HOST_PORT" in compose
        assert "AI_API_HOST_PORT" in compose
        assert compose.count("stop_grace_period: 45s") == 2
        # The worker management port is loopback-only in both stacks: nothing outside the
        # host has a reason to reach it.
        assert "127.0.0.1:${AI_WORKER_MANAGEMENT_HOST_PORT" in compose
        assert re.search(r"(?m)^    deploy:\n      replicas: 1$", compose)

    # ai-api is the one deliberate asymmetry (57af7152): prod stays loopback, dev publishes on
    # all interfaces so a laptop backend on the remote profile can reach EC2 without an SSH
    # tunnel. dev is gated by the security group and the same HMAC as prod.
    assert "127.0.0.1:${AI_API_HOST_PORT" in prod
    assert '- "${AI_API_HOST_PORT' in dev
    assert "127.0.0.1:${AI_API_HOST_PORT" not in dev

    prod_note_keys = set(re.findall(r"(?m)^      (AI_API_LECTURE_NOTE_[A-Z0-9_]+):", prod))
    dev_note_keys = set(re.findall(r"(?m)^      (AI_API_LECTURE_NOTE_[A-Z0-9_]+):", dev))
    assert prod_note_keys == dev_note_keys
    assert len(prod_note_keys) == 11


def test_lecture_note_policy_uses_compose_defaults() -> None:
    expected_defaults = {
        # 비워 두면 앱이 AI_API_GMS_MODEL로 폴백해 gpt-4.1이 된다. 강의 노트는 gpt-5-mini가
        # 기본이므로 compose가 명시한다 — 이 값이 비어 있던 것이 reasoning_effort와 짝이
        # 깨져 전 호출이 400을 받은 원인이었다. nano는 item 보존 실측이 1/3이라 제외했다.
        "AI_API_LECTURE_NOTE_MODEL": "gpt-5-mini",
        "AI_API_LECTURE_NOTE_REASONING_EFFORT": "minimal",
        "AI_API_LECTURE_NOTE_MAX_OUTPUT_TOKENS": "4096",
        "AI_API_LECTURE_NOTE_MAX_PROMPT_CHARS": "20000",
        "AI_API_LECTURE_NOTE_TIMEOUT_SECONDS": "30",
        "AI_API_LECTURE_NOTE_MIN_WINDOW_MS": "45000",
        "AI_API_LECTURE_NOTE_TARGET_WINDOW_MS": "60000",
        "AI_API_LECTURE_NOTE_MAX_WINDOW_MS": "90000",
        "AI_API_LECTURE_NOTE_MIN_CHARS": "200",
        "AI_API_LECTURE_NOTE_MAX_CHARS": "1500",
        "AI_API_LECTURE_NOTE_STREAM_MAXLEN": "10000",
    }
    composes = (
        AI_PROD_COMPOSE.read_text(encoding="utf-8"),
        AI_DEV_COMPOSE.read_text(encoding="utf-8"),
    )
    env_examples = (
        AI_PROD_ENV_EXAMPLE.read_text(encoding="utf-8"),
        AI_DEV_ENV_EXAMPLE.read_text(encoding="utf-8"),
    )

    for key, default in expected_defaults.items():
        for compose in composes:
            assert f"{key}: ${{{key}:-{default}}}" in compose
        for env_example in env_examples:
            assert re.search(rf"(?m)^{key}=", env_example) is None


def test_compose_host_ports_are_explicit_and_do_not_collide() -> None:
    prod_env = AI_PROD_ENV_EXAMPLE.read_text(encoding="utf-8")
    dev_env = AI_DEV_ENV_EXAMPLE.read_text(encoding="utf-8")

    assert "AI_API_HOST_PORT=8010" in prod_env
    assert "AI_WORKER_MANAGEMENT_HOST_PORT=8011" in prod_env
    assert "AI_API_HOST_PORT=18010" in dev_env
    assert "AI_WORKER_MANAGEMENT_HOST_PORT=18011" in dev_env


def test_annotation_switches_reach_both_containers() -> None:
    """A switch that exists only in the env example silently stays off: compose must map it
    into the container's environment or setting it does nothing. That exact failure shipped
    once — the switches were documented in .env.ai-prod.example but never wired here."""

    prod = AI_PROD_COMPOSE.read_text(encoding="utf-8")
    dev = AI_DEV_COMPOSE.read_text(encoding="utf-8")

    for compose in (prod, dev):
        assert (
            "AI_WORKER_ANNOTATION_INGESTION_ENABLED: "
            "${AI_WORKER_ANNOTATION_INGESTION_ENABLED:-false}"
        ) in compose
        assert (
            "AI_API_ANNOTATION_EVIDENCE_ENABLED: ${AI_API_ANNOTATION_EVIDENCE_ENABLED:-false}"
        ) in compose
        assert "AI_API_ANNOTATION_TOP_K" in compose
        assert "AI_API_ANNOTATION_WINDOW_SIZE" in compose
        # 이름이 config 필드(conversation_memory_session_fallback_enabled)와 한 글자라도
        # 다르면 조용히 꺼진다 — 기본 false 매핑까지 정확히 고정한다.
        assert (
            "AI_API_CONVERSATION_MEMORY_SESSION_FALLBACK_ENABLED: "
            "${AI_API_CONVERSATION_MEMORY_SESSION_FALLBACK_ENABLED:-false}"
        ) in compose
