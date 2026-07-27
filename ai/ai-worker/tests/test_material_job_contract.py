from __future__ import annotations

import json
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.application import SPRING_ASSET_SOURCE, map_pptx_embed_job
from app.contracts import EmbedDeleteJob, PptxEmbedJob, parse_material_job


MATERIAL_ID = "550e8400-e29b-41d4-a716-446655440000"
ASSET_ID = "550e8400-e29b-41d4-a716-446655440001"
LESSON_ID = "550e8400-e29b-41d4-a716-446655440002"
CURRICULUM_ID = "550e8400-e29b-41d4-a716-446655440003"
REVISION = "5617a9f61b028005a4858fdac845db406aefb181"


def _embed_payload(**overrides: object) -> dict[str, object]:
    return {
        "taskType": "PPTX_EMBED",
        "materialId": MATERIAL_ID,
        "assetId": ASSET_ID,
        "lessonId": LESSON_ID,
        "curriculumId": CURRICULUM_ID,
        "fileName": "강의자료.pptx",
        "policy": {"embedModel": "bge-m3"},
        "contractVersion": 1,
        **overrides,
    }


def _body(payload: dict[str, object]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()


def test_parses_documented_pptx_embed_envelope_with_camel_case_only() -> None:
    job = parse_material_job(_body(_embed_payload()))

    assert isinstance(job, PptxEmbedJob)
    assert job.material_id == UUID(MATERIAL_ID)
    assert job.asset_id == UUID(ASSET_ID)
    assert job.lesson_id == UUID(LESSON_ID)
    assert job.curriculum_id == UUID(CURRICULUM_ID)
    assert job.file_name == "강의자료.pptx"
    assert job.policy.embed_model == "bge-m3"
    assert job.contract_version == 1


def test_parses_documented_delete_envelope_without_inventing_scope() -> None:
    job = parse_material_job(
        _body(
            {
                "taskType": "EMBED_DELETE",
                "materialId": MATERIAL_ID,
                "lessonId": LESSON_ID,
                "contractVersion": 1,
            }
        )
    )

    assert isinstance(job, EmbedDeleteJob)
    assert job.material_id == UUID(MATERIAL_ID)
    assert job.lesson_id == UUID(LESSON_ID)


@pytest.mark.parametrize(
    "payload",
    [
        _embed_payload(contractVersion=2),
        _embed_payload(policy={"embedModel": "other"}),
        _embed_payload(materialId="not-a-uuid"),
        _embed_payload(unexpected=True),
        {**_embed_payload(), "material_id": MATERIAL_ID},
    ],
)
def test_rejects_unsupported_or_drifting_embed_contract(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        parse_material_job(_body(payload))


def test_rejects_empty_message_before_json_validation() -> None:
    with pytest.raises(ValueError, match="64 KiB"):
        parse_material_job(b"")


def test_rejects_oversized_message_before_json_validation() -> None:
    with pytest.raises(ValueError, match="64 KiB"):
        parse_material_job(b"x" * (64 * 1024 + 1))


def test_maps_wire_job_to_deterministic_internal_material_identity() -> None:
    job = parse_material_job(_body(_embed_payload()))
    assert isinstance(job, PptxEmbedJob)

    first = map_pptx_embed_job(
        job,
        tenant_id="liveclass",
        model_revision=REVISION,
        chunk_max_chars=1_200,
    )
    second = map_pptx_embed_job(
        job,
        tenant_id="liveclass",
        model_revision=REVISION,
        chunk_max_chars=1_200,
    )

    assert first == second
    assert first.job_id == f"PPTX_EMBED:{MATERIAL_ID}"
    assert first.idempotency_key == f"material:{MATERIAL_ID}:embed"
    assert first.tenant_id == "liveclass"
    assert first.material_version == 1
    assert first.source_bucket == SPRING_ASSET_SOURCE
    assert first.source_object_key == ASSET_ID
    assert first.correlation_id == f"material:{MATERIAL_ID}"
    assert first.chunk_strategy == "slide-max-1200-v1"
    assert first.model_name == "BAAI/bge-m3"
    assert first.model_revision == REVISION
