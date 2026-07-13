from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import InvalidAccessTokenError, decode_access_token
from app.db.models import User
from app.db.session import get_db
from app.modules.auth.service import get_active_user

bearer = HTTPBearer(auto_error=False)


async def get_current_user(
  credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
  db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
  if credentials is None or credentials.scheme.lower() != "bearer":
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录状态已失效")

  try:
    claims = decode_access_token(credentials.credentials)
  except InvalidAccessTokenError as exc:
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录状态已失效") from exc

  user = await get_active_user(db, claims.user_id)
  if user is None:
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录状态已失效")
  return user
