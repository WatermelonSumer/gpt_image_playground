from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL

PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
  model_config = SettingsConfigDict(
    env_file=PROJECT_ROOT / ".env",
    env_file_encoding="utf-8",
    extra="ignore",
  )

  app_env: Literal["development", "test", "production"] = "development"
  backend_host: str = "0.0.0.0"
  backend_port: int = 8000
  frontend_url: str = "http://localhost:5173"
  db_host: str = "localhost"
  db_port: int = Field(default=5432, ge=1, le=65535)
  db_name: str
  db_user: str
  db_password: SecretStr
  redis_url: str = "redis://localhost:6379/0"
  jwt_secret: SecretStr = Field(min_length=32)
  access_token_minutes: int = Field(default=15, ge=1, le=1440)
  refresh_session_days: int = Field(default=30, ge=1, le=365)
  refresh_cookie_name: str = "pixelengine_refresh"
  cookie_secure: bool = False
  initial_super_admin_email: str | None = None
  initial_super_admin_password: SecretStr | None = Field(default=None, min_length=12)

  @property
  def database_url(self) -> str:
    return URL.create(
      drivername="postgresql+psycopg",
      username=self.db_user,
      password=self.db_password.get_secret_value(),
      host=self.db_host,
      port=self.db_port,
      database=self.db_name,
    ).render_as_string(hide_password=False)


@lru_cache
def get_settings() -> Settings:
  return Settings()
