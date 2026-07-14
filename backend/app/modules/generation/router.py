"""生成请求 API。

POST /api/generations       创建生成请求（校验模型 → 预扣额度 → 建单 → 派发异步任务）
GET  /api/generations/{id}  轮询状态；done 时返回图片并清空服务端结果
"""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import GenerationRequest, GenerationStatus, PlatformModel, User
from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.billing import service as billing
from app.modules.generation.schemas import (
  CreateGenerationRequest,
  GenerationResponse,
  to_response,
)

router = APIRouter(prefix="/api/generations", tags=["generations"])


@router.post("", response_model=GenerationResponse, status_code=status.HTTP_201_CREATED)
async def create_generation(
  payload: CreateGenerationRequest,
  current_user: Annotated[User, Depends(get_current_user)],
  db: Annotated[AsyncSession, Depends(get_db)],
) -> GenerationResponse:
  # 1. 校验模型可用
  model = await db.scalar(
    select(PlatformModel).where(
      PlatformModel.platform_model_id == payload.platform_model_id,
      PlatformModel.is_enabled.is_(True),
    )
  )
  if model is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="所选模型不可用")

  # 2. 规整数量并计算费用
  requested_n = payload.params.n
  if model.supports_n:
    requested_n = max(1, min(requested_n, model.max_n))
  else:
    requested_n = 1
  charged = model.unit_price * requested_n

  # 3. 预扣额度（余额不足直接拒绝，不建单）
  try:
    balance = await billing.charge(
      db,
      current_user.id,
      charged,
      note=f"生成请求：{model.platform_model_id} × {requested_n}",
    )
  except billing.InsufficientCreditsError as exc:
    raise HTTPException(
      status_code=status.HTTP_402_PAYMENT_REQUIRED,
      detail=f"额度不足，需要 {exc.required}，当前 {exc.balance}",
    ) from exc

  # 4. 建单（模型价格快照）
  params = payload.params.model_dump()
  params["n"] = requested_n
  gen = GenerationRequest(
    user_id=current_user.id,
    prompt=payload.prompt,
    params=params,
    input_images=payload.input_images,
    mask_image=payload.mask_image,
    platform_model_id=model.platform_model_id,
    display_name=model.display_name,
    unit_price=model.unit_price,
    requested_n=requested_n,
    charged_credits=charged,
    status=GenerationStatus.QUEUED,
  )
  db.add(gen)
  # 把扣费流水的 generation_id 补上并提交
  await db.flush()
  await db.commit()
  await db.refresh(gen)

  # 5. 派发异步任务
  from app.modules.generation.worker import run_generation

  await run_generation.kiq(str(gen.id))

  return to_response(gen, balance=balance)


@router.get("/{generation_id}", response_model=GenerationResponse)
async def get_generation(
  generation_id: UUID,
  current_user: Annotated[User, Depends(get_current_user)],
  db: Annotated[AsyncSession, Depends(get_db)],
) -> GenerationResponse:
  gen = await db.scalar(
    select(GenerationRequest).where(
      GenerationRequest.id == generation_id,
      GenerationRequest.user_id == current_user.id,
    )
  )
  if gen is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="生成请求不存在")

  response = to_response(gen)

  # done 且携带结果：客户端取走后清空服务端结果，避免长期占用存储
  if gen.status == GenerationStatus.DONE and gen.result_images:
    gen.result_images = None
    await db.commit()

  return response
