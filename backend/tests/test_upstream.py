import httpx
import pytest

from app.db.models import Channel, PlatformModel
from app.modules.generation.upstream import (
  UpstreamError,
  call_upstream,
)


def make_model() -> PlatformModel:
  return PlatformModel(
    provider_id=None,
    platform_model_id="gpt-image-1",
    display_name="GPT Image",
    upstream_model_id="gpt-image-1",
    unit_price=100,
    supports_edit=True,
    supports_size=True,
    supports_quality=True,
    supports_n=True,
    max_n=4,
    is_enabled=True,
  )


def make_channel() -> Channel:
  return Channel(
    provider_id=None,
    name="ch1",
    base_url="https://upstream.example/v1",
    api_key="sk-test",
    priority=1,
    weight=100,
    max_concurrent=10,
    is_enabled=True,
  )


@pytest.mark.asyncio
async def test_call_upstream_success() -> None:
  captured = {}

  def handler(request: httpx.Request) -> httpx.Response:
    captured["url"] = str(request.url)
    captured["auth"] = request.headers.get("Authorization")
    return httpx.Response(200, json={"data": [{"b64_json": "AAAA", "revised_prompt": "cat"}]})

  transport = httpx.MockTransport(handler)
  async with httpx.AsyncClient(transport=transport) as client:
    result = await call_upstream(
      make_channel(), make_model(), "a cat", {"n": 1, "size": "1024x1024"}, client=client
    )

  assert captured["url"] == "https://upstream.example/v1/images/generations"
  assert captured["auth"] == "Bearer sk-test"
  assert len(result.images) == 1
  assert result.images[0].b64_json == "AAAA"
  assert result.images[0].revised_prompt == "cat"


@pytest.mark.asyncio
async def test_call_upstream_error_status() -> None:
  transport = httpx.MockTransport(lambda req: httpx.Response(500, json={"error": "boom"}))
  async with httpx.AsyncClient(transport=transport) as client:
    with pytest.raises(UpstreamError) as exc:
      await call_upstream(make_channel(), make_model(), "x", {"n": 1}, client=client)
    assert exc.value.code == "upstream_error"


@pytest.mark.asyncio
async def test_call_upstream_empty_data() -> None:
  transport = httpx.MockTransport(lambda req: httpx.Response(200, json={"data": []}))
  async with httpx.AsyncClient(transport=transport) as client:
    with pytest.raises(UpstreamError) as exc:
      await call_upstream(make_channel(), make_model(), "x", {"n": 1}, client=client)
    assert exc.value.code == "empty_response"
