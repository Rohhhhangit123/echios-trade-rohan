from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..models import User, UserRole
from ..schemas import (
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from ..security import (
    authenticate_user,
    create_access_token,
    get_current_user,
    get_user_by_email,
    hash_password,
    require_roles,
)

router = APIRouter(prefix="/auth", tags=["auth"])


async def seed_default_admin_if_needed(session: AsyncSession) -> User | None:
    settings = get_settings()
    if not settings.default_admin_email:
        return None
    existing_count = (await session.execute(select(func.count(User.id)))).scalar_one()
    if existing_count > 0:
        return None
    admin = User(
        email=settings.default_admin_email.strip().lower(),
        full_name=settings.default_admin_name or "Platform Admin",
        hashed_password=hash_password(settings.default_admin_password),
        role=UserRole.ADMIN,
        is_active=True,
    )
    session.add(admin)
    await session.commit()
    await session.refresh(admin)
    return admin


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest,
    session: Annotated[AsyncSession, Depends(get_db)],
):
    user = await authenticate_user(session, payload.email, payload.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user.last_login_at = datetime.now(timezone.utc)
    session.add(user)
    await session.commit()
    await session.refresh(user)

    access_token, expires_in = create_access_token(
        user.id,
        extra_claims={
            "email": user.email,
            "role": user.role.value,
            "name": user.full_name,
        },
    )
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=expires_in,
        user=UserResponse.model_validate(user),
    )


@router.post("/register", response_model=TokenResponse)
async def register(
    payload: RegisterRequest,
    session: Annotated[AsyncSession, Depends(get_db)],
):
    settings = get_settings()
    existing = await get_user_by_email(session, payload.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )
    existing_count = (await session.execute(select(func.count(User.id)))).scalar_one()
    role = payload.role
    if existing_count == 0:
        role = UserRole.ADMIN
    else:
        if role == UserRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only an existing ADMIN can register additional ADMIN users",
            )
    user = User(
        email=payload.email.strip().lower(),
        full_name=payload.full_name.strip(),
        hashed_password=hash_password(payload.password),
        role=role,
        is_active=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    access_token, expires_in = create_access_token(
        user.id,
        extra_claims={
            "email": user.email,
            "role": user.role.value,
            "name": user.full_name,
        },
    )
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=expires_in,
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
async def me(current_user: Annotated[User, Depends(get_current_user)]):
    return UserResponse.model_validate(current_user)


@router.post("/ensure-default-admin", response_model=UserResponse, include_in_schema=False)
async def ensure_default_admin(
    session: Annotated[AsyncSession, Depends(get_db)],
):
    user = await seed_default_admin_if_needed(session)
    if user is None:
        settings = get_settings()
        existing = await get_user_by_email(session, settings.default_admin_email)
        if not existing:
            raise HTTPException(status_code=404, detail="No default admin and no users found")
        user = existing
    return UserResponse.model_validate(user)


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    current_user: Annotated[User, Depends(require_roles(UserRole.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db)],
):
    result = await session.execute(select(User).order_by(User.created_at.asc()))
    return [UserResponse.model_validate(u) for u in result.scalars().all()]
