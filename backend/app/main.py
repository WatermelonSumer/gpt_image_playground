from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.modules.admin.router import router as admin_router
from app.modules.auth.router import router as auth_router
from app.modules.generation.router import router as generation_router
from app.modules.models.router import router as models_router
from app.modules.users.router import router as users_router


def create_app() -> FastAPI:
  settings = get_settings()
  app = FastAPI(title="PixelEngine API", version="0.1.0")
  app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url.rstrip("/")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
  )
  app.include_router(auth_router)
  app.include_router(users_router)
  app.include_router(models_router)
  app.include_router(generation_router)
  app.include_router(admin_router)

  @app.get("/api/health", tags=["system"])
  async def health() -> dict[str, str]:
    return {"status": "ok"}

  return app


app = create_app()
