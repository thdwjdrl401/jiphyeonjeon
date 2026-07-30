import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
AI_PROD_COMPOSE = ROOT / "docker-compose.ai-prod.yml"


def test_ec2_compose_pins_ai_api_to_one_replica() -> None:
    compose = AI_PROD_COMPOSE.read_text(encoding="utf-8")
    service = re.search(r"(?ms)^  ai-api:\n(?P<body>.*?)(?=^  [a-z][a-z0-9-]*:\n|\Z)", compose)

    assert service is not None
    body = service.group("body")
    assert re.search(r"(?m)^    container_name: liveclass-ai-api-prod$", body)
    assert re.search(r"(?m)^    deploy:\n      replicas: 1$", body)
