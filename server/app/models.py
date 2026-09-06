from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


IntentLabel = Literal[
    "seeking_decision",
    "seeking_clarification",
    "raising_risk",
    "resisting_scope",
    "delaying_decision",
    "avoiding_commitment",
    "pushing_ownership",
    "seeking_alignment",
    "indirect_disagreement",
    "escalating_urgency",
    "neutral_or_unclear",
]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TranscriptEventIn(BaseModel):
    speaker: str = Field(default="Unknown", min_length=1, max_length=120)
    text: str = Field(min_length=1, max_length=10_000)
    timestamp: datetime = Field(default_factory=utc_now)
    source: str = Field(default="unknown", max_length=80)
    sequence: int | None = None


class TranscriptEvent(TranscriptEventIn):
    id: str = Field(default_factory=lambda: str(uuid4()))


class IntentHypothesis(BaseModel):
    speaker: str
    intent_label: IntentLabel
    hypothesis: str
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: list[str] = Field(default_factory=list)
    suggested_user_move: str
    updated_at: datetime = Field(default_factory=utc_now)


class ParticipantState(BaseModel):
    speaker: str
    utterance_count: int = 0
    last_seen_at: datetime | None = None
    recent_lines: list[str] = Field(default_factory=list)
    current_intent: IntentHypothesis | None = None


class SessionSnapshot(BaseModel):
    session_id: str
    started_at: datetime
    updated_at: datetime
    transcript: list[TranscriptEvent]
    participants: list[ParticipantState]
    insights: list[IntentHypothesis]


class IngestResponse(BaseModel):
    accepted: bool
    duplicate: bool = False
    event: TranscriptEvent | None = None
    insights: list[IntentHypothesis] = Field(default_factory=list)


class HealthResponse(BaseModel):
    ok: bool
    model_mode: str
