"""超管管理 API：厂商、渠道、模型池的 CRUD。全部要求 super_admin 权限。"""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Channel, PlatformModel, Provider, User
from app.db.session import get_db
from app.modules.admin.schemas import (
  ChannelCreate,
  ChannelResponse,
  ChannelUpdate,
  PlatformModelCreate,
  PlatformModelResponse,
  PlatformModelUpdate,
  ProviderCreate,
  ProviderResponse,
  ProviderUpdate,
  mask_api_key,
)
from app.modules.auth.dependencies import require_super_admin

router = APIRouter(
  prefix="/api/admin",
  tags=["admin"],
  dependencies=[Depends(require_super_admin)],
)

DbDep = Annotated[AsyncSession, Depends(get_db)]
# 依赖已在 router 层强制，这里仅用于显式声明入参（避免未使用告警）
AdminDep = Annotated[User, Depends(require_super_admin)]


def _channel_response(channel: Channel) -> ChannelResponse:
  return ChannelResponse(
    id=channel.id,
    provider_id=channel.provider_id,
    name=channel.name,
    base_url=channel.base_url,
    has_api_key=bool(channel.api_key),
    api_key_preview=mask_api_key(channel.api_key),
    priority=channel.priority,
    weight=channel.weight,
    max_concurrent=channel.max_concurrent,
    is_enabled=channel.is_enabled,
  )


# ── Providers ────────────────────────────────────────────────────────────────

@router.get("/providers", response_model=list[ProviderResponse])
async def list_providers(db: DbDep) -> list[Provider]:
  result = await db.execute(select(Provider).order_by(Provider.name))
  return list(result.scalars().all())


@router.post("/providers", response_model=ProviderResponse, status_code=status.HTTP_201_CREATED)
async def create_provider(payload: ProviderCreate, db: DbDep) -> Provider:
  existing = await db.scalar(select(Provider).where(Provider.slug == payload.slug))
  if existing is not None:
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="厂商 slug 已存在")
  provider = Provider(name=payload.name, slug=payload.slug)
  db.add(provider)
  await db.commit()
  await db.refresh(provider)
  return provider


@router.patch("/providers/{provider_id}", response_model=ProviderResponse)
async def update_provider(provider_id: UUID, payload: ProviderUpdate, db: DbDep) -> Provider:
  provider = await db.get(Provider, provider_id)
  if provider is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="厂商不存在")
  data = payload.model_dump(exclude_unset=True)
  if "slug" in data:
    conflict = await db.scalar(
      select(Provider).where(Provider.slug == data["slug"], Provider.id != provider_id)
    )
    if conflict is not None:
      raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="厂商 slug 已存在")
  for key, value in data.items():
    setattr(provider, key, value)
  await db.commit()
  await db.refresh(provider)
  return provider


@router.delete("/providers/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(provider_id: UUID, db: DbDep) -> None:
  provider = await db.get(Provider, provider_id)
  if provider is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="厂商不存在")
  await db.delete(provider)
  await db.commit()


# ── Channels ─────────────────────────────────────────────────────────────────

@router.get("/channels", response_model=list[ChannelResponse])
async def list_channels(db: DbDep) -> list[ChannelResponse]:
  result = await db.execute(select(Channel).order_by(Channel.priority))
  return [_channel_response(c) for c in result.scalars().all()]


@router.post("/channels", response_model=ChannelResponse, status_code=status.HTTP_201_CREATED)
async def create_channel(payload: ChannelCreate, db: DbDep) -> ChannelResponse:
  provider = await db.get(Provider, payload.provider_id)
  if provider is None:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="所属厂商不存在")
  channel = Channel(
    provider_id=payload.provider_id,
    name=payload.name,
    base_url=payload.base_url,
    api_key=payload.api_key,
    priority=payload.priority,
    weight=payload.weight,
    max_concurrent=payload.max_concurrent,
    is_enabled=payload.is_enabled,
  )
  db.add(channel)
  await db.commit()
  await db.refresh(channel)
  return _channel_response(channel)


@router.patch("/channels/{channel_id}", response_model=ChannelResponse)
async def update_channel(channel_id: UUID, payload: ChannelUpdate, db: DbDep) -> ChannelResponse:
  channel = await db.get(Channel, channel_id)
  if channel is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="渠道不存在")
  data = payload.model_dump(exclude_unset=True)
  # api_key 留空/未传则不改
  if data.get("api_key") is None:
    data.pop("api_key", None)
  for key, value in data.items():
    setattr(channel, key, value)
  await db.commit()
  await db.refresh(channel)
  return _channel_response(channel)


@router.delete("/channels/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel(channel_id: UUID, db: DbDep) -> None:
  channel = await db.get(Channel, channel_id)
  if channel is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="渠道不存在")
  await db.delete(channel)
  await db.commit()


# ── Platform models ──────────────────────────────────────────────────────────

@router.get("/platform-models", response_model=list[PlatformModelResponse])
async def list_platform_models(db: DbDep) -> list[PlatformModel]:
  result = await db.execute(select(PlatformModel).order_by(PlatformModel.display_name))
  return list(result.scalars().all())


@router.post("/platform-models", response_model=PlatformModelResponse, status_code=status.HTTP_201_CREATED)
async def create_platform_model(payload: PlatformModelCreate, db: DbDep) -> PlatformModel:
  provider = await db.get(Provider, payload.provider_id)
  if provider is None:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="所属厂商不存在")
  existing = await db.scalar(
    select(PlatformModel).where(PlatformModel.platform_model_id == payload.platform_model_id)
  )
  if existing is not None:
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="平台模型 ID 已存在")
  model = PlatformModel(**payload.model_dump())
  db.add(model)
  await db.commit()
  await db.refresh(model)
  return model


@router.patch("/platform-models/{model_id}", response_model=PlatformModelResponse)
async def update_platform_model(model_id: UUID, payload: PlatformModelUpdate, db: DbDep) -> PlatformModel:
  model = await db.get(PlatformModel, model_id)
  if model is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="平台模型不存在")
  for key, value in payload.model_dump(exclude_unset=True).items():
    setattr(model, key, value)
  await db.commit()
  await db.refresh(model)
  return model


@router.delete("/platform-models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_platform_model(model_id: UUID, db: DbDep) -> None:
  model = await db.get(PlatformModel, model_id)
  if model is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="平台模型不存在")
  await db.delete(model)
  await db.commit()
