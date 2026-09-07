from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable

from .models import IntentHypothesis, ParticipantState, SessionSnapshot, TranscriptEvent


def _now() -> datetime:
    return datetime.now(timezone.utc)


class SessionMissing(Exception):
    pass


class SessionEnded(Exception):
    pass


class SessionLimit(Exception):
    pass


@dataclass
class MeetingSession:
    session_id: str
    started_at: datetime = field(default_factory=_now)
    updated_at: datetime = field(default_factory=_now)
    transcript: list[TranscriptEvent] = field(default_factory=list)
    participants: dict[str, ParticipantState] = field(default_factory=dict)
    insights: dict[str, IntentHypothesis] = field(default_factory=dict)
    event_ids: set[str] = field(default_factory=set)
    last_activity: float = 0
    revision: int = 0
    analyzed_revision: int = 0
    analysis_mode: str = "rules"
    analysis_status: str = "idle"
    analysis_detail: str | None = None

    def snapshot(self, *, ended: bool = False) -> SessionSnapshot:
        return SessionSnapshot(
            session_id=self.session_id, started_at=self.started_at, updated_at=self.updated_at,
            transcript=[] if ended else self.transcript[-250:],
            participants=[] if ended else sorted(self.participants.values(), key=lambda item: item.speaker.lower()),
            insights=[] if ended else list(self.insights.values()),
            status="ended" if ended else "active", revision=self.revision,
            analysis_mode=self.analysis_mode,
            analysis_status="idle" if ended else self.analysis_status,
            analysis_detail=None if ended else self.analysis_detail,
        ).model_copy(deep=True)


class SessionStore:
    """Meeting content is memory-only; ended IDs retain no meeting content."""

    def __init__(self, *, idle_seconds: float = 300, clock: Callable[[], float] = time.monotonic,
                 max_events: int = 2000, max_sessions: int = 8) -> None:
        if idle_seconds <= 0 or max_events < 1 or max_sessions < 1:
            raise ValueError("Session limits must be positive")
        self.sessions: dict[str, MeetingSession] = {}
        self.ended_ids: set[str] = set()
        self.lock = asyncio.Lock()
        self.idle_seconds, self.clock = idle_seconds, clock
        self.max_events, self.max_sessions = max_events, max_sessions

    def _get(self, session_id: str) -> MeetingSession:
        if session_id in self.ended_ids:
            raise SessionEnded(session_id)
        if session_id not in self.sessions:
            raise SessionMissing(session_id)
        return self.sessions[session_id]

    async def create(self, session_id: str, mode: str = "rules") -> MeetingSession:
        async with self.lock:
            if session_id in self.ended_ids:
                raise SessionEnded(session_id)
            if session_id not in self.sessions:
                if len(self.sessions) >= self.max_sessions:
                    raise SessionLimit()
                self.sessions[session_id] = MeetingSession(
                    session_id=session_id, last_activity=self.clock(), analysis_mode=mode)
            return self.sessions[session_id]

    async def get(self, session_id: str) -> MeetingSession:
        async with self.lock:
            return self._get(session_id)

    async def touch(self, session_id: str) -> None:
        async with self.lock:
            self._get(session_id).last_activity = self.clock()

    async def add_event(self, session_id: str, event: TranscriptEvent) -> tuple[MeetingSession, bool]:
        async with self.lock:
            session = self._get(session_id)
            session.last_activity = self.clock()
            event_key = event.client_event_id or event.id
            if event_key in session.event_ids:
                return session, True
            session.event_ids.add(event_key)
            session.transcript.append(event)
            if len(session.transcript) > self.max_events:
                removed = session.transcript.pop(0)
                session.event_ids.discard(removed.client_event_id or removed.id)
            session.revision += 1
            session.updated_at = _now()
            session.analysis_status, session.analysis_detail = "pending", None
            participant = session.participants.setdefault(event.speaker, ParticipantState(speaker=event.speaker))
            participant.utterance_count += 1
            participant.last_seen_at = event.timestamp
            participant.recent_lines = [*participant.recent_lines[-9:], event.text]
            return session, False

    async def analysis_input(self, session_id: str) -> tuple[int, list[TranscriptEvent], dict[str, IntentHypothesis]]:
        async with self.lock:
            session = self._get(session_id)
            return (session.revision, [e.model_copy(deep=True) for e in session.transcript],
                    {name: insight.model_copy(deep=True) for name, insight in session.insights.items()})

    async def update_insights(self, session_id: str, insights: list[IntentHypothesis], *,
                              revision: int, mode: str, status: str,
                              detail: str | None = None) -> MeetingSession | None:
        async with self.lock:
            session = self._get(session_id)
            if revision <= session.analyzed_revision or revision > session.revision:
                return None
            session.insights = {insight.speaker: insight for insight in insights}
            for participant in session.participants.values():
                participant.current_intent = session.insights.get(participant.speaker)
            session.analyzed_revision, session.analysis_mode = revision, mode
            session.analysis_status = "pending" if revision < session.revision else status
            session.analysis_detail, session.updated_at = detail, _now()
            return session

    async def end(self, session_id: str) -> SessionSnapshot | None:
        async with self.lock:
            session = self.sessions.pop(session_id, None)
            self.ended_ids.add(session_id)
            if session is None:
                return None
            session.updated_at = _now()
            session.revision += 1
            snapshot = session.snapshot(ended=True)
            session.transcript.clear()
            session.insights.clear()
            session.participants.clear()
            session.event_ids.clear()
            session.analysis_detail = None
            return snapshot

    async def expired(self) -> list[str]:
        async with self.lock:
            now = self.clock()
            return [key for key, session in self.sessions.items()
                    if now - session.last_activity >= self.idle_seconds]

    async def clear(self) -> None:
        for session_id in list(self.sessions):
            await self.end(session_id)
        self.ended_ids.clear()
