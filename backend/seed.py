from __future__ import annotations

import asyncio
from datetime import date, timedelta
from decimal import Decimal

import app.db as db_module
from app.config import get_settings
from app.db import Base, init_db
from app.models import (
    ClientAccount,
    KycStatus,
    Position,
    ReferenceDatum,
    User,
    UserRole,
)
from app.security import hash_password
from app.routers.auth import seed_default_admin_if_needed
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


REFERENCE_SEED: list[ReferenceDatum] = [
    ReferenceDatum(instrument="AAPL", isin="US0378331005", currency="USD", entity="Apple Inc.", tax_rate=Decimal("0.0000"), lot_size=1, tick_size=Decimal("0.01"), settlement_cycle_days=2),
    ReferenceDatum(instrument="MSFT", isin="US5949181045", currency="USD", entity="Microsoft Corp.", tax_rate=Decimal("0.0000"), lot_size=1, tick_size=Decimal("0.01"), settlement_cycle_days=2),
    ReferenceDatum(instrument="NVDA", isin="US67066G1040", currency="USD", entity="NVIDIA Corp.", tax_rate=Decimal("0.0000"), lot_size=1, tick_size=Decimal("0.01"), settlement_cycle_days=2),
    ReferenceDatum(instrument="GOOGL", isin="US02079K3059", currency="USD", entity="Alphabet Inc.", tax_rate=Decimal("0.0000"), lot_size=1, tick_size=Decimal("0.01"), settlement_cycle_days=2),
    ReferenceDatum(instrument="AMZN", isin="US0231351067", currency="USD", entity="Amazon.com Inc.", tax_rate=Decimal("0.0000"), lot_size=1, tick_size=Decimal("0.01"), settlement_cycle_days=2),
    ReferenceDatum(instrument="TSLA", isin="US88160R1014", currency="USD", entity="Tesla Inc.", tax_rate=Decimal("0.0000"), lot_size=1, tick_size=Decimal("0.01"), settlement_cycle_days=2),
    ReferenceDatum(instrument="META", isin="US30303M1027", currency="USD", entity="Meta Platforms Inc.", tax_rate=Decimal("0.0000"), lot_size=1, tick_size=Decimal("0.01"), settlement_cycle_days=2),
    ReferenceDatum(instrument="TCS", isin="INE467B01029", currency="INR", entity="Tata Consultancy Services", tax_rate=Decimal("0.0010"), lot_size=1, tick_size=Decimal("0.05"), settlement_cycle_days=2),
    ReferenceDatum(instrument="RELIANCE", isin="INE002A01018", currency="INR", entity="Reliance Industries", tax_rate=Decimal("0.0010"), lot_size=1, tick_size=Decimal("0.05"), settlement_cycle_days=2),
    ReferenceDatum(instrument="VOD", isin="GB00BH4HKS39", currency="GBP", entity="Vodafone Group", tax_rate=Decimal("0.0050"), lot_size=1, tick_size=Decimal("0.001"), settlement_cycle_days=2),
    ReferenceDatum(instrument="BP", isin="GB0007980591", currency="GBP", entity="BP plc", tax_rate=Decimal("0.0050"), lot_size=1, tick_size=Decimal("0.001"), settlement_cycle_days=2),
]


CLIENT_SEED: list[ClientAccount] = [
    ClientAccount(
        name="Acme Capital Partners",
        kyc_status=KycStatus.VERIFIED,
        kyc_expiry=date.today() + timedelta(days=365),
        nostro_balance=Decimal("50000000.0000"),
    ),
    ClientAccount(
        name="Globex Asset Management",
        kyc_status=KycStatus.VERIFIED,
        kyc_expiry=date.today() + timedelta(days=180),
        nostro_balance=Decimal("25000000.0000"),
    ),
    ClientAccount(
        name="Initech Hedge Fund",
        kyc_status=KycStatus.EXPIRED,
        kyc_expiry=date.today() - timedelta(days=10),
        nostro_balance=Decimal("10000000.0000"),
    ),
    ClientAccount(
        name="Umbrella Corp Pension",
        kyc_status=KycStatus.VERIFIED,
        kyc_expiry=date.today() + timedelta(days=720),
        nostro_balance=Decimal("100000000.0000"),
    ),
    ClientAccount(
        name="Stark Industries Treasury",
        kyc_status=KycStatus.PENDING,
        kyc_expiry=None,
        nostro_balance=Decimal("5000000.0000"),
    ),
]


