from __future__ import annotations

import asyncio
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect


class WebSocketManager:
    def __init__(self) -> None:
        self.active_connections: dict[str, WebSocket] = {}
        self._lock = asyncio.Lock()

    async def connect(self, client_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self.active_connections[client_id] = websocket

    async def disconnect(self, client_id: str) -> None:
        async with self._lock:
            self.active_connections.pop(client_id, None)

    async def broadcast(self, message: dict[str, Any]) -> None:
        if not self.active_connections:
            return
        dead: list[str] = []
        async with self._lock:
            targets = list(self.active_connections.items())
        for cid, ws in targets:
            try:
                await ws.send_json(message)
            except (WebSocketDisconnect, RuntimeError):
                dead.append(cid)
        if dead:
            async with self._lock:
                for cid in dead:
                    self.active_connections.pop(cid, None)

    def sync_broadcast(self, message: dict[str, Any]) -> None:
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(self.broadcast(message))
            else:
                loop.run_until_complete(self.broadcast(message))
        except Exception:
            pass


ws_manager = WebSocketManager()
