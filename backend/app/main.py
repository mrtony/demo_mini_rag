import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import ROOT_DIR, get_settings
from .db import init_db
from .logging_config import setup_logging
from .routes import router


settings = get_settings()
setup_logging(settings)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("Application startup")
    await init_db()
    yield
    logger.info("Application shutdown")


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router, prefix=settings.api_prefix)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info("HTTP %s %s started", request.method, request.url.path)
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("HTTP %s %s failed", request.method, request.url.path)
        raise
    logger.info(
        "HTTP %s %s completed with %s",
        request.method,
        request.url.path,
        response.status_code,
    )
    return response


dist_dir = ROOT_DIR / "frontend" / "dist"
if Path(dist_dir).exists():
    app.mount("/", StaticFiles(directory=dist_dir, html=True), name="frontend")
