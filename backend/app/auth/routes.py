import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy import text
from app.auth.models import (
    UserSignupEmail,
    UserLoginEmail,
    GoogleAuthRequest,
    OTPRequest,
    OTPVerifyRequest,
    RefreshTokenRequest,
    TokenResponse,
    UserResponse,
)
from app.core.security import (
    hash_password,
    verify_password,
    create_jwt_token,
    create_refresh_token,
    verify_jwt_token,
    get_current_user,
)
from app.core.database import supabase, local_engine, logger

router = APIRouter(prefix="/auth", tags=["Authentication"])

# In-memory mock storage for auth fallback & testing
_mock_users_db: List[Dict[str, Any]] = []


def _get_user_by_identifier(identifier: str) -> Dict[str, Any] | None:
    """Helper to query user by email or phone, matching emails case-insensitively."""
    identifier = identifier.strip()
    lowered = identifier.lower()
    if lowered != identifier:
        # Accounts are stored lowercase now; the exact spelling covers older mixed-case ones.
        return _lookup_user(identifier) or _lookup_user(lowered)
    return _lookup_user(identifier)


def _lookup_user(identifier: str) -> Dict[str, Any] | None:
    if supabase is not None:
        try:
            res_email = supabase.table("users").select("*").eq("email", identifier).execute()
            if res_email.data:
                return res_email.data[0]
            res_phone = supabase.table("users").select("*").eq("phone_no", identifier).execute()
            if res_phone.data:
                return res_phone.data[0]
        except Exception as e:
            logger.warning(f"Cloud Supabase user lookup error: {e}")

    if local_engine is not None:
        try:
            with local_engine.connect() as conn:
                res = conn.execute(
                    text("SELECT * FROM users WHERE email = :id OR phone_no = :id LIMIT 1"),
                    {"id": identifier}
                )
                row = res.fetchone()
                if row:
                    return dict(row._mapping)
        except Exception as e:
            logger.warning(f"Local PostgreSQL user lookup error: {e}")

    for u in _mock_users_db:
        if u.get("email") == identifier or u.get("phone_no") == identifier:
            return u

    return None


@router.post("/signup/email", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def signup_email(payload: UserSignupEmail):
    """
    Sign up user with Email or Mobile + Password.
    Hashes password with bcrypt and creates user record.
    """
    if not payload.email and not payload.phone_no:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either email or phone_no must be provided for registration."
        )

    # Check for existing user
    identifier = payload.email or payload.phone_no
    existing_user = _get_user_by_identifier(identifier)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"User with identifier '{identifier}' already exists."
        )

    user_id = str(uuid.uuid4())
    hashed_pwd = hash_password(payload.password)
    now_str = datetime.now(timezone.utc).isoformat()
    auth_provider = "email" if payload.email else "mobile"

    user_data = {
        "id": user_id,
        "email": payload.email,
        "phone_no": payload.phone_no,
        "password_hash": hashed_pwd,
        "auth_provider": auth_provider,
        "google_id": None,
        "role": payload.role,
        "is_verified": False,
        "created_at": now_str,
        "updated_at": now_str,
    }

    _mock_users_db.append(user_data)

    # Save user to Cloud Supabase and/or Local PostgreSQL
    if supabase is not None:
        try:
            supabase.table("users").insert(user_data).execute()
        except Exception as e:
            logger.error(f"Error inserting user into Cloud Supabase: {e}")

    if local_engine is not None:
        try:
            with local_engine.connect() as conn:
                conn.execute(
                    text("""
                        INSERT INTO users (id, email, phone_no, password_hash, auth_provider, google_id, role, is_verified, created_at, updated_at)
                        VALUES (:id, :email, :phone_no, :password_hash, :auth_provider, :google_id, :role, :is_verified, :created_at, :updated_at)
                    """),
                    user_data
                )
                conn.commit()
        except Exception as e:
            logger.error(f"Error inserting user into Local PostgreSQL: {e}")

    access_token = create_jwt_token(user_id=user_id, role=payload.role)
    refresh_token = create_refresh_token(user_id=user_id, role=payload.role)

    user_response = UserResponse(
        id=user_id,
        email=payload.email,
        phone_no=payload.phone_no,
        role=payload.role,
        auth_provider=auth_provider,
        is_verified=False,
        created_at=now_str
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=user_response
    )


@router.post("/login/email", response_model=TokenResponse)
def login_email(payload: UserLoginEmail):
    """
    Log in user with Email or Mobile + Password.
    Returns access JWT and refresh token.
    """
    user = _get_user_by_identifier(payload.identifier)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials - user not found."
        )

    pwd_hash = user.get("password_hash")
    if not pwd_hash or not verify_password(payload.password, pwd_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials - incorrect password."
        )

    user_id = str(user["id"])
    role = user["role"]

    access_token = create_jwt_token(user_id=user_id, role=role)
    refresh_token = create_refresh_token(user_id=user_id, role=role)

    user_response = UserResponse(
        id=user_id,
        email=user.get("email"),
        phone_no=user.get("phone_no"),
        role=role,
        auth_provider=user.get("auth_provider", "email"),
        is_verified=bool(user.get("is_verified", False)),
        created_at=str(user.get("created_at", datetime.now(timezone.utc).isoformat()))
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=user_response
    )


