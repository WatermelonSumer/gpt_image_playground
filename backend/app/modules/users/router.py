from typing import Annotated

from fastapi import APIRouter, Depends, Response

from app.db.models import User
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import UserResponse

router = APIRouter(prefix="/api", tags=["users"])


@router.get("/me", response_model=UserResponse)
async def me(response: Response, user: Annotated[User, Depends(get_current_user)]) -> UserResponse:
  response.headers["Cache-Control"] = "no-store"
  return UserResponse.model_validate(user)
