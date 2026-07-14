from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.security import create_access_token
from app.db.base import Base
from app.db.models import (
  Channel,
  GenerationRequest,
  GenerationStatus,
  PlatformModel,
  Provider,
  User,
  UserRole,
  UserStatus,
)
from app.db.session import get_db
from app.main import app
from app.modules.billing import service as billing
from app.modules.generation import worker as worker_module
from app.modules.generation.upstream import GeneratedImage, GenerationResult


@pytest_asyncio.fixture
async def gen_env(tmp_path, monkeypatch) -> AsyncIterator[dict]:
  engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'gen.db'}")
  factory = async_sessionmaker(engine, expire_on_commit=False)
  async with engine.begin() as conn:
    await conn.run_sync(Base.metadata.create_all)

  async def override_get_db() -> AsyncIterator[AsyncSession]:
    async with factory() as db:
      yield db

  app.dependency_overrides[get_db] = override_get_db
  # worker 使用模块级 session_factory，指向测试库
  monkeypatch.setattr(worker_module, "session_factory", factory)

  # 派发任务不连 Redis：kiq 变 no-op
  async def fake_kiq(_arg: str) -> None:
    return None

  monkeypatch.setattr(worker_module.run_generation, "kiq", fake_kiq)

  async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
    yield {"client": client, "factory": factory}

  app.dependency_overrides.clear()
  await engine.dispose()


async def _seed(factory: async_sessionmaker[AsyncSession], *, balance: int) -> dict:
  async with factory() as db:
    user = User(email="gen@example.com", password_hash="x", role=UserRole.USER, status=UserStatus.ACTIVE)
    db.add(user)
    await db.flush()
    provider = Provider(name="OpenAI", slug="openai")
    db.add(provider)
    await db.flush()
    channel = Channel(
      provider_id=provider.id,
      name="ch1",
      base_url="https://upstream.example/v1",
      api_key="sk-test",
      priority=1,
      weight=100,
      max_concurrent=10,
      is_enabled=True,
    )
    model = PlatformModel(
      provider_id=provider.id,
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
    db.add_all([channel, model])
    if balance:
      await billing.topup(db, user.id, balance)
    await db.commit()
    await db.refresh(user)
    token, _ = create_access_token(user.id, user.role)
    return {"user_id": user.id, "token": token}


@pytest.mark.asyncio
async def test_full_generation_flow(gen_env, monkeypatch) -> None:
  client, factory = gen_env["client"], gen_env["factory"]
  seed = await _seed(factory, balance=1000)
  headers = {"Authorization": f"Bearer {seed['token']}"}

  # mock 上游调用，返回 2 张图
  async def fake_call_upstream(channel, model, prompt, params, **kwargs):
    return GenerationResult(images=[
      GeneratedImage(b64_json="AAAA", revised_prompt="a cat"),
      GeneratedImage(b64_json="BBBB"),
    ])

  monkeypatch.setattr(worker_module, "call_upstream", fake_call_upstream)

  # 1. 创建生成请求
  resp = await client.post(
    "/api/generations",
    headers=headers,
    json={"platform_model_id": "gpt-image-1", "prompt": "a cat", "params": {"n": 2}},
  )
  assert resp.status_code == 201, resp.text
  body = resp.json()
  assert body["status"] == "queued"
  assert body["requested_n"] == 2
  assert body["charged_credits"] == 200  # 100 × 2
  assert body["balance"] == 800  # 1000 - 200
  gen_id = body["id"]

  # 2. 手动执行 worker 任务
  await worker_module.run_generation(gen_id)

  # 3. 轮询状态：done + 2 张图片
  poll = await client.get(f"/api/generations/{gen_id}", headers=headers)
  assert poll.status_code == 200
  done = poll.json()
  assert done["status"] == "done"
  assert done["result_images"] is not None
  assert len(done["result_images"]) == 2
  assert done["result_images"][0]["b64_json"] == "AAAA"
  assert done["result_images"][0]["revised_prompt"] == "a cat"

  # 4. 再次 GET：结果已被清空（取走后不再暂存）
  poll2 = await client.get(f"/api/generations/{gen_id}", headers=headers)
  assert poll2.json()["result_images"] is None

  # 余额仍为 800（成功不退款）
  async with factory() as db:
    assert await billing.get_balance(db, seed["user_id"]) == 800


@pytest.mark.asyncio
async def test_insufficient_credits_rejected(gen_env) -> None:
  client, factory = gen_env["client"], gen_env["factory"]
  seed = await _seed(factory, balance=50)  # 不足 100
  headers = {"Authorization": f"Bearer {seed['token']}"}

  resp = await client.post(
    "/api/generations",
    headers=headers,
    json={"platform_model_id": "gpt-image-1", "prompt": "a cat", "params": {"n": 1}},
  )
  assert resp.status_code == 402
  # 未建单
  async with factory() as db:
    from sqlalchemy import func, select
    count = await db.scalar(select(func.count()).select_from(GenerationRequest))
    assert count == 0


@pytest.mark.asyncio
async def test_upstream_failure_refunds(gen_env, monkeypatch) -> None:
  client, factory = gen_env["client"], gen_env["factory"]
  seed = await _seed(factory, balance=500)
  headers = {"Authorization": f"Bearer {seed['token']}"}

  from app.modules.generation.upstream import UpstreamError

  async def failing_upstream(channel, model, prompt, params, **kwargs):
    raise UpstreamError("upstream_error", "上游炸了")

  monkeypatch.setattr(worker_module, "call_upstream", failing_upstream)

  resp = await client.post(
    "/api/generations",
    headers=headers,
    json={"platform_model_id": "gpt-image-1", "prompt": "x", "params": {"n": 3}},
  )
  assert resp.status_code == 201
  gen_id = resp.json()["id"]
  assert resp.json()["charged_credits"] == 300

  await worker_module.run_generation(gen_id)

  poll = await client.get(f"/api/generations/{gen_id}", headers=headers)
  err = poll.json()
  assert err["status"] == "error"
  assert err["error_code"] == "upstream_error"

  # 失败已退款：余额恢复到 500
  async with factory() as db:
    assert await billing.get_balance(db, seed["user_id"]) == 500
