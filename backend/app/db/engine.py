"""
SQLAlchemy async database engine and session maker setup.
"""

from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.config import get_settings

settings = get_settings()

if not settings.database_url:
    raise ValueError("DATABASE_URL is not set in environment or config.")

# Create the async engine
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    future=True,
    pool_pre_ping=True,
)

# Async session factory
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for dependency injection in FastAPI."""
    async with async_session_maker() as session:
        yield session
