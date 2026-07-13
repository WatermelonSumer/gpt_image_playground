from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, alias_generators


class ApiSchema(BaseModel):
  model_config = ConfigDict(
    alias_generator=alias_generators.to_camel,
    populate_by_name=True,
    from_attributes=True,
  )


class LoginRequest(ApiSchema):
  email: EmailStr
  password: str = Field(min_length=1, max_length=128)


class UserResponse(ApiSchema):
  id: UUID
  email: EmailStr
  role: Literal["user", "super_admin"]
  status: Literal["active", "disabled"]
  force_password_change: bool


class AuthResponse(ApiSchema):
  access_token: str
  token_type: Literal["bearer"] = "bearer"
  expires_in: int
  user: UserResponse
