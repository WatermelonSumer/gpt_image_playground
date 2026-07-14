import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# 生产环境（PostgreSQL）使用 JSONB，测试（SQLite）回退到通用 JSON。
JSONType = JSON().with_variant(JSONB(), "postgresql")


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


# ── 额度 ──────────────────────────────────────────────────────────────────────

class LedgerType(StrEnum):
  CHARGE = "charge"        # 扣费（生成请求）
  REFUND = "refund"        # 退款（生成失败）
  TOPUP = "topup"          # 充值


class UserCredit(Base):
  """用户当前余额快照。每次变动通过 CreditLedger 记录，余额由触发器维护或应用层更新。"""
  __tablename__ = "user_credits"
  __table_args__ = (
    UniqueConstraint("user_id", name="uq_user_credits_user_id"),
  )

  id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
  user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
  # 余额，整数存储（100 = 1.00 额度）
  balance: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
  updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

  user: Mapped["User"] = relationship()


class CreditLedger(Base):
  """额度流水，每笔余额变动的不可变审计记录。"""
  __tablename__ = "credit_ledger"
  __table_args__ = (
    Index("ix_credit_ledger_user_id", "user_id"),
    Index("ix_credit_ledger_generation_id", "generation_id"),
  )

  id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
  user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
  # 关联的生成请求（充值时为空）
  generation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("generation_requests.id", ondelete="SET NULL"), nullable=True)
  type: Mapped[str] = mapped_column(String(32), nullable=False)
  # 变化量，正数（退款/充值）或负数（扣费），单位与 UserCredit.balance 相同
  delta: Mapped[int] = mapped_column(Integer, nullable=False)
  # 变动后余额快照，便于对账
  balance_after: Mapped[int] = mapped_column(Integer, nullable=False)
  note: Mapped[str | None] = mapped_column(String(500))
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

  user: Mapped["User"] = relationship()


# ── 生成请求 ──────────────────────────────────────────────────────────────────

class GenerationStatus(StrEnum):
  QUEUED = "queued"
  RUNNING = "running"
  DONE = "done"
  ERROR = "error"


class GenerationRequest(Base):
  """一次图片生成请求，贯穿整个异步生命周期。"""
  __tablename__ = "generation_requests"
  __table_args__ = (
    CheckConstraint("status IN ('queued','running','done','error')", name="ck_gen_req_status"),
    Index("ix_gen_req_user_id", "user_id"),
    Index("ix_gen_req_status", "status"),
  )

  id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
  user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

  # ── 请求参数快照 ──────────────────────────────────────────────────────
  prompt: Mapped[str] = mapped_column(Text, nullable=False)
  # 完整参数 JSON（size/quality/n/format 等）
  params: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
  # 上传的输入图片 b64（编辑模式，最多保留到任务完成后由 worker 清空）
  input_images: Mapped[list[Any]] = mapped_column(JSONType, nullable=False, default=list)
  # 遮罩图片 b64（编辑模式）
  mask_image: Mapped[str | None] = mapped_column(Text)

  # ── 模型快照（建单时锁定，防止模型下架后账单信息丢失） ──────────────
  platform_model_id: Mapped[str] = mapped_column(String(100), nullable=False)
  display_name: Mapped[str] = mapped_column(String(200), nullable=False)
  # 建单时的单价（单张图片，整数分）
  unit_price: Mapped[int] = mapped_column(Integer, nullable=False)
  # 请求的图片数量
  requested_n: Mapped[int] = mapped_column(Integer, nullable=False)
  # 实际预扣额度 = unit_price × requested_n
  charged_credits: Mapped[int] = mapped_column(Integer, nullable=False)

  # ── 状态 ─────────────────────────────────────────────────────────────
  status: Mapped[str] = mapped_column(String(32), default=GenerationStatus.QUEUED, nullable=False)
  error_code: Mapped[str | None] = mapped_column(String(64))
  error_message: Mapped[str | None] = mapped_column(String(500))

  # ── 结果（完成后暂存，客户端取走后由 worker 清空） ────────────────────
  # 生成的图片列表，每项 {"b64_json": "...", "width": N, "height": N, "revised_prompt": "..."}
  result_images: Mapped[list[Any] | None] = mapped_column(JSONType)

  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
  updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
  finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

  user: Mapped["User"] = relationship()
