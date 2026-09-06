from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .intent_analyzer import build_analyzer
from .models import HealthResponse, IngestResponse, TranscriptEvent, TranscriptEventIn
from .sessions import SessionStore
from .transcript import DashboardHub


REPO_DIR = Path(__file__).resolve().parents[2]
DASHBOARD_DIR = REPO_DIR / "dashboard"

app = FastAPI(title="Meeting Observer", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = SessionStore(db_path=os.getenv("MEETING_OBSERVER_DB", "meeting_observer.sqlite"))
hub = DashboardHub()
analyzer = build_analyzer()

if (DASHBOARD_DIR / "static").exists():
    app.mount("/static", StaticFiles(directory=DASHBOARD_DIR / "static"), name="static")


@app.get("/")
async def dashboard() -> FileResponse:
    return FileResponse(DASHBOARD_DIR / "index.html")


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(ok=True, model_mode="llm" if analyzer.enabled else "rules")


@app.post("/api/sessions/{session_id}/events", response_model=IngestResponse)
async def ingest_event(session_id: str, payload: TranscriptEventIn) -> IngestResponse:
    event = TranscriptEvent(**payload.model_dump())
    session, duplicate = await store.add_event(session_id, event)
    if duplicate:
        return IngestResponse(accepted=True, duplicate=True)

    insights = await analyzer.analyze(session_id, session.transcript, session.insights)
    session = await store.update_insights(session_id, insights)
    await hub.broadcast(session_id, session.snapshot())
    return IngestResponse(accepted=True, duplicate=False, event=event, insights=insights)


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    session = await store.get(session_id)
    return session.snapshot()


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    existed = await store.delete(session_id)
    return {"deleted": existed}


@app.websocket("/ws/ingest/{session_id}")
async def ingest_socket(session_id: str, websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            payload = await websocket.receive_json()
            event_in = TranscriptEventIn(**payload)
            event = TranscriptEvent(**event_in.model_dump())
            session, duplicate = await store.add_event(session_id, event)
            if duplicate:
                await websocket.send_json({"accepted": True, "duplicate": True})
                continue

            insights = await analyzer.analyze(session_id, session.transcript, session.insights)
            session = await store.update_insights(session_id, insights)
            snapshot = session.snapshot()
            await websocket.send_json({"accepted": True, "duplicate": False, "event_id": event.id})
            await hub.broadcast(session_id, snapshot)
    except WebSocketDisconnect:
        return


@app.websocket("/ws/dashboard/{session_id}")
async def dashboard_socket(session_id: str, websocket: WebSocket) -> None:
    await hub.connect(session_id, websocket)
    session = await store.get(session_id)
    await websocket.send_json(session.snapshot().model_dump(mode="json"))
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(session_id, websocket)
