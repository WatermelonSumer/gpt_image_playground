from app.core.config import Settings


def test_database_url_is_built_from_db_settings() -> None:
  settings = Settings(
    _env_file=None,
    db_host="postgres.internal",
    db_port=5544,
    db_name="pixel engine",
    db_user="pixel@engine",
    db_password="p@ss:/?#word",
    jwt_secret="test-secret-that-is-at-least-32-characters",
  )

  assert settings.database_url == (
    "postgresql+psycopg://pixel%40engine:p%40ss%3A%2F%3F%23word@postgres.internal:5544/pixel engine"
  )
