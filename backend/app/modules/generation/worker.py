"""Taskiq worker 任务：执行生成请求，写回结果或错误，失败自动退款。

在 worker 进程内运行，使用独立数据库会话（不复用 API 请求会话）。
"""
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select

from app.db.models import GenerationRequest, GenerationStatus, PlatformModel
from app.db.session import session_factory
from app.modules.billing import service as billing
from app.modules.generation.upstream import (
  NoChannelAvailableError,
  UpstreamError,
  call_upstream,
  select_channel,
)
from app.tasks.broker import broker


async def _mark_error_and_refund(gen_id: UUID, code: str, message: str) -> None:
  """把请求标记为失败并退款。使用独立事务。"""
  async with session_factory() as db:
    gen = await db.scalar(select(GenerationRequest).where(GenerationRequest.id == gen_id))
    if gen is None or gen.status in (GenerationStatus.DONE, GenerationStatus.ERROR):
      return
    gen.status = GenerationStatus.ERROR
    gen.error_code = code
    gen.error_message = message
    gen.finished_at = datetime.now(UTC)
    # 清空输入图片，避免长期占用存储
    gen.input_images = []
    gen.mask_image = None
    if gen.charged_credits > 0:
      await billing.refund(
        db,
        gen.user_id,
        gen.charged_credits,
        generation_id=gen.id,
        note=f"生成失败退款：{code}",
      )
    await db.commit()


@broker.task
async def run_generation(generation_id: str) -> None:
  gen_id = UUID(generation_id)

  # 1. 取请求并置为 running
  async with session_factory() as db:
    gen = await db.scalar(select(GenerationRequest).where(GenerationRequest.id == gen_id))
    if gen is None:
      return
    if gen.status != GenerationStatus.QUEUED:
      return  # 幂等：已处理过
    model = await db.scalar(
      select(PlatformModel).where(PlatformModel.platform_model_id == gen.platform_model_id)
    )
    gen.status = GenerationStatus.RUNNING
    await db.commit()
    # 快照请求数据供上游调用（脱离会话）
    prompt = gen.prompt
    params = dict(gen.params)
    user_id = gen.user_id

  if model is None:
    await _mark_error_and_refund(gen_id, "model_removed", "模型已下架")
    return

  # 2. 选渠道并调用上游
  try:
    async with session_factory() as db:
      channel = await select_channel(db, model)
    result = await call_upstream(channel, model, prompt, params)
  except NoChannelAvailableError:
    await _mark_error_and_refund(gen_id, "no_channel", "暂无可用渠道，请稍后重试")
    return
  except UpstreamError as exc:
    await _mark_error_and_refund(gen_id, exc.code, exc.message)
    return
  except Exception:  # noqa: BLE001 — 兜底，任何异常都退款并标错
    await _mark_error_and_refund(gen_id, "internal_error", "生成过程中发生内部错误")
    return

  # 3. 写回结果
  async with session_factory() as db:
    gen = await db.scalar(select(GenerationRequest).where(GenerationRequest.id == gen_id))
    if gen is None or gen.status != GenerationStatus.RUNNING:
      return
    gen.status = GenerationStatus.DONE
    gen.result_images = [
      {
        "b64_json": img.b64_json,
        "revised_prompt": img.revised_prompt,
        "width": img.width,
        "height": img.height,
      }
      for img in result.images
    ]
    gen.error_code = None
    gen.error_message = None
    gen.finished_at = datetime.now(UTC)
    # 清空输入图片
    gen.input_images = []
    gen.mask_image = None
    await db.commit()

  _ = user_id  # 保留以备后续通知/审计
