import json
from collections.abc import Sequence
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.adapters.remote_bge_embedding import RemoteEmbeddingError
from app.adapters.spring_material_callback import SpringCallbackError
from app.application import MaterialDeleteResult, MaterialIndexResult, map_pptx_embed_job
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


class Deleter:
    def __init__(
        self,
        error: Exception | None = None,
        deleted: bool = True,
        pending: bool = True,
    ) -> None:
        self.error = error
        self.deleted = deleted
        self.pending = pending
        self.executed = []
        self.pending_checks = []

    async def execute(self, job) -> MaterialDeleteResult:
        self.executed.append(job)
        if self.error is not None:
            raise self.error
        return MaterialDeleteResult(deleted=self.deleted)

    async def has_pending_data(self, job) -> bool:
        self.pending_checks.append(job)
        return self.pending


class AnnotationIndexer:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.executed = []

    async def execute(self, snapshot):
        self.executed.append(snapshot)
        if self.error is not None:
            raise self.error
        return snapshot


class AnnotationDeleter:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.executed = []

    async def execute(self, highlight_id) -> None:
        self.executed.append(highlight_id)
        if self.error is not None:
            raise self.error


class Runtime:
    def __init__(
        self,
        indexer: Indexer,
        callback: AsyncMock,
        deleter: Deleter | None = None,
        *,
        annotation_indexer: AnnotationIndexer | None = None,
        annotation_deleter: AnnotationDeleter | None = None,
    ) -> None:
        self.index_pptx_material = indexer
        self.delete_material_index = deleter or Deleter()
        self.callback_client = SimpleNamespace(send=callback)
        # None mirrors the switch being off (ADR-0043 §2).
        self.index_annotation_highlight = annotation_indexer
        self.delete_annotation_highlight = annotation_deleter

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


async def test_success_with_key_terms_sends_a_single_combined_callback() -> None:
    callback = AsyncMock()
    indexer = Indexer(key_terms=(KeyTerm(term="용어", definition="정의"),))

    await MaterialJobHandler(Runtime(indexer, callback)).handle(embed_body())

    assert callback.await_count == 1
    event = callback.await_args.args[0]
    assert event.event_type == "MATERIAL_EMBEDDED"
    assert event.status == "READY"
    assert [(term.term, term.definition) for term in event.key_terms] == [("용어", "정의")]


async def test_combined_callback_failure_retries_the_whole_job_like_before() -> None:
    callback = AsyncMock(side_effect=SpringCallbackError("timeout", retryable=True))
    indexer = Indexer(key_terms=(KeyTerm(term="용어", definition="정의"),))

    with pytest.raises(SpringCallbackError):
        await MaterialJobHandler(Runtime(indexer, callback)).handle(embed_body())


async def test_invalid_body_goes_to_dlq_without_callback() -> None:
    callback = AsyncMock()

    with pytest.raises(PermanentMaterialJobError):
        await MaterialJobHandler(Runtime(Indexer(), callback)).handle(b"not-json")

    callback.assert_not_awaited()


async def test_delete_success_sends_deleted_callback() -> None:
    callback = AsyncMock()
    deleter = Deleter(deleted=True)

    await MaterialJobHandler(Runtime(Indexer(), callback, deleter)).handle(delete_body())

    assert len(deleter.executed) == 1
    event = callback.await_args.args[0]
    assert event.event_type == "MATERIAL_DELETED"
    assert event.status == "DELETED"
    assert event.job_id == "EMBED_DELETE:550e8400-e29b-41d4-a716-446655440000"


async def test_delete_with_nothing_to_remove_is_still_a_success() -> None:
    callback = AsyncMock()
    deleter = Deleter(deleted=False)

    await MaterialJobHandler(Runtime(Indexer(), callback, deleter)).handle(delete_body())

    event = callback.await_args.args[0]
    assert event.event_type == "MATERIAL_DELETED"
    assert event.status == "DELETED"


async def test_permanent_delete_failure_reports_failed_before_dlq() -> None:
    callback = AsyncMock()
    deleter = Deleter(error=MaterialIngestionError("delete rejected"))
    handler = MaterialJobHandler(Runtime(Indexer(), callback, deleter))

    with pytest.raises(PermanentMaterialJobError):
        await handler.handle(delete_body())

    event = callback.await_args.args[0]
    assert event.event_type == "MATERIAL_DELETE_FAILED"
    assert event.status == "FAILED"


async def test_retryable_delete_failure_does_not_emit_terminal_callback() -> None:
    callback = AsyncMock()
    deleter = Deleter(error=RemoteEmbeddingError("db unavailable", retryable=True))

    with pytest.raises(RemoteEmbeddingError):
        await MaterialJobHandler(Runtime(Indexer(), callback, deleter)).handle(delete_body())

    callback.assert_not_awaited()


@pytest.mark.parametrize("pending", [True, False])
async def test_delete_retry_exhaustion_only_reports_failed_if_data_still_exists(
    pending: bool,
) -> None:
    callback = AsyncMock()
    deleter = Deleter(pending=pending)
    handler = MaterialJobHandler(Runtime(Indexer(), callback, deleter))

    await handler.report_retry_exhausted(delete_body())

    assert len(deleter.pending_checks) == 1
    if pending:
        event = callback.await_args.args[0]
        assert event.event_type == "MATERIAL_DELETE_FAILED"
    else:
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


SNAPSHOT_ID = "550e8400-e29b-41d4-a716-446655440010"


