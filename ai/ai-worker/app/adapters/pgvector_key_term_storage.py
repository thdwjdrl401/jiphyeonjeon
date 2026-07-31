from __future__ import annotations

import re
from collections.abc import Sequence

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.ingestion import KeyTerm


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
