import argparse
import asyncio
import sys
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

# Windows 默认的 ProactorEventLoop 无法运行 psycopg 异步模式，需切换到 SelectorEventLoop。
LOOP_FACTORY = asyncio.SelectorEventLoop if sys.platform == "win32" else None


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


def run_server(reload: bool) -> None:
  import uvicorn

  settings = get_settings()
  config = uvicorn.Config(
    "app.main:app",
    host=settings.backend_host,
    port=settings.backend_port,
    reload=reload,
  )
  # reload 模式下 uvicorn 走子进程，会自动使用 SelectorEventLoop；
  # 单进程模式下 uvicorn 在 Windows 硬编码 ProactorEventLoop（psycopg 不支持），
  # 因此这里自建 SelectorEventLoop 运行，绕过它的循环工厂。
  if reload:
    uvicorn.Server(config).run()
  else:
    asyncio.run(uvicorn.Server(config).serve(), loop_factory=LOOP_FACTORY)


def run_worker() -> None:
  from taskiq.cli.worker.args import WorkerArgs
  from taskiq.cli.worker.run import run_worker as taskiq_run_worker

  # Windows：taskiq 通过 asyncio.run 启动事件循环（不传 loop_factory），
  # 因此在这里设定 SelectorEventLoop 策略即可让 psycopg 异步在 worker 中工作。
  if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

  args = WorkerArgs(
    broker="app.tasks.broker:broker",
    modules=["app.modules.generation.worker"],
    workers=1,
    # Windows 上不使用多进程池，直接在当前进程运行接收器
    max_async_tasks=10,
  )
  taskiq_run_worker(args)


def main() -> None:
  parser = argparse.ArgumentParser(description="PixelEngine backend management")
  subparsers = parser.add_subparsers(dest="command", required=True)
  subparsers.add_parser("init", help="执行迁移并创建初始超级管理员")
  serve_parser = subparsers.add_parser("serve", help="启动 API 服务")
  serve_parser.add_argument("--reload", action="store_true", help="开发模式热重载")
  subparsers.add_parser("worker", help="启动 Taskiq 异步任务 worker")
  args = parser.parse_args()
  if args.command == "init":
    run_migrations()
    asyncio.run(create_super_admin_and_close(), loop_factory=LOOP_FACTORY)
  elif args.command == "serve":
    run_server(reload=args.reload)
  elif args.command == "worker":
    run_worker()


if __name__ == "__main__":
  main()
