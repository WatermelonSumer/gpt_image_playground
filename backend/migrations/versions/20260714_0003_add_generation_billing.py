"""add generation and billing tables

Revision ID: 20260714_0003
Revises: 20260713_0002
Create Date: 2026-07-14

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '20260714_0003'
down_revision = '20260713_0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
  # ── user_credits ─────────────────────────────────────────────────────────
  op.create_table(
    'user_credits',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('balance', sa.Integer(), nullable=False, server_default='0'),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', name='uq_user_credits_user_id'),
  )

  # ── generation_requests ──────────────────────────────────────────────────
  op.create_table(
    'generation_requests',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('prompt', sa.Text(), nullable=False),
    sa.Column('params', JSONB(), nullable=False),
    sa.Column('input_images', JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    sa.Column('mask_image', sa.Text(), nullable=True),
    sa.Column('platform_model_id', sa.String(100), nullable=False),
    sa.Column('display_name', sa.String(200), nullable=False),
    sa.Column('unit_price', sa.Integer(), nullable=False),
    sa.Column('requested_n', sa.Integer(), nullable=False),
    sa.Column('charged_credits', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(32), nullable=False, server_default='queued'),
    sa.Column('error_code', sa.String(64), nullable=True),
    sa.Column('error_message', sa.String(500), nullable=True),
    sa.Column('result_images', JSONB(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("status IN ('queued','running','done','error')", name='ck_gen_req_status'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
  )
  op.create_index('ix_gen_req_user_id', 'generation_requests', ['user_id'])
  op.create_index('ix_gen_req_status', 'generation_requests', ['status'])

  # ── credit_ledger ─────────────────────────────────────────────────────────
  op.create_table(
    'credit_ledger',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('generation_id', sa.Uuid(), nullable=True),
    sa.Column('type', sa.String(32), nullable=False),
    sa.Column('delta', sa.Integer(), nullable=False),
    sa.Column('balance_after', sa.Integer(), nullable=False),
    sa.Column('note', sa.String(500), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['generation_id'], ['generation_requests.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
  )
  op.create_index('ix_credit_ledger_user_id', 'credit_ledger', ['user_id'])
  op.create_index('ix_credit_ledger_generation_id', 'credit_ledger', ['generation_id'])


def downgrade() -> None:
  op.drop_index('ix_credit_ledger_generation_id', table_name='credit_ledger')
  op.drop_index('ix_credit_ledger_user_id', table_name='credit_ledger')
  op.drop_table('credit_ledger')
  op.drop_index('ix_gen_req_status', table_name='generation_requests')
  op.drop_index('ix_gen_req_user_id', table_name='generation_requests')
  op.drop_table('generation_requests')
  op.drop_table('user_credits')
