"""超管管理接口的 Pydantic 契约。api_key 全程脱敏，不回显明文。"""
from uuid import UUID

from pydantic import BaseModel, Field


# ── Provider ─────────────────────────────────────────────────────────────────

class ProviderCreate(BaseModel):
  name: str = Field(min_length=1, max_length=100)
  slug: str = Field(min_length=1, max_length=50)


class ProviderUpdate(BaseModel):
  name: str | None = Field(default=None, min_length=1, max_length=100)
  slug: str | None = Field(default=None, min_length=1, max_length=50)


class ProviderResponse(BaseModel):
  id: UUID
  name: str
  slug: str

  model_config = {"from_attributes": True}


# ── Channel ──────────────────────────────────────────────────────────────────

class ChannelCreate(BaseModel):
  provider_id: UUID
  name: str = Field(min_length=1, max_length=100)
  base_url: str = Field(min_length=1, max_length=500)
  api_key: str = Field(min_length=1, max_length=500)
  priority: int = 100
  weight: int = 100
  max_concurrent: int = Field(default=10, ge=1)
  is_enabled: bool = True


class ChannelUpdate(BaseModel):
  name: str | None = Field(default=None, min_length=1, max_length=100)
  base_url: str | None = Field(default=None, min_length=1, max_length=500)
  # 留空/不传 = 不修改；填写 = 替换
  api_key: str | None = Field(default=None, min_length=1, max_length=500)
  priority: int | None = None
  weight: int | None = None
  max_concurrent: int | None = Field(default=None, ge=1)
  is_enabled: bool | None = None


class ChannelResponse(BaseModel):
  id: UUID
  provider_id: UUID
  name: str
  base_url: str
  # 脱敏：只暴露是否已配置和末尾预览，不返明文
  has_api_key: bool
  api_key_preview: str
  priority: int
  weight: int
  max_concurrent: int
  is_enabled: bool


# ── PlatformModel ────────────────────────────────────────────────────────────

class PlatformModelCreate(BaseModel):
  provider_id: UUID
  platform_model_id: str = Field(min_length=1, max_length=100)
  display_name: str = Field(min_length=1, max_length=200)
  upstream_model_id: str = Field(min_length=1, max_length=200)
  unit_price: int = Field(default=0, ge=0)
  supports_edit: bool = False
  supports_size: bool = True
  supports_quality: bool = True
  supports_n: bool = True
  max_n: int = Field(default=4, ge=1)
  is_enabled: bool = True


class PlatformModelUpdate(BaseModel):
  display_name: str | None = Field(default=None, min_length=1, max_length=200)
  upstream_model_id: str | None = Field(default=None, min_length=1, max_length=200)
  unit_price: int | None = Field(default=None, ge=0)
  supports_edit: bool | None = None
  supports_size: bool | None = None
  supports_quality: bool | None = None
  supports_n: bool | None = None
  max_n: int | None = Field(default=None, ge=1)
  is_enabled: bool | None = None


class PlatformModelResponse(BaseModel):
  id: UUID
  provider_id: UUID
  platform_model_id: str
  display_name: str
  upstream_model_id: str
  unit_price: int
  supports_edit: bool
  supports_size: bool
  supports_quality: bool
  supports_n: bool
  max_n: int
  is_enabled: bool

  model_config = {"from_attributes": True}


def mask_api_key(api_key: str) -> str:
  """返回脱敏预览，如 'sk-12...cdef'；过短则整体用 * 遮盖。"""
  if not api_key:
    return ""
  if len(api_key) <= 8:
    return "•" * len(api_key)
  return f"{api_key[:4]}…{api_key[-4:]}"
