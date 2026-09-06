from __future__ import annotations

import asyncio
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .models import IntentHypothesis, ParticipantState, SessionSnapshot, TranscriptEvent


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class MeetingSession:
    session_id: str
    started_at: datetime = field(default_factory=_now)
    updated_at: datetime = field(default_factory=_now)
    transcript: list[TranscriptEvent] = field(default_factory=list)
    participants: dict[str, ParticipantState] = field(default_factory=dict)
    insights: dict[str, IntentHypothesis] = field(default_factory=dict)

    def snapshot(self) -> SessionSnapshot:
        return SessionSnapshot(
            session_id=self.session_id,
            started_at=self.started_at,
            updated_at=self.updated_at,
            transcript=self.transcript[-250:],
            participants=sorted(self.participants.values(), key=lambda item: item.speaker.lower()),
            insights=sorted(self.insights.values(), key=lambda item: item.confidence, reverse=True),
        )


class SessionStore:
    def __init__(self, db_path: str = "meeting_observer.sqlite") -> None:
        self.db_path = Path(db_path)
        self.sessions: dict[str, MeetingSession] = {}
        self.lock = asyncio.Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS transcript_events (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    speaker TEXT NOT NULL,
                    text TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    source TEXT NOT NULL,
                    sequence INTEGER
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS insights (
                    session_id TEXT NOT NULL,
                    speaker TEXT NOT NULL,
                    intent_label TEXT NOT NULL,
                    hypothesis TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    evidence TEXT NOT NULL,
                    suggested_user_move TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (session_id, speaker)
                )
                """
            )

    async def get(self, session_id: str) -> MeetingSession:
        async with self.lock:
            if session_id not in self.sessions:
                self.sessions[session_id] = MeetingSession(session_id=session_id)
            return self.sessions[session_id]

    async def add_event(self, session_id: str, event: TranscriptEvent) -> tuple[MeetingSession, bool]:
        async with self.lock:
            session = self.sessions.setdefault(session_id, MeetingSession(session_id=session_id))
            if self._is_duplicate(session, event):
                return session, True

            session.transcript.append(event)
            session.updated_at = _now()
            participant = session.participants.setdefault(event.speaker, ParticipantState(speaker=event.speaker))
            participant.utterance_count += 1
            participant.last_seen_at = event.timestamp
            participant.recent_lines = [*participant.recent_lines[-9:], event.text]
            self._persist_event(session_id, event)
            return session, False

    async def update_insights(self, session_id: str, insights: list[IntentHypothesis]) -> MeetingSession:
        async with self.lock:
            session = self.sessions.setdefault(session_id, MeetingSession(session_id=session_id))
            for insight in insights:
                session.insights[insight.speaker] = insight
                participant = session.participants.setdefault(
                    insight.speaker,
                    ParticipantState(speaker=insight.speaker),
                )
                participant.current_intent = insight
                self._persist_insight(session_id, insight)
            session.updated_at = _now()
            return session

    async def delete(self, session_id: str) -> bool:
        async with self.lock:
            existed = self.sessions.pop(session_id, None) is not None
            with self._connect() as conn:
                conn.execute("DELETE FROM transcript_events WHERE session_id = ?", (session_id,))
                conn.execute("DELETE FROM insights WHERE session_id = ?", (session_id,))
            return existed

    def _is_duplicate(self, session: MeetingSession, event: TranscriptEvent) -> bool:
        normalized_text = " ".join(event.text.lower().split())
        for previous in reversed(session.transcript[-8:]):
            if previous.speaker != event.speaker:
                continue
            previous_text = " ".join(previous.text.lower().split())
            if previous_text == normalized_text:
                return True
            if normalized_text.startswith(previous_text) and len(normalized_text) - len(previous_text) < 12:
                return True
        return False

    def _persist_event(self, session_id: str, event: TranscriptEvent) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR IGNORE INTO transcript_events
                (id, session_id, speaker, text, timestamp, source, sequence)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event.id,
                    session_id,
                    event.speaker,
                    event.text,
                    event.timestamp.isoformat(),
                    event.source,
                    event.sequence,
                ),
            )

    def _persist_insight(self, session_id: str, insight: IntentHypothesis) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO insights
                (session_id, speaker, intent_label, hypothesis, confidence, evidence, suggested_user_move, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    insight.speaker,
                    insight.intent_label,
                    insight.hypothesis,
                    insight.confidence,
                    "\n".join(insight.evidence),
                    insight.suggested_user_move,
                    insight.updated_at.isoformat(),
                ),
            )
