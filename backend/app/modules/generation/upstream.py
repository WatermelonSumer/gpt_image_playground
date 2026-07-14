"""上游图片生成适配器。

平台化后前端不再直连上游，由后端选择渠道、调用上游 OpenAI 兼容 images API、
并把结果规整为统一格式返回给 worker。

注意：本实现尚未接入真实上游调用测试（见 docs 决策）。单测使用 mock httpx。
"""
from dataclasses import dataclass, field
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Channel, PlatformModel


class NoChannelAvailableError(Exception):
  """该模型所属厂商没有可用渠道。"""


class UpstreamError(Exception):
  """上游调用失败，携带面向用户的错误码与消息。"""

  def __init__(self, code: str, message: str) -> None:
    self.code = code
    self.message = message
    super().__init__(f"{code}: {message}")


@dataclass
class GeneratedImage:
  b64_json: str
  revised_prompt: str | None = None
  width: int | None = None
  height: int | None = None


@dataclass
class GenerationResult:
  images: list[GeneratedImage] = field(default_factory=list)


async def select_channel(db: AsyncSession, model: PlatformModel) -> Channel:
  """按 priority 升序选择该模型所属厂商下已启用的渠道。"""
  channel = await db.scalar(
    select(Channel)
    .where(Channel.provider_id == model.provider_id, Channel.is_enabled.is_(True))
    .order_by(Channel.priority.asc(), Channel.weight.desc())
  )
  if channel is None:
    raise NoChannelAvailableError(f"模型 {model.platform_model_id} 无可用渠道")
  return channel


def _build_request_payload(
  model: PlatformModel,
  prompt: str,
  params: dict[str, Any],
) -> dict[str, Any]:
  """构造 OpenAI 兼容 images 请求体，转发上游模型 ID。"""
  payload: dict[str, Any] = {
    "model": model.upstream_model_id,
    "prompt": prompt,
    "n": params.get("n", 1),
  }
  size = params.get("size")
  if model.supports_size and size and size != "auto":
    payload["size"] = size
  quality = params.get("quality")
  if model.supports_quality and quality and quality != "auto":
    payload["quality"] = quality
  output_format = params.get("output_format")
  if output_format:
    payload["output_format"] = output_format
  return payload


def _parse_response(data: dict[str, Any]) -> GenerationResult:
  """解析 OpenAI 兼容 images 响应，只提取 b64 图片，丢弃上游原始结构。"""
  items = data.get("data")
  if not isinstance(items, list) or not items:
    raise UpstreamError("empty_response", "上游未返回图片")
  images: list[GeneratedImage] = []
  for item in items:
    if not isinstance(item, dict):
      continue
    b64 = item.get("b64_json")
    if not isinstance(b64, str) or not b64:
      continue
    images.append(
      GeneratedImage(
        b64_json=b64,
        revised_prompt=item.get("revised_prompt") if isinstance(item.get("revised_prompt"), str) else None,
      )
    )
  if not images:
    raise UpstreamError("no_image_data", "上游响应缺少图片数据")
  return GenerationResult(images=images)


async def call_upstream(
  channel: Channel,
  model: PlatformModel,
  prompt: str,
  params: dict[str, Any],
  *,
  client: httpx.AsyncClient | None = None,
  timeout: float = 120.0,
) -> GenerationResult:
  """调用上游 images 生成接口。可注入 httpx.AsyncClient（测试用 mock）。"""
  payload = _build_request_payload(model, prompt, params)
  url = channel.base_url.rstrip("/") + "/images/generations"
  headers = {
    "Authorization": f"Bearer {channel.api_key}",
    "Content-Type": "application/json",
  }

  owns_client = client is None
  if client is None:
    client = httpx.AsyncClient(timeout=timeout)
  try:
    response = await client.post(url, json=payload, headers=headers)
  except httpx.TimeoutException as exc:
    raise UpstreamError("upstream_timeout", "上游请求超时，请稍后重试") from exc
  except httpx.HTTPError as exc:
    raise UpstreamError("upstream_unreachable", "无法连接上游服务") from exc
  finally:
    if owns_client:
      await client.aclose()

  if response.status_code >= 400:
    raise UpstreamError("upstream_error", f"上游返回错误状态 {response.status_code}")

  try:
    data = response.json()
  except ValueError as exc:
    raise UpstreamError("invalid_response", "上游返回了无法解析的响应") from exc

  return _parse_response(data)
