from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError


ASYNC_POSTGRES_DRIVER = "postgresql+asyncpg"
SYNC_POSTGRES_DRIVER = "postgresql+psycopg"


def parse_async_database_url(value: str) -> URL:
    return _parse_database_url(value, ASYNC_POSTGRES_DRIVER, "database_url")


def parse_migration_database_url(value: str) -> URL:
    return _parse_database_url(value, SYNC_POSTGRES_DRIVER, "migration database URL")


def _parse_database_url(value: str, expected_driver: str, field: str) -> URL:
    try:
        url = make_url(value)
    except ArgumentError as exc:
        raise ValueError(f"{field} must be a valid SQLAlchemy URL") from exc

    if url.drivername != expected_driver:
        raise ValueError(f"{field} must use {expected_driver}")
    if not url.database:
        raise ValueError(f"{field} must name a database")
    return url
