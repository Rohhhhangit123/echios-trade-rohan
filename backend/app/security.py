from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import get_db
from .models import User, UserRole

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

ALGORITHMS_FALLBACK = ["HS256"]


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False


def create_access_token(
    subject: str | int,
    *,
    extra_claims: dict | None = None,
    expires_delta: timedelta | None = None,
) -> tuple[str, int]:
    settings = get_settings()
    expire_minutes = expires_delta.total_seconds() // 60 if expires_delta else settings.jwt_access_token_expire_minutes
    expire = datetime.now(timezone.utc) + timedelta(minutes=expire_minutes)
    to_encode: dict = {
        "sub": str(subject),
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    if extra_claims:
        to_encode.update(extra_claims)
    encoded = jwt.encode(
        to_encode,
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm or "HS256",
    )
    return encoded, int(expire_minutes * 60)


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    stmt = select(User).where(User.email == email.strip().lower())
    result = await session.execute(stmt)
    return result.scalars().first()


async def get_user_by_id(session: AsyncSession, user_id: int) -> User | None:
    stmt = select(User).where(User.id == user_id)
    result = await session.execute(stmt)
    return result.scalars().first()


async def authenticate_user(session: AsyncSession, email: str, password: str) -> User | None:
    user = await get_user_by_email(session, email)
    if not user:
        return None
    if not user.is_active:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


def _credentials_exception(detail: str = "Could not validate credentials") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_db),
) -> User:
    if not token:
        raise _credentials_exception("Not authenticated")
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm] + ALGORITHMS_FALLBACK,
        )
        sub = payload.get("sub")
        if sub is None:
            raise _credentials_exception()
        try:
            user_id = int(sub)
        except (TypeError, ValueError):
            raise _credentials_exception() from None
    except JWTError:
        raise _credentials_exception("Invalid or expired token") from None
    user = await get_user_by_id(session, user_id)
    if user is None or not user.is_active:
        raise _credentials_exception("User not found or disabled")
    return user


def require_roles(*allowed_roles: UserRole):
    allowed: set[UserRole] = set(allowed_roles)

    async def _check(user: User = Depends(get_current_user)) -> User:
        if UserRole.ADMIN in allowed or user.role == UserRole.ADMIN:
            if user.role == UserRole.ADMIN or user.role in allowed:
                return user
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient role: required one of {[r.value for r in allowed]}, got {user.role.value}",
            )
        return user

    return _check
