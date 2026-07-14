from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.security import create_access_token
from app.db.base import Base
from app.db.models import User, UserRole, UserStatus
from app.db.session import get_db
from app.main import app


@pytest_asyncio.fixture
async def admin_client(tmp_path) -> AsyncIterator[tuple[AsyncClient, async_sessionmaker[AsyncSession]]]:
  engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'admin.db'}")
  factory = async_sessionmaker(engine, expire_on_commit=False)
  async with engine.begin() as conn:
    await conn.run_sync(Base.metadata.create_all)

  async def override_get_db() -> AsyncIterator[AsyncSession]:
    async with factory() as db:
      yield db

  app.dependency_overrides[get_db] = override_get_db
  async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
    yield client, factory
  app.dependency_overrides.clear()
  await engine.dispose()


async def _token(factory, role: UserRole) -> str:
  async with factory() as db:
    user = User(
      email=f"{role}@example.com",
      password_hash="x",
      role=role,
      status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token, _ = create_access_token(user.id, user.role)
    return token


@pytest.mark.asyncio
async def test_normal_user_forbidden(admin_client) -> None:
  client, factory = admin_client
  token = await _token(factory, UserRole.USER)
  resp = await client.get("/api/admin/providers", headers={"Authorization": f"Bearer {token}"})
  assert resp.status_code == 403


@pytest.mark.asyncio
async def test_super_admin_full_crud_and_key_masking(admin_client) -> None:
  client, factory = admin_client
  token = await _token(factory, UserRole.SUPER_ADMIN)
  h = {"Authorization": f"Bearer {token}"}

  # 建厂商
  p = await client.post("/api/admin/providers", headers=h, json={"name": "OpenAI", "slug": "openai"})
  assert p.status_code == 201
  provider_id = p.json()["id"]

  # 建渠道 —— api_key 不回显明文
  c = await client.post("/api/admin/channels", headers=h, json={
    "provider_id": provider_id,
    "name": "ch1",
    "base_url": "https://api.openai.com/v1",
    "api_key": "sk-secret-1234567890",
    "priority": 1,
  })
  assert c.status_code == 201
  cbody = c.json()
  assert cbody["has_api_key"] is True
  assert "sk-secret-1234567890" not in str(cbody)
  assert cbody["api_key_preview"] == "sk-s…7890"
  channel_id = cbody["id"]

  # PATCH 渠道但不改 key（留空）
  patched = await client.patch(f"/api/admin/channels/{channel_id}", headers=h, json={"priority": 5})
  assert patched.status_code == 200
  assert patched.json()["priority"] == 5
  assert patched.json()["api_key_preview"] == "sk-s…7890"  # key 未变

  # 建模型
  m = await client.post("/api/admin/platform-models", headers=h, json={
    "provider_id": provider_id,
    "platform_model_id": "gpt-image-1",
    "display_name": "GPT Image",
    "upstream_model_id": "gpt-image-1",
    "unit_price": 100,
    "max_n": 4,
  })
  assert m.status_code == 201
  model_id = m.json()["id"]

  # 建好的模型出现在普通用户可见的 /api/models
  models = await client.get("/api/models", headers=h)
  assert models.status_code == 200
  assert any(x["platform_model_id"] == "gpt-image-1" for x in models.json())

  # 删除模型
  d = await client.delete(f"/api/admin/platform-models/{model_id}", headers=h)
  assert d.status_code == 204
  models2 = await client.get("/api/models", headers=h)
  assert not any(x["platform_model_id"] == "gpt-image-1" for x in models2.json())


@pytest.mark.asyncio
async def test_duplicate_slug_rejected(admin_client) -> None:
  client, factory = admin_client
  token = await _token(factory, UserRole.SUPER_ADMIN)
  h = {"Authorization": f"Bearer {token}"}
  await client.post("/api/admin/providers", headers=h, json={"name": "A", "slug": "dup"})
  again = await client.post("/api/admin/providers", headers=h, json={"name": "B", "slug": "dup"})
  assert again.status_code == 409
