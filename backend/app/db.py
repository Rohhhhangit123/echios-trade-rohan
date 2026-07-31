from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings


def _to_async_url(sync_url: str) -> str:
    prefix = "postgresql://"
    if sync_url.startswith(prefix):
        return "postgresql+asyncpg://" + sync_url[len(prefix):]
    if sync_url.startswith("postgresql+asyncpg://"):
        return sync_url
    raise ValueError(f"Unsupported DB URL scheme: {sync_url[:30]}...")


settings = get_settings()
ASYNC_DATABASE_URL = _to_async_url(settings.database_url)

engine: AsyncEngine = create_async_engine(
    ASYNC_DATABASE_URL,
    echo=False,
    future=True,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    connect_args={"server_settings": {"application_name": "echios_stp_backend"}},
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
