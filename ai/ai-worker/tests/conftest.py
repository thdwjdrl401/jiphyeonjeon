from collections.abc import Iterator
from dataclasses import dataclass
import os
import re
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError, SQLAlchemyError


DEFAULT_TEST_ADMIN_URL = "postgresql+psycopg://liveclass:liveclass@127.0.0.1:5432/postgres"
_SAFE_DATABASE_NAME = re.compile(r"^[a-z0-9_]+_test$")
_SAFE_ROLE_NAME = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


@dataclass(frozen=True, slots=True)
class IntegrationDatabase:
    database_url: str
    migration_database_url: str
    runtime_role: str
    automatically_created: bool


@pytest.fixture(scope="session")
def integration_database() -> Iterator[IntegrationDatabase]:
    """Provide a disposable DB, using the shared server without touching the app DB."""

    database_url = os.getenv("AI_WORKER_TEST_DATABASE_URL")
    migration_database_url = os.getenv("AI_WORKER_TEST_MIGRATION_DATABASE_URL")
    if database_url is not None or migration_database_url is not None:
        if not database_url or not migration_database_url:
            pytest.fail(
                "AI_WORKER_TEST_DATABASE_URL and AI_WORKER_TEST_MIGRATION_DATABASE_URL "
                "must be configured together"
            )
        yield IntegrationDatabase(
            database_url=database_url,
            migration_database_url=migration_database_url,
            runtime_role=_test_runtime_role(),
            automatically_created=False,
        )
        return

    admin_url = _admin_url()
    identity = f"{os.getpid()}_{uuid4().hex[:8]}"
    database_name = f"liveclass_ai_{identity}_test"
    runtime_role = f"ai_app_{identity}_test"
    if not _SAFE_ROLE_NAME.fullmatch(runtime_role):
        raise ValueError("generated integration role name is unsafe")
    admin_engine = create_engine(
        admin_url,
        isolation_level="AUTOCOMMIT",
        pool_pre_ping=True,
    )
    created = False
    try:
        with admin_engine.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{database_name}" TEMPLATE template0'))
        created = True
        yield IntegrationDatabase(
            database_url=_database_url(admin_url, database_name, "postgresql+asyncpg"),
            migration_database_url=_database_url(
                admin_url,
                database_name,
                "postgresql+psycopg",
            ),
            runtime_role=runtime_role,
            automatically_created=True,
        )
    except SQLAlchemyError:
        pytest.fail(
            "automatic pgvector test database provisioning failed; "
            "start `docker compose up -d postgres` or set AI_WORKER_TEST_ADMIN_URL"
        )
    finally:
        if created:
            try:
                with admin_engine.connect() as connection:
                    connection.execute(
                        text(
                            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                            "WHERE datname = :database_name AND pid <> pg_backend_pid()"
                        ),
                        {"database_name": database_name},
                    )
                    connection.execute(text(f'DROP DATABASE IF EXISTS "{database_name}"'))
            except SQLAlchemyError:
                pytest.fail(f"failed to remove isolated pgvector test database {database_name}")
        admin_engine.dispose()


def _admin_url() -> URL:
    raw_url = os.getenv("AI_WORKER_TEST_ADMIN_URL", DEFAULT_TEST_ADMIN_URL)
    try:
        url = make_url(raw_url)
    except ArgumentError:
        pytest.fail("AI_WORKER_TEST_ADMIN_URL must be a valid SQLAlchemy URL")
    if url.drivername != "postgresql+psycopg" or not url.database:
        pytest.fail(
            "AI_WORKER_TEST_ADMIN_URL must use postgresql+psycopg and name an admin database"
        )
    return url


def _database_url(admin_url: URL, database_name: str, driver: str) -> str:
    if not _SAFE_DATABASE_NAME.fullmatch(database_name):
        raise ValueError("generated integration database name is unsafe")
    return admin_url.set(drivername=driver, database=database_name).render_as_string(
        hide_password=False
    )


def _test_runtime_role() -> str:
    role = os.getenv("AI_WORKER_TEST_RUNTIME_ROLE", "ai_app")
    if not _SAFE_ROLE_NAME.fullmatch(role):
        pytest.fail("AI_WORKER_TEST_RUNTIME_ROLE must be a safe PostgreSQL role identifier")
    return role
