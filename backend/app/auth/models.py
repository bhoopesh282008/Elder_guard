from typing import Optional, Literal
from pydantic import BaseModel, EmailStr, Field, field_validator

UserRole = Literal['elder', 'caregiver', 'doctor', 'hospital', 'pharmacy']
AuthProvider = Literal['email', 'mobile', 'google']


class UserSignupEmail(BaseModel):
    email: Optional[EmailStr] = None
    phone_no: Optional[str] = None
    password: str = Field(..., min_length=6)
    role: UserRole

    @field_validator("email")
    @classmethod
    def _lowercase_email(cls, value):
        return value.lower() if value else value


class UserLoginEmail(BaseModel):
    identifier: str = Field(..., description="Email or phone number")
    password: str


class GoogleAuthRequest(BaseModel):
    id_token: str
    role: Optional[UserRole] = 'elder'


class OTPRequest(BaseModel):
    phone_no: str


class OTPVerifyRequest(BaseModel):
    phone_no: str
    otp_code: str


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    id: str
    email: Optional[str] = None
    phone_no: Optional[str] = None
    role: str
    auth_provider: str
    is_verified: bool
    created_at: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserResponse
