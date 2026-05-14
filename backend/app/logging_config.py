import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

from .config import Settings


LOG_FORMAT = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"


def setup_logging(settings: Settings) -> None:
    root_logger = logging.getLogger()
    if getattr(root_logger, "_demo_chatgpt_logging_configured", False):
        return

    log_level = getattr(logging, settings.log_level.upper(), logging.INFO)
    log_file = Path(settings.log_file)
    log_file.parent.mkdir(parents=True, exist_ok=True)

    formatter = logging.Formatter(LOG_FORMAT)

    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=1_048_576,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(log_level)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.setLevel(log_level)

    root_logger.setLevel(log_level)
    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)
    root_logger._demo_chatgpt_logging_configured = True

    logging.getLogger("uvicorn.access").setLevel(log_level)
    logging.getLogger("uvicorn.error").setLevel(log_level)
    logging.getLogger(__name__).info("Logging initialized at %s", log_file)
