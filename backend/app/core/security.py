import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt
from jwt import InvalidTokenError as JwtInvalidTokenError
from pwdlib import PasswordHash

from app.core.config import get_settings

ALGORITHM = "HS256"
password_hash = PasswordHash.recommended()


@dataclass(frozen=True)
class AccessTokenClaims:
  user_id: UUID
  role: str


class InvalidAccessTokenError(ValueError):
  pass


def hash_password(password: str) -> str:
  return password_hash.hash(password)


def verify_password(password: str, encoded: str) -> bool:
  return password_hash.verify(password, encoded)


def create_access_token(user_id: UUID, role: str) -> tuple[str, int]:
  settings = get_settings()
  now = datetime.now(UTC)
  expires_in = settings.access_token_minutes * 60
  token = jwt.encode(
    {
      "sub": str(user_id),
      "role": role,
      "type": "access",
      "iat": now,
      "exp": now + timedelta(seconds=expires_in),
      "jti": str(uuid4()),
    },
    settings.jwt_secret.get_secret_value(),
    algorithm=ALGORITHM,
  )
  return token, expires_in


def decode_access_token(token: str) -> AccessTokenClaims:
  settings = get_settings()
  try:
    payload = jwt.decode(
      token,
      settings.jwt_secret.get_secret_value(),
      algorithms=[ALGORITHM],
      options={"require": ["sub", "role", "type", "iat", "exp", "jti"]},
    )
    if payload["type"] != "access":
      raise InvalidAccessTokenError("invalid token type")
    return AccessTokenClaims(user_id=UUID(payload["sub"]), role=str(payload["role"]))
  except (JwtInvalidTokenError, KeyError, TypeError, ValueError) as exc:
    raise InvalidAccessTokenError("invalid access token") from exc


def create_refresh_token() -> str:
  return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
  return hashlib.sha256(token.encode("utf-8")).hexdigest()
