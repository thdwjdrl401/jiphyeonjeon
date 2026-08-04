import asyncio
from collections.abc import Iterator
from dataclasses import dataclass
import os
from pathlib import Path
import re
from uuid import uuid4

import asyncpg
import pytest
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError


def _repo_root() -> Path:
    """Where the monorepo starts, for the few tests that guard cross-service files.

    CI copies only `ai/ai-api` into the build container, so walking up from `__file__`
    lands outside the filesystem and raises. `LIVECLASS_REPO_ROOT` lets the job mount the
    repository and point at it instead of those tests being skipped — a deployment-config
    guard that never runs is the same as not having one.
    """

    override = os.getenv("LIVECLASS_REPO_ROOT")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[3]


REPO_ROOT = _repo_root()
AI_ROOT = REPO_ROOT / "ai"

DEFAULT_TEST_ADMIN_URL = "postgresql+asyncpg://liveclass:liveclass@127.0.0.1:5432/postgres"
_SAFE_DATABASE_NAME = re.compile(r"^[a-z0-9_]+_test$")
_SAFE_ROLE_NAME = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


@dataclass(frozen=True, slots=True)
class IntegrationDatabase:
    database_url: str
    runtime_role: str


@pytest.fixture(scope="session")
def integration_database() -> Iterator[IntegrationDatabase]:
    """Create a disposable pgvector database without touching the shared application DB."""

    admin_url = _admin_url()
    identity = f"{os.getpid()}_{uuid4().hex[:8]}"
    database_name = f"liveclass_ai_api_{identity}_test"
    runtime_role = f"ai_reader_{identity}_test"
    if not _SAFE_DATABASE_NAME.fullmatch(database_name):
        raise ValueError("generated integration database name is unsafe")
    if not _SAFE_ROLE_NAME.fullmatch(runtime_role):
        raise ValueError("generated integration role name is unsafe")

    try:
        asyncio.run(_provision(admin_url, database_name, runtime_role))
    except (OSError, asyncpg.PostgresError) as exc:
        pytest.fail(
            "automatic pgvector test database provisioning failed; "
            "start `docker compose up -d postgres` or set AI_API_TEST_POSTGRES_ADMIN_URL: "
            f"{type(exc).__name__}"
        )

    try:
        yield IntegrationDatabase(
            database_url=admin_url.set(database=database_name).render_as_string(
                hide_password=False
            ),
            runtime_role=runtime_role,
        )
    finally:
        try:
            asyncio.run(_cleanup(admin_url, database_name, runtime_role))
        except (OSError, asyncpg.PostgresError) as exc:
            pytest.fail(f"failed to remove isolated pgvector test database: {type(exc).__name__}")


def _admin_url() -> URL:
    raw_url = os.getenv("AI_API_TEST_POSTGRES_ADMIN_URL", DEFAULT_TEST_ADMIN_URL)
    try:
        url = make_url(raw_url)
    except ArgumentError:
        pytest.fail("AI_API_TEST_POSTGRES_ADMIN_URL must be a valid SQLAlchemy URL")
    if url.drivername != "postgresql+asyncpg" or not url.database:
        pytest.fail(
            "AI_API_TEST_POSTGRES_ADMIN_URL must use postgresql+asyncpg and name an admin DB"
        )
    return url


async def _connect(url: URL, *, database: str | None = None) -> asyncpg.Connection:
    return await asyncpg.connect(
        host=url.host,
        port=url.port or 5432,
        user=url.username,
        password=url.password,
        database=database or url.database,
    )


async def _provision(admin_url: URL, database_name: str, runtime_role: str) -> None:
    connection = await _connect(admin_url)
    database_created = False
    role_created = False
    try:
        await connection.execute(f'CREATE DATABASE "{database_name}" TEMPLATE template0')
        database_created = True
        await connection.execute(f"CREATE ROLE {runtime_role} NOLOGIN NOINHERIT")
        role_created = True
    except BaseException:
        if database_created:
            await connection.execute(f'DROP DATABASE IF EXISTS "{database_name}"')
        if role_created:
            await connection.execute(f"DROP ROLE IF EXISTS {runtime_role}")
        raise
    finally:
        await connection.close()


async def _cleanup(admin_url: URL, database_name: str, runtime_role: str) -> None:
    if not _SAFE_DATABASE_NAME.fullmatch(database_name):
        raise ValueError("refusing to remove an unsafe integration database")
    if not _SAFE_ROLE_NAME.fullmatch(runtime_role):
        raise ValueError("refusing to remove an unsafe integration role")
    connection = await _connect(admin_url)
    try:
        await connection.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = $1 AND pid <> pg_backend_pid()",
            database_name,
        )
        await connection.execute(f'DROP DATABASE IF EXISTS "{database_name}"')
        await connection.execute(f"DROP ROLE IF EXISTS {runtime_role}")
    finally:
        await connection.close()
