from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse, unquote

from sqlalchemy import BigInteger, event, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.sql import sqltypes

from .config import ENV_FILE, get_settings

logger = logging.getLogger(__name__)

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


def _to_async_pg_url(sync_url: str) -> str:
    prefix = "postgresql://"
    if sync_url.startswith(prefix):
        return "postgresql+asyncpg://" + sync_url[len(prefix) :]
    if sync_url.startswith("postgresql+asyncpg://"):
        return sync_url
    raise ValueError(f"Unsupported DB URL scheme for Postgres: {sync_url[:30]}...")


def _create_pg_engine(async_url: str) -> AsyncEngine:
    return create_async_engine(
        async_url,
        echo=False,
        future=True,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        connect_args={"server_settings": {"application_name": "echios_stp_backend"}},
    )


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


async def _test_engine(engine: AsyncEngine, timeout: float = 5.0) -> bool:
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        logger.warning(f"Database engine test failed: {e.__class__.__name__}: {e}")
        return False


settings = get_settings()

engine: AsyncEngine | None = None
AsyncSessionLocal: async_sessionmaker[AsyncSession] | None = None
active_backend: Literal["postgresql", "sqlite", None] = None
active_database_url: str | None = None


async def _init_engine() -> None:
    global engine, AsyncSessionLocal, active_backend, active_database_url

    resolved_sqlite_url = _resolve_sqlite_url(settings.sqlite_database_url)

    if settings.force_sqlite:
        sqlite_engine = _create_sqlite_engine(resolved_sqlite_url)
        engine = sqlite_engine
        active_backend = "sqlite"
        active_database_url = resolved_sqlite_url
        logger.info(
            f"FORCE_SQLITE=true — using pure local SQLite (no external connection): {resolved_sqlite_url}"
        )
        AsyncSessionLocal = async_sessionmaker(
            bind=engine,
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
        )
        return

    pg_engine: AsyncEngine | None = None
    pg_ok = False

    if not settings.database_url:
        logger.warning("DATABASE_URL is not set — skipping PostgreSQL (Supabase) attempt")
    else:
        try:
            pg_async_url = _to_async_pg_url(settings.database_url)
            pg_engine = _create_pg_engine(pg_async_url)
            pg_ok = await _test_engine(pg_engine)
        except Exception as e:
            logger.warning(
                f"Failed to initialize PostgreSQL (Supabase): {e.__class__.__name__}: {e}"
            )
            pg_ok = False

    if pg_ok and pg_engine is not None:
        engine = pg_engine
        active_backend = "postgresql"
        active_database_url = settings.database_url
        logger.info("Using PostgreSQL (Supabase) as database backend")
    elif settings.use_sqlite_fallback:
        if pg_engine is not None:
            try:
                await pg_engine.dispose()
            except Exception:
                pass
        sqlite_engine = _create_sqlite_engine(resolved_sqlite_url)
        engine = sqlite_engine
        active_backend = "sqlite"
        active_database_url = resolved_sqlite_url
        logger.warning(
            f"PostgreSQL (Supabase) unavailable. Falling back to SQLite: {resolved_sqlite_url}"
        )
    else:
        if pg_engine is not None:
            try:
                await pg_engine.dispose()
            except Exception:
                pass
        raise RuntimeError(
            "PostgreSQL (Supabase) is unreachable and USE_SQLITE_FALLBACK is disabled. "
            "Cannot start application without a working database."
        )

    assert engine is not None
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
