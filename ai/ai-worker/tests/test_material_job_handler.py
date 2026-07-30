import json
from collections.abc import Sequence
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.adapters.remote_bge_embedding import RemoteEmbeddingError
from app.adapters.spring_material_callback import SpringCallbackError
from app.application import MaterialIndexResult, map_pptx_embed_job
from app.consumers import MaterialJobHandler, PermanentMaterialJobError
from app.domain import ExistingIndexVersion, MaterialIngestionError
from app.ingestion import KeyTerm


MODEL_REVISION = "5617a9f61b028005a4858fdac845db406aefb181"


def embed_body() -> bytes:
    return json.dumps(
        {
            "taskType": "PPTX_EMBED",
            "materialId": "550e8400-e29b-41d4-a716-446655440000",
            "assetId": "550e8400-e29b-41d4-a716-446655440001",
            "lessonId": "550e8400-e29b-41d4-a716-446655440002",
            "curriculumId": "550e8400-e29b-41d4-a716-446655440003",
            "fileName": "deck.pptx",
            "policy": {"embedModel": "bge-m3"},
            "contractVersion": 1,
        },
        separators=(",", ":"),
    ).encode()


def delete_body() -> bytes:
    return json.dumps(
        {
            "taskType": "EMBED_DELETE",
            "materialId": "550e8400-e29b-41d4-a716-446655440000",
            "lessonId": "550e8400-e29b-41d4-a716-446655440002",
            "contractVersion": 1,
        },
        separators=(",", ":"),
    ).encode()


class Indexer:
    def __init__(
        self,
        error: Exception | None = None,
        existing: ExistingIndexVersion | None = None,
        key_terms: Sequence[KeyTerm] = (),
    ) -> None:
        self.error = error
        self.existing = existing
        self.key_terms = key_terms
        self.executed = []
        self.lookups = []

    async def execute(self, material) -> MaterialIndexResult:
        self.executed.append(material)
        if self.error is not None:
            raise self.error
        return MaterialIndexResult(version_id=41, key_terms=tuple(self.key_terms))

    async def find_existing(self, material) -> ExistingIndexVersion | None:
        self.lookups.append(material)
        return self.existing


class Runtime:
    def __init__(self, indexer: Indexer, callback: AsyncMock) -> None:
        self.index_pptx_material = indexer
        self.callback_client = SimpleNamespace(send=callback)

    def material_for(self, job):
        return map_pptx_embed_job(
            job,
            tenant_id="liveclass",
            model_revision=MODEL_REVISION,
            chunk_max_chars=1_200,
        )


async def test_success_indexes_then_sends_only_ready_callback() -> None:
    callback = AsyncMock()
    indexer = Indexer()

    await MaterialJobHandler(Runtime(indexer, callback)).handle(embed_body())

    assert len(indexer.executed) == 1
    assert callback.await_count == 1
    event = callback.await_args.args[0]
    assert event.event_type == "MATERIAL_EMBEDDED"
    assert event.status == "READY"
    assert event.job_id == "PPTX_EMBED:550e8400-e29b-41d4-a716-446655440000"


async def test_success_with_key_terms_also_sends_a_key_terms_callback_after_ready() -> None:
    callback = AsyncMock()
    indexer = Indexer(key_terms=(KeyTerm(term="용어", definition="정의"),))

    await MaterialJobHandler(Runtime(indexer, callback)).handle(embed_body())

    assert callback.await_count == 2
    ready_event, key_terms_event = (call.args[0] for call in callback.await_args_list)
    assert ready_event.event_type == "MATERIAL_EMBEDDED"
    assert key_terms_event.event_type == "MATERIAL_KEY_TERMS_EXTRACTED"
    assert key_terms_event.status == "READY"
    assert [(term.term, term.definition) for term in key_terms_event.key_terms] == [
        ("용어", "정의")
    ]


async def test_key_terms_callback_failure_is_swallowed_and_job_still_succeeds() -> None:
    async def send(event):
        if event.event_type == "MATERIAL_KEY_TERMS_EXTRACTED":
            raise SpringCallbackError("timeout", retryable=True)

    callback = AsyncMock(side_effect=send)
    indexer = Indexer(key_terms=(KeyTerm(term="용어", definition="정의"),))

    await MaterialJobHandler(Runtime(indexer, callback)).handle(embed_body())

    assert callback.await_count == 2


@pytest.mark.parametrize("body", [b"not-json", delete_body()])
async def test_invalid_or_unresolved_delete_goes_to_dlq_without_callback(body: bytes) -> None:
    callback = AsyncMock()

    with pytest.raises(PermanentMaterialJobError):
        await MaterialJobHandler(Runtime(Indexer(), callback)).handle(body)

    callback.assert_not_awaited()


async def test_permanent_ingestion_failure_reports_failed_before_dlq() -> None:
    callback = AsyncMock()
    handler = MaterialJobHandler(Runtime(Indexer(MaterialIngestionError("unsafe PPTX")), callback))

    with pytest.raises(PermanentMaterialJobError):
        await handler.handle(embed_body())

    event = callback.await_args.args[0]
    assert event.event_type == "MATERIAL_EMBED_FAILED"
    assert event.status == "FAILED"


async def test_retryable_ingestion_failure_does_not_emit_terminal_callback() -> None:
    callback = AsyncMock()
    error = RemoteEmbeddingError("BGE unavailable", retryable=True)

    with pytest.raises(RemoteEmbeddingError):
        await MaterialJobHandler(Runtime(Indexer(error), callback)).handle(embed_body())

    callback.assert_not_awaited()


async def test_ready_callback_retry_keeps_completed_result_for_redelivery() -> None:
    callback = AsyncMock(side_effect=SpringCallbackError("timeout", retryable=True))

    with pytest.raises(SpringCallbackError):
        await MaterialJobHandler(Runtime(Indexer(), callback)).handle(embed_body())


@pytest.mark.parametrize(
    "existing",
    [
        ExistingIndexVersion(41, activation_required=False),
        ExistingIndexVersion(41, activation_required=True),
        None,
    ],
)
async def test_retry_exhaustion_never_marks_a_completed_job_failed(existing) -> None:
    callback = AsyncMock()
    handler = MaterialJobHandler(Runtime(Indexer(existing=existing), callback))

    await handler.report_retry_exhausted(embed_body())

    if existing is not None and not existing.activation_required:
        callback.assert_not_awaited()
    else:
        event = callback.await_args.args[0]
        assert event.event_type == "MATERIAL_EMBED_FAILED"
