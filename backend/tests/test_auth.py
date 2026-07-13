from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.base import Base
from app.db.models import User, UserRole, UserStatus
from app.db.session import get_db
from app.main import app


@pytest_asyncio.fixture
async def auth_client(tmp_path) -> AsyncIterator[tuple[AsyncClient, async_sessionmaker[AsyncSession]]]:
  engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
  factory = async_sessionmaker(engine, expire_on_commit=False)
  async with engine.begin() as connection:
    await connection.run_sync(Base.metadata.create_all)

  async def override_get_db() -> AsyncIterator[AsyncSession]:
    async with factory() as db:
      yield db

  app.dependency_overrides[get_db] = override_get_db
  async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
    yield client, factory

  app.dependency_overrides.clear()
  await engine.dispose()


async def create_user(
  factory: async_sessionmaker[AsyncSession],
  *,
  email: str = "user@example.com",
  password: str = "correct-password",
  status: UserStatus = UserStatus.ACTIVE,
) -> User:
  async with factory() as db:
    user = User(
      email=email,
      password_hash=hash_password(password),
      role=UserRole.USER,
      status=status,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.mark.asyncio
async def test_login_refresh_me_and_logout(auth_client) -> None:
  client, factory = auth_client
  user = await create_user(factory)

  invalid = await client.post("/api/auth/login", json={"email": user.email, "password": "wrong-password"})
  assert invalid.status_code == 401

  login = await client.post("/api/auth/login", json={"email": user.email, "password": "correct-password"})
  assert login.status_code == 200
  login_payload = login.json()
  assert login_payload["user"]["email"] == user.email
  assert login_payload["tokenType"] == "bearer"
  assert login_payload["expiresIn"] == get_settings().access_token_minutes * 60
  assert get_settings().refresh_cookie_name in client.cookies

  me = await client.get(
    "/api/me",
    headers={"Authorization": f"Bearer {login_payload['accessToken']}"},
  )
  assert me.status_code == 200
  assert me.json()["id"] == str(user.id)

  refresh = await client.post("/api/auth/refresh")
  assert refresh.status_code == 200
  assert refresh.json()["accessToken"] != login_payload["accessToken"]

  logout = await client.post("/api/auth/logout")
  assert logout.status_code == 204
  assert (await client.post("/api/auth/refresh")).status_code == 401


@pytest.mark.asyncio
async def test_disabled_user_cannot_login(auth_client) -> None:
  client, factory = auth_client
  user = await create_user(factory, status=UserStatus.DISABLED)

  response = await client.post(
    "/api/auth/login",
    json={"email": user.email, "password": "correct-password"},
  )

  assert response.status_code == 403
  assert response.json()["detail"] == "账户已停用"
