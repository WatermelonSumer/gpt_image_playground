import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, Uuid, func
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


# ── 模型池 ───────────────────────────────────────────────────────────────────

class Provider(Base):
  """AI 厂商，例如 OpenAI、Google、xAI。"""
  __tablename__ = "providers"
  __table_args__ = (
    Index("ix_providers_slug", "slug", unique=True),
  )

  id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
  name: Mapped[str] = mapped_column(String(100), nullable=False)
  slug: Mapped[str] = mapped_column(String(50), nullable=False)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
  updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

  channels: Mapped[list["Channel"]] = relationship(back_populates="provider", cascade="all, delete-orphan")
  platform_models: Mapped[list["PlatformModel"]] = relationship(back_populates="provider", cascade="all, delete-orphan")


class Channel(Base):
  """上游 API 渠道，归属于某个厂商。api_key 字段应在存储前加密。"""
  __tablename__ = "channels"
  __table_args__ = (
    Index("ix_channels_provider_id", "provider_id"),
  )

  id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
  provider_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("providers.id", ondelete="CASCADE"), nullable=False)
  name: Mapped[str] = mapped_column(String(100), nullable=False)
  base_url: Mapped[str] = mapped_column(String(500), nullable=False)
  api_key: Mapped[str] = mapped_column(String(500), nullable=False)
  priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
  weight: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
  max_concurrent: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
  is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
  updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

  provider: Mapped["Provider"] = relationship(back_populates="channels")


class PlatformModel(Base):
  """模型池中的平台模型，普通用户可见并调用。"""
  __tablename__ = "platform_models"
  __table_args__ = (
    Index("ix_platform_models_platform_model_id", "platform_model_id", unique=True),
    Index("ix_platform_models_provider_id", "provider_id"),
  )

  id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
  provider_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("providers.id", ondelete="CASCADE"), nullable=False)
  # 对用户暴露的稳定模型 ID，例如 "gpt-image-1"、"imagen-3"
  platform_model_id: Mapped[str] = mapped_column(String(100), nullable=False)
  display_name: Mapped[str] = mapped_column(String(200), nullable=False)
  # 实际转发给上游 API 的模型 ID
  upstream_model_id: Mapped[str] = mapped_column(String(200), nullable=False)
  # 每张图片消耗的额度，整数存储避免浮点误差（100 = 1.00 额度）
  unit_price: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
  # 能力标志
  supports_edit: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
  supports_size: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
  supports_quality: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
  supports_n: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
  max_n: Mapped[int] = mapped_column(Integer, default=4, nullable=False)
  is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
  updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

  provider: Mapped["Provider"] = relationship(back_populates="platform_models")
