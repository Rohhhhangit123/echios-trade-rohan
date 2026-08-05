from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


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
    litellm_api_base: str = ""
    litellm_api_key: str = ""
    litellm_model: str = "nova"
    frontend_origin: str = "http://localhost:3000"
    host: str = "0.0.0.0"
    port: int = 8000

    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
