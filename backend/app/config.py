from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    openai_api_key: str = ""
    openai_chat_model: str = "gpt-5.4-mini"
    openai_title_model: str = "gpt-5.4-nano"
    frontend_origin: str = "http://127.0.0.1:5173"
    title_max_length: int = 20
    log_level: str = "INFO"
    log_file: str = str(DEFAULT_LOG_PATH)
    log_db_crud: bool = True

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