def annotation_embed_body(**overrides: object) -> bytes:
    payload: dict[str, object] = {
        "taskType": "ANNOTATION_EMBED",
        "highlightId": SNAPSHOT_ID,
        "sessionId": "550e8400-e29b-41d4-a716-446655440012",
        "lessonId": "550e8400-e29b-41d4-a716-446655440013",
        "curriculumId": "550e8400-e29b-41d4-a716-446655440014",
        "sessionMs": 725_300,
        "capturedAt": "2026-08-04T13:20:05+09:00",
        "text": "B+ tree 노드 분할 조건",
        "policy": {"embedModel": "bge-m3"},
        "contractVersion": 1,
        **overrides,
    }
    return json.dumps(payload, separators=(",", ":")).encode()


def annotation_delete_body() -> bytes:
    return json.dumps(
        {
            "taskType": "ANNOTATION_EMBED_DELETE",
            "highlightId": SNAPSHOT_ID,
            "contractVersion": 1,
        },
        separators=(",", ":"),
    ).encode()


def _annotation_runtime(
    callback: AsyncMock,
    *,
    annotation_indexer: AnnotationIndexer | None = None,
    annotation_deleter: AnnotationDeleter | None = None,
) -> Runtime:
    return Runtime(
        Indexer(),
        callback,
        annotation_indexer=annotation_indexer or AnnotationIndexer(),
        annotation_deleter=annotation_deleter or AnnotationDeleter(),
    )


async def test_annotation_embed_indexes_then_sends_ready_with_highlight_identity() -> None:
    callback = AsyncMock()
    annotation_indexer = AnnotationIndexer()

    await MaterialJobHandler(
        _annotation_runtime(callback, annotation_indexer=annotation_indexer)
    ).handle(annotation_embed_body())

    assert len(annotation_indexer.executed) == 1
    event = callback.await_args.args[0]
    assert event.event_type == "ANNOTATION_EMBEDDED"
    assert event.status == "READY"
    assert event.job_id == f"ANNOTATION_EMBED:{SNAPSHOT_ID}"
    assert str(event.highlight_id) == SNAPSHOT_ID


async def test_annotation_embed_does_not_disturb_the_material_path() -> None:
    """Both families share one queue; routing must key off taskType alone."""
    callback = AsyncMock()
    indexer = Indexer()
    runtime = Runtime(indexer, callback, annotation_indexer=AnnotationIndexer())

    await MaterialJobHandler(runtime).handle(annotation_embed_body())

    assert indexer.executed == []


async def test_annotation_embed_permanent_failure_reports_failed_then_stops_retrying() -> None:
    callback = AsyncMock()
    annotation_indexer = AnnotationIndexer(error=MaterialIngestionError("bad image"))

    with pytest.raises(PermanentMaterialJobError):
        await MaterialJobHandler(
            _annotation_runtime(callback, annotation_indexer=annotation_indexer)
        ).handle(annotation_embed_body())

    event = callback.await_args.args[0]
    assert event.event_type == "ANNOTATION_EMBED_FAILED"
    assert event.status == "FAILED"


async def test_annotation_embed_transient_failure_retries_without_a_callback() -> None:
    callback = AsyncMock()
    annotation_indexer = AnnotationIndexer(error=RemoteEmbeddingError("bge down", retryable=True))

    with pytest.raises(RemoteEmbeddingError):
        await MaterialJobHandler(
            _annotation_runtime(callback, annotation_indexer=annotation_indexer)
        ).handle(annotation_embed_body())

    assert callback.await_count == 0


async def test_annotation_delete_withdraws_without_claiming_the_snapshot_is_indexed() -> None:
    """There is no ANNOTATION_DELETED eventType, and READY would say the opposite of the
    truth — so a withdrawal reports nothing back."""
    callback = AsyncMock()
    annotation_deleter = AnnotationDeleter()

    await MaterialJobHandler(
        _annotation_runtime(callback, annotation_deleter=annotation_deleter)
    ).handle(annotation_delete_body())

    assert len(annotation_deleter.executed) == 1
    assert str(annotation_deleter.executed[0]) == SNAPSHOT_ID
    assert callback.await_count == 0


@pytest.mark.parametrize("body_factory", [annotation_embed_body, annotation_delete_body])
async def test_annotation_jobs_go_to_the_dlq_while_the_switch_is_off(body_factory) -> None:
    """Preserved rather than acked away: turning the switch on and re-publishing recovers
    them, so a deployment-order mismatch loses nothing."""
    callback = AsyncMock()
    runtime = Runtime(Indexer(), callback)

    with pytest.raises(PermanentMaterialJobError, match="annotation ingestion is disabled"):
        await MaterialJobHandler(runtime).handle(body_factory())

    assert callback.await_count == 0


async def test_retry_exhaustion_reports_failure_for_an_annotation_embed() -> None:
    callback = AsyncMock()

    await MaterialJobHandler(_annotation_runtime(callback)).report_retry_exhausted(
        annotation_embed_body()
    )

    event = callback.await_args.args[0]
    assert event.event_type == "ANNOTATION_EMBED_FAILED"
    assert str(event.highlight_id) == SNAPSHOT_ID


async def test_retry_exhaustion_stays_silent_for_an_annotation_delete() -> None:
    callback = AsyncMock()

    await MaterialJobHandler(_annotation_runtime(callback)).report_retry_exhausted(
        annotation_delete_body()
    )

    assert callback.await_count == 0


async def test_retry_exhaustion_stays_silent_while_the_switch_is_off() -> None:
    callback = AsyncMock()

    await MaterialJobHandler(Runtime(Indexer(), callback)).report_retry_exhausted(
        annotation_embed_body()
    )

    assert callback.await_count == 0
