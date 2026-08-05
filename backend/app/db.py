from __future__ import annotations

from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Literal
from urllib.parse import unquote

from sqlalchemy import BigInteger, event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import ENV_FILE, get_settings

PROJECT_ROOT = ENV_FILE.parent


try:
    from sqlalchemy.ext.compiler import compiles

    @compiles(BigInteger, "sqlite")
    def _bigint_as_integer_for_sqlite(type_, compiler, **kw):  # type: ignore[no-redef]
        return "INTEGER"
except Exception:  # pragma: no cover
    pass


def _resolve_sqlite_url(url: str) -> str:
    prefix = "sqlite+aiosqlite:///"
    if not url.startswith(prefix):
        return url
    raw_path = url[len(prefix) :]
    decoded_path = unquote(raw_path)
    path = Path(decoded_path)
    if not path.is_absolute():
        path = (PROJECT_ROOT / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite+aiosqlite:///{path.as_posix()}"


def _create_sqlite_engine(async_url: str) -> AsyncEngine:
    engine = create_async_engine(
        async_url,
        echo=False,
        future=True,
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine.sync_engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

    return engine


settings = get_settings()

engine: AsyncEngine | None = None
AsyncSessionLocal: async_sessionmaker[AsyncSession] | None = None
active_backend: Literal["sqlite"] | None = None
active_database_url: str | None = None


async def _init_engine() -> None:
    global engine, AsyncSessionLocal, active_backend, active_database_url

    active_database_url = _resolve_sqlite_url(settings.sqlite_database_url)
    engine = _create_sqlite_engine(active_database_url)
    active_backend = "sqlite"
    AsyncSessionLocal = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )


class Base(DeclarativeBase):
    pass


async def init_db() -> None:
    global engine, AsyncSessionLocal
    if engine is None or AsyncSessionLocal is None:
        await _init_engine()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    global engine, AsyncSessionLocal
    if engine is None or AsyncSessionLocal is None:
        await _init_engine()
    assert AsyncSessionLocal is not None
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
