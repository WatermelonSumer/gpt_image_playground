from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import PlatformModel, User
from app.db.session import get_db
from app.modules.auth.dependencies import get_current_user

router = APIRouter(prefix="/api/models", tags=["models"])


class ModelResponse(BaseModel):
  platform_model_id: str
  display_name: str
  provider_slug: str
  unit_price: int
  supports_edit: bool
  supports_size: bool
  supports_quality: bool
  supports_n: bool
  max_n: int

  model_config = {"from_attributes": True}


@router.get("", response_model=list[ModelResponse])
async def list_models(
  _current_user: Annotated[User, Depends(get_current_user)],
  db: Annotated[AsyncSession, Depends(get_db)],
) -> list[ModelResponse]:
  """已启用的平台模型列表。需要登录。"""
  result = await db.execute(
    select(PlatformModel)
    .options(selectinload(PlatformModel.provider))
    .where(PlatformModel.is_enabled.is_(True))
    .order_by(PlatformModel.display_name)
  )
  models = result.scalars().all()

  return [
    ModelResponse(
      platform_model_id=m.platform_model_id,
      display_name=m.display_name,
      provider_slug=m.provider.slug,
      unit_price=m.unit_price,
      supports_edit=m.supports_edit,
      supports_size=m.supports_size,
      supports_quality=m.supports_quality,
      supports_n=m.supports_n,
      max_n=m.max_n,
    )
    for m in models
  ]
