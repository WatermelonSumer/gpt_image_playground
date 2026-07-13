"""create users and sessions

Revision ID: 20260713_0001
Revises:
Create Date: 2026-07-13
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260713_0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
  op.create_table(
    "users",
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.Column("email", sa.String(length=320), nullable=False),
    sa.Column("password_hash", sa.String(length=255), nullable=False),
    sa.Column("role", sa.String(length=32), nullable=False),
    sa.Column("status", sa.String(length=32), nullable=False),
    sa.Column("force_password_change", sa.Boolean(), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("role IN ('user', 'super_admin')", name="ck_users_role"),
    sa.CheckConstraint("status IN ('active', 'disabled')", name="ck_users_status"),
    sa.PrimaryKeyConstraint("id"),
    sa.UniqueConstraint("email", name="uq_users_email"),
  )
  op.create_table(
    "user_sessions",
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.Column("user_id", sa.Uuid(), nullable=False),
    sa.Column("token_hash", sa.String(length=64), nullable=False),
    sa.Column("user_agent", sa.String(length=512), nullable=True),
    sa.Column("ip_address", sa.String(length=64), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("id"),
  )
  op.create_index("ix_user_sessions_token_hash", "user_sessions", ["token_hash"], unique=True)
  op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"], unique=False)


def downgrade() -> None:
  op.drop_index("ix_user_sessions_user_id", table_name="user_sessions")
  op.drop_index("ix_user_sessions_token_hash", table_name="user_sessions")
  op.drop_table("user_sessions")
  op.drop_table("users")
