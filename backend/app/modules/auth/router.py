from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.models import User
from app.db.session import get_db
from app.modules.auth.schemas import AuthResponse, LoginRequest, UserResponse
from app.modules.auth.service import (
  InactiveUserError,
  authenticate_user,
  create_user_session,
  revoke_user_session,
  rotate_user_session,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def set_refresh_cookie(response: Response, token: str) -> None:
  settings = get_settings()
  response.headers["Cache-Control"] = "no-store"
  response.set_cookie(
    key=settings.refresh_cookie_name,
    value=token,
    max_age=settings.refresh_session_days * 24 * 60 * 60,
    httponly=True,
    secure=settings.cookie_secure,
    samesite="lax",
    path="/api/auth",
  )


def clear_refresh_cookie(response: Response) -> None:
  settings = get_settings()
  response.headers["Cache-Control"] = "no-store"
  response.delete_cookie(
    key=settings.refresh_cookie_name,
    httponly=True,
    secure=settings.cookie_secure,
    samesite="lax",
    path="/api/auth",
  )


def build_auth_response(user: User) -> AuthResponse:
  access_token, expires_in = create_access_token(user.id, user.role)
  return AuthResponse(
    access_token=access_token,
    expires_in=expires_in,
    user=UserResponse.model_validate(user),
  )


@router.post("/login", response_model=AuthResponse)
async def login(
  payload: LoginRequest,
  request: Request,
  response: Response,
  db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthResponse:
  try:
    user = await authenticate_user(db, str(payload.email), payload.password)
  except InactiveUserError as exc:
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账户已停用") from exc
  if user is None:
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="邮箱或密码错误")

  refresh_token = await create_user_session(
    db,
    user,
    request.headers.get("user-agent"),
    request.client.host if request.client else None,
  )
  set_refresh_cookie(response, refresh_token)
  return build_auth_response(user)


@router.post("/refresh", response_model=AuthResponse)
async def refresh(
  request: Request,
  response: Response,
  db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthResponse:
  settings = get_settings()
  refresh_token = request.cookies.get(settings.refresh_cookie_name)
  if not refresh_token:
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录状态已失效")

  result = await rotate_user_session(db, refresh_token)
  if result is None:
    clear_refresh_cookie(response)
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录状态已失效")

  user, next_token = result
  set_refresh_cookie(response, next_token)
  return build_auth_response(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
  request: Request,
  response: Response,
  db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
  settings = get_settings()
  refresh_token = request.cookies.get(settings.refresh_cookie_name)
  if refresh_token:
    await revoke_user_session(db, refresh_token)
  clear_refresh_cookie(response)
