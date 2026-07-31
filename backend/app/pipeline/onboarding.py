from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ClientAccount, KycStatus, Trade, TradeStatus
from ._common import raise_exception


async def run_stage(trade: Trade, session: AsyncSession, simulated: bool = False) -> tuple[bool, str | None]:
    client: ClientAccount | None = await session.get(ClientAccount, trade.client_id)
    if client is None:
        await raise_exception(
            session, trade, TradeStatus.ONBOARDED,
            reason=f"Client id={trade.client_id} does not exist",
            breaking_field="client_id",
        )
        return False, None

    if client.kyc_status != KycStatus.VERIFIED:
        await raise_exception(
            session, trade, TradeStatus.ONBOARDED,
            reason=f"Client KYC is not VERIFIED (current: {client.kyc_status.value})",
            breaking_field="kyc_status",
        )
        return False, None

    if client.kyc_expiry is None or client.kyc_expiry < date.today():
        await raise_exception(
            session, trade, TradeStatus.ONBOARDED,
            reason=f"Client KYC has expired (expiry={client.kyc_expiry})",
            breaking_field="kyc_expiry",
        )
        return False, None

    trade.status = TradeStatus.ONBOARDED
    return True, "KYC valid"
