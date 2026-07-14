from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.models import CreditLedger, LedgerType, User, UserRole, UserStatus
from app.modules.billing import service as billing


@pytest_asyncio.fixture
async def db_factory(tmp_path) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
  engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'billing.db'}")
  factory = async_sessionmaker(engine, expire_on_commit=False)
  async with engine.begin() as conn:
    await conn.run_sync(Base.metadata.create_all)
  yield factory
  await engine.dispose()


async def make_user(factory: async_sessionmaker[AsyncSession]) -> User:
  async with factory() as db:
    user = User(email="c@example.com", password_hash="x", role=UserRole.USER, status=UserStatus.ACTIVE)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.mark.asyncio
async def test_topup_charge_refund_flow(db_factory) -> None:
  user = await make_user(db_factory)

  async with db_factory() as db:
    assert await billing.get_balance(db, user.id) == 0

  # 充值 1000
  async with db_factory() as db:
    bal = await billing.topup(db, user.id, 1000, note="test topup")
    await db.commit()
    assert bal == 1000

  # 扣费 300
  async with db_factory() as db:
    bal = await billing.charge(db, user.id, 300, note="gen")
    await db.commit()
    assert bal == 700

  # 退款 300
  async with db_factory() as db:
    bal = await billing.refund(db, user.id, 300, note="refund")
    await db.commit()
    assert bal == 1000

  # 流水应有 3 条
  async with db_factory() as db:
    from sqlalchemy import select
    rows = (await db.execute(select(CreditLedger).order_by(CreditLedger.created_at))).scalars().all()
    assert [r.type for r in rows] == [LedgerType.TOPUP, LedgerType.CHARGE, LedgerType.REFUND]
    assert [r.balance_after for r in rows] == [1000, 700, 1000]


@pytest.mark.asyncio
async def test_charge_insufficient_raises(db_factory) -> None:
  user = await make_user(db_factory)
  async with db_factory() as db:
    await billing.topup(db, user.id, 100)
    await db.commit()

  async with db_factory() as db:
    with pytest.raises(billing.InsufficientCreditsError) as exc:
      await billing.charge(db, user.id, 500)
    assert exc.value.balance == 100
    assert exc.value.required == 500
