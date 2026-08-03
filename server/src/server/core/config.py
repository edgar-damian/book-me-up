"""
Loads app config from the .env file into a typed settings object.
NOTE TO SELF: if you add more env vars you need to add them here 
"""
from typing import List
from pydantic_settings import BaseSettings
from pydantic import field_validator

class Settings(BaseSettings):

    SB_DB_PASSWORD_ON_SETUP: str
    SUPABASE_SECRET_KEY: str
    SUPABASE_JWKS_URL: str

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True

settings = Settings()