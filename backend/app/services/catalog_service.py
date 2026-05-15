from __future__ import annotations

from sqlalchemy import select

from ..config import get_settings
from .. import db as db_module
from ..models import ModelCatalog


async def seed_model_catalog() -> None:
    settings = get_settings()

    async with db_module.SessionLocal() as session:
        result = await session.execute(select(ModelCatalog).where(ModelCatalog.model_id == settings.chat_model))
        existing_model = result.scalar_one_or_none()
        if existing_model is not None:
            existing_model.label = settings.chat_model
            existing_model.is_enabled = True
            existing_model.is_default_workspace_model = True
            await session.commit()
            return

        session.add(
            ModelCatalog(
                model_id=settings.chat_model,
                label=settings.chat_model,
                provider="openai",
                is_enabled=True,
                is_default_workspace_model=True,
            )
        )
        await session.commit()
