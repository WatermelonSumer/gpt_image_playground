"""add model pool: providers, channels, platform_models

Revision ID: 20260713_0002
Revises: 20260713_0001
Create Date: 2026-07-13
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260713_0002"
down_revision: str | Sequence[str] | None = "20260713_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
  op.create_table(
    "providers",
    sa.Column("id", sa.Uuid(), primary_key=True),
    sa.Column("name", sa.String(100), nullable=False),
    sa.Column("slug", sa.String(50), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
  )
  op.create_index("ix_providers_slug", "providers", ["slug"], unique=True)

  op.create_table(
    "channels",
    sa.Column("id", sa.Uuid(), primary_key=True),
    sa.Column("provider_id", sa.Uuid(), sa.ForeignKey("providers.id", ondelete="CASCADE"), nullable=False),
    sa.Column("name", sa.String(100), nullable=False),
    sa.Column("base_url", sa.String(500), nullable=False),
    sa.Column("api_key", sa.String(500), nullable=False),
    sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
    sa.Column("weight", sa.Integer(), nullable=False, server_default="100"),
    sa.Column("max_concurrent", sa.Integer(), nullable=False, server_default="10"),
    sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="true"),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
  )
  op.create_index("ix_channels_provider_id", "channels", ["provider_id"])

  op.create_table(
    "platform_models",
    sa.Column("id", sa.Uuid(), primary_key=True),
    sa.Column("provider_id", sa.Uuid(), sa.ForeignKey("providers.id", ondelete="CASCADE"), nullable=False),
    sa.Column("platform_model_id", sa.String(100), nullable=False),
    sa.Column("display_name", sa.String(200), nullable=False),
    sa.Column("upstream_model_id", sa.String(200), nullable=False),
    sa.Column("unit_price", sa.Integer(), nullable=False, server_default="0"),
    sa.Column("supports_edit", sa.Boolean(), nullable=False, server_default="false"),
    sa.Column("supports_size", sa.Boolean(), nullable=False, server_default="true"),
    sa.Column("supports_quality", sa.Boolean(), nullable=False, server_default="true"),
    sa.Column("supports_n", sa.Boolean(), nullable=False, server_default="true"),
    sa.Column("max_n", sa.Integer(), nullable=False, server_default="4"),
    sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="true"),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
  )
  op.create_index("ix_platform_models_platform_model_id", "platform_models", ["platform_model_id"], unique=True)
  op.create_index("ix_platform_models_provider_id", "platform_models", ["provider_id"])


def downgrade() -> None:
  op.drop_table("platform_models")
  op.drop_table("channels")
  op.drop_table("providers")