POSITION_SEED: list[Position] = []


async def create_all_tables() -> None:
    if db_module.engine is None:
        raise RuntimeError("Database engine not initialized. Call init_db() first.")
    async with db_module.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("OK: tables created")


async def seed_all() -> None:
    if db_module.AsyncSessionLocal is None:
        raise RuntimeError("Database session not initialized. Call init_db() first.")
    async with db_module.AsyncSessionLocal() as session:
        from sqlalchemy import select

        existing = await session.execute(select(ReferenceDatum))
        if not existing.scalars().first():
            session.add_all(REFERENCE_SEED)
            print(f"OK: seeded {len(REFERENCE_SEED)} reference_data rows")

        existing_clients = await session.execute(select(ClientAccount))
        if not existing_clients.scalars().first():
            session.add_all(CLIENT_SEED)
            print(f"OK: seeded {len(CLIENT_SEED)} client_accounts rows")
            await session.flush()

            clients = (await session.execute(select(ClientAccount).order_by(ClientAccount.id))).scalars().all()
            acme = next(c for c in clients if c.name == "Acme Capital Partners")
            globex = next(c for c in clients if c.name == "Globex Asset Management")
            positions = [
                Position(client_id=acme.id, instrument="AAPL", quantity=Decimal("10000"), avg_price=Decimal("185.00")),
                Position(client_id=acme.id, instrument="MSFT", quantity=Decimal("5000"), avg_price=Decimal("410.00")),
                Position(client_id=acme.id, instrument="NVDA", quantity=Decimal("2000"), avg_price=Decimal("120.00")),
                Position(client_id=globex.id, instrument="GOOGL", quantity=Decimal("3000"), avg_price=Decimal("160.00")),
                Position(client_id=globex.id, instrument="TSLA", quantity=Decimal("1500"), avg_price=Decimal("240.00")),
            ]
            session.add_all(positions)
            print(f"OK: seeded {len(positions)} positions rows")

        await session.commit()


async def seed_default_users() -> None:
    if db_module.AsyncSessionLocal is None:
        raise RuntimeError("Database session not initialized. Call init_db() first.")
    async with db_module.AsyncSessionLocal() as session:
        admin = await seed_default_admin_if_needed(session)
        if admin:
            print(f"OK: seeded default admin user: {admin.email}")
        else:
            settings = get_settings()
            print(f"OK: users table already has entries; default admin ({settings.default_admin_email}) skipped")

        existing_count = (await session.execute(select(func.count(User.id)))).scalar_one()
        if existing_count <= 1:
            demo_users = [
                User(
                    email="trader@echios.local",
                    full_name="Sarah Trader",
                    hashed_password=hash_password("trader123"),
                    role=UserRole.TRADER,
                    is_active=True,
                ),
                User(
                    email="risk@echios.local",
                    full_name="Mike Risk Management",
                    hashed_password=hash_password("compliance123"),
                    role=UserRole.RISK,
                    is_active=True,
                ),
                User(
                    email="asset@echios.local",
                    full_name="Olivia Asset Manager",
                    hashed_password=hash_password("viewer123"),
                    role=UserRole.ASSET,
                    is_active=True,
                ),
            ]
            for u in demo_users:
                found = await session.execute(select(User).where(User.email == u.email))
                if not found.scalars().first():
                    session.add(u)
                    print(f"OK: seeded demo user: {u.email} / role={u.role.value}")
            await session.commit()


async def main() -> None:
    await init_db()
    print(f"Active backend: {db_module.active_backend}")
    await create_all_tables()
    await seed_all()
    await seed_default_users()


if __name__ == "__main__":
    asyncio.run(main())