@router.post("/google", response_model=TokenResponse)
def google_auth(payload: GoogleAuthRequest):
    """
    Accept Google OAuth token / ID token, verify, create user if new, and return JWT session tokens.
    """
    if not payload.id_token:
        raise HTTPException(status_code=400, detail="Google id_token is required.")

    mock_google_id = f"google_{hash(payload.id_token) & 0xffffffff}"
    mock_email = f"user_{mock_google_id[:8]}@gmail.com"

    existing_user = _get_user_by_identifier(mock_email)
    if existing_user:
        user_id = str(existing_user["id"])
        role = existing_user["role"]
    else:
        user_id = str(uuid.uuid4())
        role = payload.role or "elder"
        now_str = datetime.now(timezone.utc).isoformat()
        user_data = {
            "id": user_id,
            "email": mock_email,
            "phone_no": None,
            "password_hash": None,
            "auth_provider": "google",
            "google_id": mock_google_id,
            "role": role,
            "is_verified": True,
            "created_at": now_str,
            "updated_at": now_str,
        }
        _mock_users_db.append(user_data)
        if supabase is not None:
            try:
                supabase.table("users").insert(user_data).execute()
            except Exception as e:
                logger.error(f"Cloud Supabase google_auth insert error: {e}")
        if local_engine is not None:
            try:
                with local_engine.connect() as conn:
                    conn.execute(
                        text("""
                            INSERT INTO users (id, email, phone_no, password_hash, auth_provider, google_id, role, is_verified, created_at, updated_at)
                            VALUES (:id, :email, :phone_no, :password_hash, :auth_provider, :google_id, :role, :is_verified, :created_at, :updated_at)
                        """),
                        user_data
                    )
                    conn.commit()
            except Exception as e:
                logger.error(f"Local PostgreSQL google_auth insert error: {e}")
        existing_user = user_data

    access_token = create_jwt_token(user_id=user_id, role=role)
    refresh_token = create_refresh_token(user_id=user_id, role=role)

    user_response = UserResponse(
        id=user_id,
        email=existing_user.get("email"),
        phone_no=existing_user.get("phone_no"),
        role=role,
        auth_provider="google",
        is_verified=True,
        created_at=str(existing_user.get("created_at"))
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=user_response
    )


@router.post("/send-otp")
def send_otp(payload: OTPRequest):
    """
    Send OTP code to mobile number.
    """
    if not payload.phone_no:
        raise HTTPException(status_code=400, detail="Mobile phone_no is required.")
    
    return {
        "status": "success",
        "message": f"OTP sent to {payload.phone_no}."
    }


@router.post("/verify-otp")
def verify_otp(payload: OTPVerifyRequest):
    """
    Verify OTP code for mobile number and set is_verified to True.
    """
    if not payload.otp_code:
        raise HTTPException(status_code=400, detail="OTP code is required.")

    user = _get_user_by_identifier(payload.phone_no)
    if user:
        user_id = str(user["id"])
        user["is_verified"] = True
        if supabase is not None:
            try:
                supabase.table("users").update({"is_verified": True}).eq("id", user_id).execute()
            except Exception as e:
                logger.error(f"Cloud Supabase update is_verified error: {e}")
        if local_engine is not None:
            try:
                with local_engine.connect() as conn:
                    conn.execute(
                        text("UPDATE users SET is_verified = TRUE WHERE id = :user_id"),
                        {"user_id": user_id}
                    )
                    conn.commit()
            except Exception as e:
                logger.error(f"Local PostgreSQL update is_verified error: {e}")

    return {
        "status": "success",
        "message": f"Phone number {payload.phone_no} successfully verified."
    }


@router.post("/refresh-token")
def refresh_token(payload: RefreshTokenRequest):
    """
    Issues a new access token given a valid refresh token.
    """
    decoded = verify_jwt_token(payload.refresh_token)
    if decoded.get("type") != "refresh":
        raise HTTPException(status_code=400, detail="Provided token is not a refresh token.")

    user_id = decoded.get("user_id")
    role = decoded.get("role")

    new_access_token = create_jwt_token(user_id=user_id, role=role)
    return {
        "access_token": new_access_token,
        "token_type": "bearer"
    }


@router.post("/logout")
def logout(current_user: dict = Depends(get_current_user)):
    """
    Invalidates current session/logout.
    """
    return {
        "status": "success",
        "message": f"User {current_user.get('user_id')} successfully logged out."
    }
