from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import get_settings
from app.db import AsyncSessionLocal
from app.pipeline import set_broadcast_hook
from app.routers import exceptions, genai, paper_trading, portfolio, trades, websocket
from app.schemas import HealthResponse
from app.websocket_manager import ws_manager

settings = get_settings()

VERSION = "0.1.0-hackathon"


@asynccontextmanager
async def lifespan(app: FastAPI):
    set_broadcast_hook(ws_manager.sync_broadcast)
    try:
        yield
    finally:
        set_broadcast_hook(None)


app = FastAPI(
    title="Echios STP Trading Platform API",
    description=(
        "Straight-Through Processing trade lifecycle engine with 11-stage pipeline, "
        "exceptions queue, portfolio P&L, and GenAI-assisted order parsing + exception triage. "
        "Websocket at /ws/trades broadcasts trade status changes and new exceptions."
    ),
    version=VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trades.router, prefix="/api")
app.include_router(exceptions.router, prefix="/api")
app.include_router(portfolio.router, prefix="/api")
app.include_router(paper_trading.router, prefix="/api")
app.include_router(genai.router, prefix="/api")
app.include_router(websocket.router)  # no /api prefix for WS endpoint


@app.get("/health", response_model=HealthResponse, tags=["health"])
async def health() -> HealthResponse:
    database_status = "unknown"
    try:
        async with AsyncSessionLocal() as s:
            await s.execute(text("SELECT 1"))
        database_status = "ok"
    except Exception as e:  # pragma: no cover
        database_status = f"error: {e.__class__.__name__}"
    return HealthResponse(status="ok" if database_status == "ok" else "degraded",
                          database=database_status,
                          version=VERSION)


@app.get("/", tags=["meta"])
async def root() -> dict:
    return {
        "name": "Echios STP Trading Platform API",
        "version": VERSION,
        "docs": "/docs",
        "health": "/health",
        "ws": "/ws/trades",
    }
