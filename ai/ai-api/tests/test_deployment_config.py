import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
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
        assert "127.0.0.1:${AI_WORKER_MANAGEMENT_HOST_PORT" in compose
        assert "127.0.0.1:${AI_API_HOST_PORT" in compose
        assert re.search(r"(?m)^    deploy:\n      replicas: 1$", compose)

    prod_note_keys = set(
        re.findall(r"(?m)^      (AI_API_LECTURE_NOTE_[A-Z0-9_]+):", prod)
    )
    dev_note_keys = set(
        re.findall(r"(?m)^      (AI_API_LECTURE_NOTE_[A-Z0-9_]+):", dev)
    )
    assert prod_note_keys == dev_note_keys
    assert len(prod_note_keys) == 10


def test_compose_host_ports_are_explicit_and_do_not_collide() -> None:
    prod_env = AI_PROD_ENV_EXAMPLE.read_text(encoding="utf-8")
    dev_env = AI_DEV_ENV_EXAMPLE.read_text(encoding="utf-8")

    assert "AI_API_HOST_PORT=8010" in prod_env
    assert "AI_WORKER_MANAGEMENT_HOST_PORT=8011" in prod_env
    assert "AI_API_HOST_PORT=18010" in dev_env
    assert "AI_WORKER_MANAGEMENT_HOST_PORT=18011" in dev_env
