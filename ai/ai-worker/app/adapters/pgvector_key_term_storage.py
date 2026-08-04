from __future__ import annotations

import re
from collections.abc import Sequence

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.ingestion import KeyTerm, KeyTermExtractionResult


_DATABASE_ROLE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


class PgvectorKeyTermRepository:
    """Persist extracted key terms against their owning material version (ADR-0005)."""

    def __init__(self, engine: AsyncEngine, *, runtime_role: str = "ai_app") -> None:
        if not _DATABASE_ROLE.fullmatch(runtime_role):
            raise ValueError("runtime_role must be a safe PostgreSQL role identifier")
        self._engine = engine
        self._set_runtime_role = text(f"SET LOCAL ROLE {runtime_role}")

    async def store(self, version_id: int, key_terms: Sequence[KeyTerm]) -> None:
        if not key_terms:
            return
        async with self._engine.begin() as connection:
            await connection.execute(self._set_runtime_role)
            for term in key_terms:
                await connection.execute(
                    text(
                        """
                        INSERT INTO ai.material_key_term (
                          material_version_id, term, definition
                        ) VALUES (
                          :version_id, :term, :definition
                        )
                        ON CONFLICT (material_version_id, term)
                        DO UPDATE SET definition = EXCLUDED.definition
                        """
                    ),
                    {
                        "version_id": version_id,
                        "term": term.term,
                        "definition": term.definition,
                    },
                )

    async def store_result(
        self,
        version_id: int,
        result: KeyTermExtractionResult,
    ) -> None:
        async with self._engine.begin() as connection:
            await connection.execute(self._set_runtime_role)
            version = await connection.execute(
                text(
                    """
                    UPDATE ai.material_version
                    SET key_term_status = :status,
                        key_term_count = :count,
                        key_term_truncated = :truncated,
                        key_term_failure_code = :failure_code
                    WHERE id = :version_id
                    """
                ),
                {
                    "version_id": version_id,
                    "status": result.status,
                    "count": result.count,
                    "truncated": result.truncated,
                    "failure_code": result.failure_code,
                },
            )
            if version.rowcount != 1:
                raise ValueError("material version for key-term result does not exist")
            await connection.execute(
                text(
                    """
                    DELETE FROM ai.material_key_term
                    WHERE material_version_id = :version_id
                    """
                ),
                {"version_id": version_id},
            )
            for term in result.terms:
                await connection.execute(
                    text(
                        """
                        INSERT INTO ai.material_key_term (
                          material_version_id, term, definition
                        ) VALUES (
                          :version_id, :term, :definition
                        )
                        ON CONFLICT (material_version_id, term)
                        DO UPDATE SET definition = EXCLUDED.definition
                        """
                    ),
                    {
                        "version_id": version_id,
                        "term": term.term,
                        "definition": term.definition,
                    },
                )

    async def load_result(self, version_id: int) -> KeyTermExtractionResult | None:
        async with self._engine.begin() as connection:
            await connection.execute(self._set_runtime_role)
            row = (
                (
                    await connection.execute(
                        text(
                            """
                            SELECT key_term_status, key_term_count,
                                   key_term_truncated, key_term_failure_code
                            FROM ai.material_version
                            WHERE id = :version_id
                            """
                        ),
                        {"version_id": version_id},
                    )
                )
                .mappings()
                .one_or_none()
            )
            if row is None:
                return None
            terms = ()
            if row["key_term_status"] == "READY":
                terms = tuple(
                    KeyTerm(term=term, definition=definition)
                    for term, definition in (
                        await connection.execute(
                            text(
                                """
                                SELECT term, definition
                                FROM ai.material_key_term
                                WHERE material_version_id = :version_id
                                ORDER BY term
                                """
                            ),
                            {"version_id": version_id},
                        )
                    ).all()
                )
                if len(terms) != int(row["key_term_count"]):
                    raise ValueError(
                        "stored key-term count does not match material version metadata"
                    )
            return KeyTermExtractionResult(
                status=row["key_term_status"],
                terms=terms,
                failure_code=row["key_term_failure_code"],
                truncated=bool(row["key_term_truncated"]),
            )
