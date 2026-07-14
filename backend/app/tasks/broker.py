"""Taskiq broker：使用 Redis List 队列分发异步生成任务，结果写回 Redis。

Worker 通过 `uv run python -m app.cli worker` 启动（见 app/cli.py），
API 侧通过 `broker.kiq(...)` 派发任务。
"""
from taskiq_redis import ListQueueBroker, RedisAsyncResultBackend

from app.core.config import get_settings

_settings = get_settings()

result_backend: RedisAsyncResultBackend = RedisAsyncResultBackend(
  redis_url=_settings.redis_url,
)

broker = ListQueueBroker(
  url=_settings.redis_url,
).with_result_backend(result_backend)
