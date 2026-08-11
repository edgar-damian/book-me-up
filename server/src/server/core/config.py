"""
Loads app config from the .env file into a typed settings object.
NOTE TO SELF: if you add more env vars you need to add them here

In production there is no .env file - the process environment supplies these,
and a missing one is a startup crash by design. Never add a default for a
secret; a silent fallback is how the wrong key reaches production.
"""

from pathlib import Path
from typing import Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[3] / ".env"  # -> server/.env


class Settings(BaseSettings):
    APP_ENV: Literal["local", "staging", "production"] = "local"

    SB_DB_PASSWORD_ON_SETUP: SecretStr
    SUPABASE_URL: str
    SUPABASE_JWKS_URL: str
    SUPABASE_DB_URL: SecretStr

    # RLS-bypassing. Privileged server-side work only - never a public read.
    SUPABASE_SECRET_KEY: SecretStr
    # RLS-enforced. This is what public endpoints go through.
    SUPABASE_PUBLISHABLE_KEY: SecretStr

    # Browser origins allowed to call this API. Must be explicit in production:
    # "*" plus credentials is rejected by browsers and leaks the API to any site.
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, v):
        """Accept a comma-separated string so the env var stays readable."""
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()
