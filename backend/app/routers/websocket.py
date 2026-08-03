from __future__ import annotations

import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.websocket_manager import ws_manager

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/trades")
async def ws_trades(websocket: WebSocket) -> None:
    client_id = uuid.uuid4().hex
    await ws_manager.connect(client_id, websocket)
    try:
        await ws_manager.broadcast({
            "type": "system",
            "message": f"client {client_id[:8]} connected",
            "connected_clients": len(ws_manager.active_connections),
        })
        while True:
            data = await websocket.receive_text()
            await ws_manager.broadcast({
                "type": "echo",
                "client_id": client_id[:8],
                "message": data,
            })
    except WebSocketDisconnect:
        await ws_manager.disconnect(client_id)
        await ws_manager.broadcast({
            "type": "system",
            "message": f"client {client_id[:8]} disconnected",
            "connected_clients": len(ws_manager.active_connections),
        })
        