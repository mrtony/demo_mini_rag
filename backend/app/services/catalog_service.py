from __future__ import annotations

import json

from sqlalchemy import select

from .. import db as db_module
from ..config import get_settings
from ..models import ModelCatalog


def _catalog_seed(default_model_id: str) -> list[dict[str, object]]:
    seed = [
        {
            "model_id": "gpt-5.4-mini",
            "label": "GPT 5.4 Mini",
            "provider": "openai",
            "is_enabled": True,
            "supports_system_message": True,
            "settings_schema_json": {
                "temperature": {
                    "type": "number",
                    "label": "Temperature",
                    "min": 0,
                    "max": 2,
                    "step": 0.1,
                    "help_text": "Higher values make replies more exploratory.",
                },
                "reasoning_effort": {
                    "type": "enum",
                    "label": "Reasoning effort",
                    "options": [
                        {"value": "minimal", "label": "Minimal"},
                        {"value": "medium", "label": "Medium"},
                        {"value": "high", "label": "High"},
                    ],
                    "help_text": "Controls how much reasoning budget the model uses.",
                },
            },
            "settings_defaults_json": {
                "temperature": 1.0,
                "reasoning_effort": "medium",
            },
            "sort_order": 0,
        },
        {
            "model_id": "gpt-5.4-nano",
            "label": "GPT 5.4 Nano",
            "provider": "openai",
            "is_enabled": True,
            "supports_system_message": True,
            "settings_schema_json": {
                "temperature": {
                    "type": "number",
                    "label": "Temperature",
                    "min": 0,
                    "max": 2,
                    "step": 0.1,
                    "help_text": "Higher values make replies more exploratory.",
                },
            },
            "settings_defaults_json": {
                "temperature": 0.7,
            },
            "sort_order": 1,
        },
        {
            "model_id": "gpt-4.1-classic",
            "label": "GPT 4.1 Classic",
            "provider": "openai",
            "is_enabled": False,
            "supports_system_message": True,
            "settings_schema_json": {
                "temperature": {
                    "type": "number",
                    "label": "Temperature",
                    "min": 0,
                    "max": 2,
                    "step": 0.1,
                    "help_text": "Higher values make replies more exploratory.",
                },
            },
            "settings_defaults_json": {
                "temperature": 1.0,
            },
            "sort_order": 2,
        },
    ]

    if default_model_id not in {item["model_id"] for item in seed}:
        seed.append(
            {
                "model_id": default_model_id,
                "label": default_model_id,
                "provider": "openai",
                "is_enabled": True,
                "supports_system_message": True,
                "settings_schema_json": seed[0]["settings_schema_json"],
                "settings_defaults_json": seed[0]["settings_defaults_json"],
                "sort_order": len(seed),
            }
        )

    for item in seed:
        item["is_default_workspace_model"] = item["model_id"] == default_model_id

    return seed


async def seed_model_catalog() -> None:
    settings = get_settings()
    catalog_seed = _catalog_seed(settings.chat_model)

    async with db_module.SessionLocal() as session:
        existing_rows = (
            await session.execute(select(ModelCatalog).order_by(ModelCatalog.id.asc()))
        ).scalars().all()
        existing_by_model_id = {item.model_id: item for item in existing_rows}

        for item in catalog_seed:
            existing_model = existing_by_model_id.get(str(item["model_id"]))
            if existing_model is None:
                session.add(
                    ModelCatalog(
                        model_id=str(item["model_id"]),
                        label=str(item["label"]),
                        provider=str(item["provider"]),
                        is_enabled=bool(item["is_enabled"]),
                        is_default_workspace_model=bool(item["is_default_workspace_model"]),
                        supports_system_message=bool(item["supports_system_message"]),
                        settings_schema_json=json.dumps(item["settings_schema_json"]),
                        settings_defaults_json=json.dumps(item["settings_defaults_json"]),
                        sort_order=int(item["sort_order"]),
                    )
                )
                continue

            existing_model.label = str(item["label"])
            existing_model.provider = str(item["provider"])
            existing_model.is_enabled = bool(item["is_enabled"])
            existing_model.is_default_workspace_model = bool(item["is_default_workspace_model"])
            existing_model.supports_system_message = bool(item["supports_system_message"])
            existing_model.settings_schema_json = json.dumps(item["settings_schema_json"])
            existing_model.settings_defaults_json = json.dumps(item["settings_defaults_json"])
            existing_model.sort_order = int(item["sort_order"])

        await session.commit()
