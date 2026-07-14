"""生成请求 API 的 Pydantic 契约。"""
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class GenerationParams(BaseModel):
  size: str = "auto"
  quality: str = "auto"
  output_format: str = "png"
  output_compression: int | None = None
  moderation: str = "auto"
  n: int = Field(default=1, ge=1, le=10)
  transparent_output: bool = False


class CreateGenerationRequest(BaseModel):
  platform_model_id: str
  prompt: str = Field(min_length=1)
  params: GenerationParams = Field(default_factory=GenerationParams)
  # 编辑模式的输入图片（data URL 去掉前缀后的 b64），可选
  input_images: list[str] = Field(default_factory=list)
  mask_image: str | None = None


class GeneratedImageResponse(BaseModel):
  b64_json: str
  revised_prompt: str | None = None
  width: int | None = None
  height: int | None = None


class GenerationResponse(BaseModel):
  id: UUID
  status: str
  platform_model_id: str
  display_name: str
  unit_price: int
  requested_n: int
  charged_credits: int
  error_code: str | None = None
  error_message: str | None = None
  # 仅 done 状态返回，客户端取走后服务端清空
  result_images: list[GeneratedImageResponse] | None = None
  balance: int | None = None

  model_config = {"from_attributes": True}


def to_response(row: Any, balance: int | None = None) -> GenerationResponse:
  images = None
  if row.result_images:
    images = [GeneratedImageResponse(**img) for img in row.result_images]
  return GenerationResponse(
    id=row.id,
    status=row.status,
    platform_model_id=row.platform_model_id,
    display_name=row.display_name,
    unit_price=row.unit_price,
    requested_n=row.requested_n,
    charged_credits=row.charged_credits,
    error_code=row.error_code,
    error_message=row.error_message,
    result_images=images,
    balance=balance,
  )
