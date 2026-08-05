from datetime import date
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"
DEFAULT_VECTOR_INDEX = Path(__file__).resolve().parent.parent / ".cache" / "simulated_market_vectors.sqlite3"


class Settings(BaseSettings):
    database_url: str = ""
    force_sqlite: bool = True
    use_sqlite_fallback: bool = True
    sqlite_database_url: str = "sqlite+aiosqlite:///./backend/echios_local.db"
    jwt_secret: str = "dev-only-change-me-in-prod-please-1234567890abcdef"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60 * 24
    default_admin_email: str = "admin@echios.local"
    default_admin_password: str = "admin123"
    default_admin_name: str = "Platform Admin"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"
    litellm_api_base: str = ""
    litellm_api_key: str = ""
    litellm_model: str = "nova"
    frontend_origin: str = "http://localhost:3000"
    host: str = "0.0.0.0"
    port: int = 8000
    assistant_client_id: int = 1
    simulation_as_of: date | None = None
    assistant_embedding_model: str = "BAAI/bge-small-en-v1.5"
    assistant_vector_index_path: Path = DEFAULT_VECTOR_INDEX
    assistant_semantic_result_limit: int = 8
    assistant_user_data_source_label: str = "Supabase database"

    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
