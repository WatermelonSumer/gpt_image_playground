import argparse
import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
from pydantic import EmailStr, TypeAdapter
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import User, UserRole, UserStatus
from app.db.session import engine, session_factory
from app.modules.auth.service import normalize_email

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def run_migrations() -> None:
  config = Config(str(BACKEND_ROOT / "alembic.ini"))
  config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
  command.upgrade(config, "head")


async def create_initial_super_admin() -> None:
  settings = get_settings()
  if settings.initial_super_admin_email is None or settings.initial_super_admin_password is None:
    raise RuntimeError("请在根目录 .env 中配置 INITIAL_SUPER_ADMIN_EMAIL 和 INITIAL_SUPER_ADMIN_PASSWORD")

  email = normalize_email(str(TypeAdapter(EmailStr).validate_python(settings.initial_super_admin_email)))
  async with session_factory() as db:
    user = await db.scalar(select(User).where(User.email == email))
    if user is not None:
      if user.role != UserRole.SUPER_ADMIN:
        raise RuntimeError(f"用户 {email} 已存在，但不是超级管理员")
      print(f"超级管理员已存在：{email}")
      return

    db.add(
      User(
        email=email,
        password_hash=hash_password(settings.initial_super_admin_password.get_secret_value()),
        role=UserRole.SUPER_ADMIN,
        status=UserStatus.ACTIVE,
      )
    )
    await db.commit()
    print(f"已创建超级管理员：{email}")


async def create_super_admin_and_close() -> None:
  try:
    await create_initial_super_admin()
  finally:
    await engine.dispose()


def main() -> None:
  parser = argparse.ArgumentParser(description="PixelEngine backend management")
  parser.add_subparsers(dest="command", required=True).add_parser("init", help="执行迁移并创建初始超级管理员")
  args = parser.parse_args()
  if args.command == "init":
    run_migrations()
    asyncio.run(create_super_admin_and_close())


if __name__ == "__main__":
  main()
