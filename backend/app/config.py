from datetime import date
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    database_url: str
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"
    litellm_api_base: str = ""
    litellm_api_key: str = ""
    litellm_model: str = "nova"
    frontend_origin: str = "http://localhost:3000"
    host: str = "0.0.0.0"
    port: int = 8000
    assistant_stub_client_id: int = 1
    simulation_as_of: date | None = None

    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
