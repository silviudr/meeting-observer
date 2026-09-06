from __future__ import annotations

import pytest

from app.models import IntentHypothesis, TranscriptEvent
from app.sessions import SessionStore


@pytest.mark.asyncio
async def test_store_deduplicates_recent_events(tmp_path) -> None:
    store = SessionStore(db_path=str(tmp_path / "test.sqlite"))
    event = TranscriptEvent(speaker="Alex", text="Can we decide today?", source="test")

    _, first_duplicate = await store.add_event("demo", event)
    _, second_duplicate = await store.add_event(
        "demo",
        TranscriptEvent(speaker="Alex", text="Can we decide today?", source="test"),
    )

    assert first_duplicate is False
    assert second_duplicate is True


@pytest.mark.asyncio
async def test_store_updates_participant_intent(tmp_path) -> None:
    store = SessionStore(db_path=str(tmp_path / "test.sqlite"))
    await store.add_event("demo", TranscriptEvent(speaker="Maria", text="Can we agree?", source="test"))
    insight = IntentHypothesis(
        speaker="Maria",
        intent_label="seeking_alignment",
        hypothesis="Maria may be checking whether the group is aligned.",
        confidence=0.7,
        evidence=["Can we agree?"],
        suggested_user_move="Summarize the shared position and ask who disagrees.",
    )

    session = await store.update_insights("demo", [insight])

    assert session.participants["Maria"].current_intent is not None
    assert session.insights["Maria"].intent_label == "seeking_alignment"
