from __future__ import annotations

import asyncio
import hmac
import os
import re
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from .intent_analyzer import build_analyzer
from .models import HealthResponse, IngestResponse, TranscriptEvent, TranscriptEventIn
from .sessions import SessionEnded, SessionLimit, SessionMissing, SessionStore
from .transcript import DashboardHub


DASHBOARD_DIR = Path(__file__).resolve().parents[2] / "dashboard"
SESSION_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


def create_app(*, session_store: SessionStore | None = None, intent_analyzer=None,
               access_token: str | None = None) -> FastAPI:
    store = session_store or SessionStore(idle_seconds=float(os.getenv("MEETING_OBSERVER_SESSION_IDLE_SECONDS", "300")))
    analyzer = intent_analyzer or build_analyzer()
    token = os.getenv("MEETING_OBSERVER_ACCESS_TOKEN", "") if access_token is None else access_token
    hub = DashboardHub()
    jobs: dict[str, asyncio.Task] = {}

    async def end_session(session_id: str) -> bool:
        snapshot = await store.end(session_id)
        task = jobs.pop(session_id, None)
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        if snapshot is not None:
            await hub.broadcast(session_id, snapshot)
        await hub.close_session(session_id)
        return snapshot is not None

    async def expire_sessions() -> None:
        while True:
            await asyncio.sleep(min(1, store.idle_seconds / 2))
            for session_id in await store.expired():
                await end_session(session_id)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        reaper = asyncio.create_task(expire_sessions())
        yield
        reaper.cancel()
        with suppress(asyncio.CancelledError):
            await reaper
        for session_id in list(store.sessions):
            await end_session(session_id)
        await store.clear()
        if hasattr(analyzer, "aclose"):
            await analyzer.aclose()

    app = FastAPI(title="Meeting Observer", version="0.2.0", lifespan=lifespan)
    app.state.store, app.state.analyzer, app.state.hub, app.state.analysis_jobs = store, analyzer, hub, jobs
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:8010", "http://127.0.0.1:8010"],
        allow_origin_regex=r"chrome-extension://[a-p]{32}",
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type", "Authorization", "X-Meeting-Observer-Token"],
    )

    @app.middleware("http")
    async def optional_token_auth(request: Request, call_next):
        if token and request.method != "OPTIONS" and request.url.path.startswith("/api/"):
            supplied = request.headers.get("x-meeting-observer-token", "")
            auth = request.headers.get("authorization", "")
            if auth.startswith("Bearer "):
                supplied = auth[7:]
            if not hmac.compare_digest(supplied, token):
                return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.exception_handler(SessionMissing)
    async def missing_handler(request, exc):
        return JSONResponse({"detail": "Session not found. Start a session first."}, status_code=404)

    @app.exception_handler(SessionEnded)
    async def ended_handler(request, exc):
        return JSONResponse({"detail": "Session ended. Start with a new session ID."}, status_code=410)

    @app.exception_handler(SessionLimit)
    async def limit_handler(request, exc):
        return JSONResponse({"detail": "Too many active sessions."}, status_code=429)

    def validate_id(session_id: str) -> None:
        if not SESSION_ID.fullmatch(session_id):
            raise HTTPException(422, "Session ID must contain 1-80 letters, digits, underscores or hyphens.")

    async def active(session_id: str):
        validate_id(session_id)
        session = await store.get(session_id)
        if store.clock() - session.last_activity >= store.idle_seconds:
            await end_session(session_id)
            raise SessionEnded(session_id)
        return session

    async def analyze_session(session_id: str) -> None:
        try:
            while True:
                revision, transcript, existing = await store.analysis_input(session_id)
                result = await analyzer.analyze(session_id, transcript, existing)
                session = await store.update_insights(
                    session_id, result.insights, revision=revision,
                    mode=result.mode, status=result.status, detail=result.detail)
                del transcript, existing, result
                if session is not None:
                    await hub.broadcast(session_id, session.snapshot())
                if (await store.get(session_id)).revision <= revision:
                    return
        except (SessionMissing, SessionEnded):
            return
        except asyncio.CancelledError:
            raise
        except Exception:
            # Avoid logging transcript-bearing exception messages from model clients.
            try:
                current = await store.get(session_id)
                current.analysis_status = "unavailable"
                current.analysis_detail = "Analysis failed. Waiting for the next caption."
                current.insights.clear()
                for participant in current.participants.values():
                    participant.current_intent = None
                await hub.broadcast(session_id, current.snapshot())
            except (SessionMissing, SessionEnded):
                pass
        finally:
            if jobs.get(session_id) is asyncio.current_task():
                jobs.pop(session_id, None)

    async def ingest(session_id: str, payload: TranscriptEventIn) -> IngestResponse:
        await active(session_id)
        speaker = " ".join(payload.speaker.split()) or "Unknown"
        text = " ".join(payload.text.split())
        if not text:
            raise HTTPException(422, "Caption text cannot be blank.")
        event = TranscriptEvent(**payload.model_dump(exclude={"speaker", "text"}), speaker=speaker, text=text)
        session, duplicate = await store.add_event(session_id, event)
        if duplicate:
            return IngestResponse(accepted=True, duplicate=True)
        await hub.broadcast(session_id, session.snapshot())
        if session_id not in jobs or jobs[session_id].done():
            jobs[session_id] = asyncio.create_task(analyze_session(session_id))
        return IngestResponse(accepted=True, event=event)

    app.mount("/static", StaticFiles(directory=DASHBOARD_DIR / "static"), name="static")

    @app.get("/")
    async def dashboard():
        return FileResponse(DASHBOARD_DIR / "index.html")

    @app.get("/health", response_model=HealthResponse)
    async def health():
        return HealthResponse(ok=True, model_mode="vllm" if analyzer.enabled else "rules")

    @app.post("/api/sessions/{session_id}")
    async def create_session(session_id: str):
        validate_id(session_id)
        if session_id in store.sessions:
            return (await active(session_id)).snapshot()
        return (await store.create(session_id, "vllm" if analyzer.enabled else "rules")).snapshot()

    @app.get("/api/sessions/{session_id}")
    async def get_session(session_id: str):
        return (await active(session_id)).snapshot()

    @app.delete("/api/sessions/{session_id}")
    async def delete_session(session_id: str):
        validate_id(session_id)
        return {"deleted": await end_session(session_id)}

    @app.post("/api/sessions/{session_id}/heartbeat")
    async def heartbeat(session_id: str):
        await active(session_id)
        await store.touch(session_id)
        return {"active": True}

    @app.post("/api/sessions/{session_id}/events", response_model=IngestResponse)
    async def ingest_event(session_id: str, payload: TranscriptEventIn):
        return await ingest(session_id, payload)

    async def socket_ready(websocket: WebSocket, session_id: str) -> bool:
        if token and not hmac.compare_digest(websocket.query_params.get("token", ""), token):
            await websocket.close(code=1008)
            return False
        try:
            await active(session_id)
        except SessionEnded:
            await websocket.close(code=4001)
            return False
        except (SessionMissing, HTTPException):
            await websocket.close(code=4004)
            return False
        return True

    @app.websocket("/ws/ingest/{session_id}")
    async def ingest_socket(session_id: str, websocket: WebSocket):
        if not await socket_ready(websocket, session_id):
            return
        await websocket.accept()
        try:
            while True:
                try:
                    payload = TranscriptEventIn.model_validate(await websocket.receive_json())
                    result = await ingest(session_id, payload)
                    await websocket.send_json(result.model_dump(mode="json"))
                except (ValidationError, ValueError, HTTPException):
                    await websocket.send_json({"accepted": False, "detail": "Invalid caption event."})
        except (SessionEnded, SessionMissing):
            await websocket.close(code=4001)
        except WebSocketDisconnect:
            pass

    @app.websocket("/ws/dashboard/{session_id}")
    async def dashboard_socket(session_id: str, websocket: WebSocket):
        if not await socket_ready(websocket, session_id):
            return
        await hub.connect(session_id, websocket)
        try:
            await websocket.send_json((await active(session_id)).snapshot().model_dump(mode="json"))
            while True:
                await websocket.receive_text()
        except (WebSocketDisconnect, SessionMissing, SessionEnded, RuntimeError):
            pass
        finally:
            hub.disconnect(session_id, websocket)

    return app


app = create_app()
