from types import SimpleNamespace

from pydantic import SecretStr

from backend.app.config import Settings
from backend.app.services import kb_document_service


def test_settings_use_qdrant_server_defaults(monkeypatch):
    monkeypatch.delenv("KB_QDRANT_URL", raising=False)
    monkeypatch.delenv("KB_QDRANT_API_KEY", raising=False)
    monkeypatch.delenv("KB_QDRANT_PREFER_GRPC", raising=False)

    settings = Settings(_env_file=None)

    assert settings.kb_qdrant_url == "http://localhost:6333"
    assert settings.kb_qdrant_api_key.get_secret_value() == ""
    assert settings.kb_qdrant_prefer_grpc is False
    assert not hasattr(settings, "kb_qdrant_path")


def test_settings_read_qdrant_server_environment(monkeypatch):
    monkeypatch.setenv("KB_QDRANT_URL", "https://qdrant.example.test:6333")
    monkeypatch.setenv("KB_QDRANT_API_KEY", "test-key")
    monkeypatch.setenv("KB_QDRANT_PREFER_GRPC", "true")

    settings = Settings(_env_file=None)

    assert settings.kb_qdrant_url == "https://qdrant.example.test:6333"
    assert settings.kb_qdrant_api_key.get_secret_value() == "test-key"
    assert settings.kb_qdrant_prefer_grpc is True


def test_knowledge_base_backend_factory_uses_qdrant_server_settings(monkeypatch):
    captured_kwargs = {}
    backend = object()

    class RecordingBackend:
        def __new__(cls, **kwargs):
            captured_kwargs.update(kwargs)
            return backend

    monkeypatch.setattr(
        kb_document_service,
        "get_settings",
        lambda: SimpleNamespace(
            kb_qdrant_url="https://qdrant.example.test:6333",
            kb_qdrant_api_key=SecretStr(""),
            kb_qdrant_prefer_grpc=True,
            kb_embedding_model="BAAI/bge-small-en-v1.5",
        ),
    )
    monkeypatch.setattr(
        kb_document_service,
        "LlamaIndexQdrantKnowledgeBaseBackend",
        RecordingBackend,
    )
    kb_document_service.get_knowledge_base_backend.cache_clear()

    try:
        result = kb_document_service.get_knowledge_base_backend()
    finally:
        kb_document_service.get_knowledge_base_backend.cache_clear()

    assert result is backend
    assert captured_kwargs == {
        "qdrant_url": "https://qdrant.example.test:6333",
        "qdrant_api_key": None,
        "qdrant_prefer_grpc": True,
        "embedding_model_name": "BAAI/bge-small-en-v1.5",
    }
