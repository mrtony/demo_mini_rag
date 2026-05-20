from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .prompt_builder import DEFAULT_CHAT_SYSTEM_PROMPT


ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
LOG_DIR = ROOT_DIR / "logs"
DEFAULT_DB_PATH = DATA_DIR / "chat.db"
DEFAULT_LOG_PATH = LOG_DIR / "backend.log"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Minimal ChatGPT Clone"
    api_prefix: str = "/api"
    database_url: str = f"sqlite+aiosqlite:///{DEFAULT_DB_PATH.as_posix()}"
    openai_api_key: SecretStr = SecretStr("")
    chat_model: str = "gpt-5.4-mini"
    title_model: str = "gpt-5.4-nano"
    chat_system_prompt: str = DEFAULT_CHAT_SYSTEM_PROMPT
    frontend_origin: str = "http://127.0.0.1:5173"
    title_max_length: int = 20
    log_level: str = "INFO"
    log_file: str = str(DEFAULT_LOG_PATH)
    log_db_crud: bool = True
    kb_qdrant_url: str = "http://localhost:6333"
    kb_qdrant_api_key: SecretStr = SecretStr("")
    kb_qdrant_prefer_grpc: bool = False
    kb_embedding_model: str = "BAAI/bge-small-en-v1.5"

    @field_validator("database_url")
    @classmethod
    def normalize_sqlite_path(cls, value: str) -> str:
        if not value.startswith("sqlite"):
            return value
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        return value

    @field_validator("log_file")
    @classmethod
    def ensure_log_dir(cls, value: str) -> str:
        log_path = Path(value)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        return str(log_path)


@lru_cache
def get_settings() -> Settings:
    return Settings()
