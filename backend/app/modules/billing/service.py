"""额度计费服务：预扣、退款、余额查询，全部通过 CreditLedger 记录审计流水。

余额与流水单位均为整数（100 = 1.00 额度），避免浮点误差。
所有写操作用行级锁（SELECT ... FOR UPDATE）保证并发安全。
"""
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import CreditLedger, LedgerType, UserCredit


class InsufficientCreditsError(Exception):
  """余额不足以完成扣费。"""

  def __init__(self, balance: int, required: int) -> None:
    self.balance = balance
    self.required = required
    super().__init__(f"余额不足：当前 {balance}，需要 {required}")


async def _get_or_create_credit_locked(db: AsyncSession, user_id: UUID) -> UserCredit:
  """取用户余额行并加锁；不存在则创建。"""
  credit = await db.scalar(
    select(UserCredit).where(UserCredit.user_id == user_id).with_for_update()
  )
  if credit is None:
    credit = UserCredit(user_id=user_id, balance=0)
    db.add(credit)
    await db.flush()
    # 重新加锁读取，确保后续更新在锁内
    credit = await db.scalar(
      select(UserCredit).where(UserCredit.user_id == user_id).with_for_update()
    )
    assert credit is not None
  return credit


async def get_balance(db: AsyncSession, user_id: UUID) -> int:
  credit = await db.scalar(select(UserCredit).where(UserCredit.user_id == user_id))
  return credit.balance if credit is not None else 0


async def charge(
  db: AsyncSession,
  user_id: UUID,
  amount: int,
  generation_id: UUID | None = None,
  note: str | None = None,
) -> int:
  """扣费。amount 为正整数。余额不足抛 InsufficientCreditsError。返回扣费后余额。

  调用方负责提交事务。
  """
  if amount < 0:
    raise ValueError("扣费金额不能为负")
  credit = await _get_or_create_credit_locked(db, user_id)
  if credit.balance < amount:
    raise InsufficientCreditsError(credit.balance, amount)
  credit.balance -= amount
  db.add(
    CreditLedger(
      user_id=user_id,
      generation_id=generation_id,
      type=LedgerType.CHARGE,
      delta=-amount,
      balance_after=credit.balance,
      note=note,
    )
  )
  return credit.balance


async def refund(
  db: AsyncSession,
  user_id: UUID,
  amount: int,
  generation_id: UUID | None = None,
  note: str | None = None,
) -> int:
  """退款。amount 为正整数。返回退款后余额。调用方负责提交事务。"""
  if amount < 0:
    raise ValueError("退款金额不能为负")
  credit = await _get_or_create_credit_locked(db, user_id)
  credit.balance += amount
  db.add(
    CreditLedger(
      user_id=user_id,
      generation_id=generation_id,
      type=LedgerType.REFUND,
      delta=amount,
      balance_after=credit.balance,
      note=note,
    )
  )
  return credit.balance


async def topup(
  db: AsyncSession,
  user_id: UUID,
  amount: int,
  note: str | None = None,
) -> int:
  """充值。amount 为正整数。返回充值后余额。调用方负责提交事务。"""
  if amount < 0:
    raise ValueError("充值金额不能为负")
  credit = await _get_or_create_credit_locked(db, user_id)
  credit.balance += amount
  db.add(
    CreditLedger(
      user_id=user_id,
      type=LedgerType.TOPUP,
      delta=amount,
      balance_after=credit.balance,
      note=note,
    )
  )
  return credit.balance
