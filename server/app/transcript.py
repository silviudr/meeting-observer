from __future__ import annotations

import asyncio
from collections import defaultdict

from fastapi import WebSocket

from .models import SessionSnapshot


class DashboardHub:
    def __init__(self) -> None:
        self.connections: dict[str, set[WebSocket]] = defaultdict(set)
        self.locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections[session_id].add(websocket)

    def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        connections = self.connections.get(session_id)
        if connections is not None:
            connections.discard(websocket)
            if not connections:
                self.connections.pop(session_id, None)

    async def broadcast(self, session_id: str, snapshot: SessionSnapshot) -> None:
        async with self.locks[session_id]:
            payload = snapshot.model_dump(mode="json")

            async def send(websocket: WebSocket) -> None:
                try:
                    await asyncio.wait_for(websocket.send_json(payload), timeout=1)
                except (OSError, RuntimeError, asyncio.TimeoutError):
                    self.disconnect(session_id, websocket)

            await asyncio.gather(*(send(ws) for ws in tuple(self.connections.get(session_id, ()))))

    async def close_session(self, session_id: str) -> None:
        for websocket in tuple(self.connections.pop(session_id, ())):
            try:
                await asyncio.wait_for(websocket.close(code=4001), timeout=1)
            except (OSError, RuntimeError, asyncio.TimeoutError):
                pass
        self.locks.pop(session_id, None)
