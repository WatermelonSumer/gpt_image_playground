from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_refresh_token, hash_refresh_token, verify_password
from app.db.models import User, UserSession, UserStatus


class InactiveUserError(ValueError):
  pass


def normalize_email(email: str) -> str:
  return email.strip().lower()


def ensure_utc(value: datetime) -> datetime:
  if value.tzinfo is None:
    return value.replace(tzinfo=UTC)
  return value.astimezone(UTC)


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User | None:
  user = await db.scalar(select(User).where(User.email == normalize_email(email)))
  if user is None or not verify_password(password, user.password_hash):
    return None
  if user.status != UserStatus.ACTIVE:
    raise InactiveUserError
  return user


async def create_user_session(
  db: AsyncSession,
  user: User,
  user_agent: str | None,
  ip_address: str | None,
) -> str:
  settings = get_settings()
  now = datetime.now(UTC)
  token = create_refresh_token()
  db.add(
    UserSession(
      user_id=user.id,
      token_hash=hash_refresh_token(token),
      user_agent=user_agent,
      ip_address=ip_address,
      last_seen_at=now,
      expires_at=now + timedelta(days=settings.refresh_session_days),
    )
  )
  user.last_login_at = now
  await db.commit()
  return token


async def rotate_user_session(db: AsyncSession, token: str) -> tuple[User, str] | None:
  token_hash = hash_refresh_token(token)
  session = await db.scalar(
    select(UserSession).where(UserSession.token_hash == token_hash).with_for_update()
  )
  if session is None or session.revoked_at is not None:
    return None

  now = datetime.now(UTC)
  if ensure_utc(session.expires_at) <= now:
    session.revoked_at = now
    await db.commit()
    return None

  user = await db.get(User, session.user_id)
  if user is None or user.status != UserStatus.ACTIVE:
    session.revoked_at = now
    await db.commit()
    return None

  next_token = create_refresh_token()
  session.token_hash = hash_refresh_token(next_token)
  session.last_seen_at = now
  await db.commit()
  return user, next_token


async def revoke_user_session(db: AsyncSession, token: str) -> None:
  session = await db.scalar(
    select(UserSession).where(UserSession.token_hash == hash_refresh_token(token)).with_for_update()
  )
  if session is None or session.revoked_at is not None:
    return
  session.revoked_at = datetime.now(UTC)
  await db.commit()


async def get_active_user(db: AsyncSession, user_id: UUID) -> User | None:
  user = await db.get(User, user_id)
  if user is None or user.status != UserStatus.ACTIVE:
    return None
  return user
