import pytest

from app.adapters.pgvector_key_term_storage import PgvectorKeyTermRepository


class NeverBeginEngine:
    def begin(self):
        raise AssertionError("validation must happen before opening a DB transaction")


def test_repository_rejects_unsafe_runtime_role() -> None:
    with pytest.raises(ValueError, match="safe PostgreSQL role"):
        PgvectorKeyTermRepository(
            NeverBeginEngine(),  # type: ignore[arg-type]
            runtime_role="ai_app; RESET ROLE",
        )


async def test_store_with_no_key_terms_never_opens_a_transaction() -> None:
    repository = PgvectorKeyTermRepository(NeverBeginEngine())  # type: ignore[arg-type]

    await repository.store(73, [])
