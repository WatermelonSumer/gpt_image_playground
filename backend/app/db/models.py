import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class UserRole(StrEnum):
  USER = "user"
  SUPER_ADMIN = "super_admin"


class UserStatus(StrEnum):
  ACTIVE = "active"
  DISABLED = "disabled"


class User(Base):
  __tablename__ = "users"
  __table_args__ = (
    CheckConstraint("role IN ('user', 'super_admin')", name="ck_users_role"),
    CheckConstraint("status IN ('active', 'disabled')", name="ck_users_status"),
    UniqueConstraint("email", name="uq_users_email"),
  )

  id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
  email: Mapped[str] = mapped_column(String(320), nullable=False)
  password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
  role: Mapped[str] = mapped_column(String(32), default=UserRole.USER, nullable=False)
  status: Mapped[str] = mapped_column(String(32), default=UserStatus.ACTIVE, nullable=False)
  force_password_change: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
  updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
  last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
  sessions: Mapped[list["UserSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class UserSession(Base):
  __tablename__ = "user_sessions"
  __table_args__ = (
    Index("ix_user_sessions_user_id", "user_id"),
    Index("ix_user_sessions_token_hash", "token_hash", unique=True),
  )

  id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
  user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
  token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
  user_agent: Mapped[str | None] = mapped_column(String(512))
  ip_address: Mapped[str | None] = mapped_column(String(64))
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
  last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
  expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
  revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
  user: Mapped[User] = relationship(back_populates="sessions")
