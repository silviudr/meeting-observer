from __future__ import annotations

from collections import defaultdict

from fastapi import WebSocket

from .models import SessionSnapshot


class DashboardHub:
    def __init__(self) -> None:
        self.connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections[session_id].add(websocket)

    def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        self.connections[session_id].discard(websocket)

    async def broadcast(self, session_id: str, snapshot: SessionSnapshot) -> None:
        dead: list[WebSocket] = []
        for websocket in self.connections.get(session_id, set()):
            try:
                await websocket.send_json(snapshot.model_dump(mode="json"))
            except RuntimeError:
                dead.append(websocket)
        for websocket in dead:
            self.disconnect(session_id, websocket)
