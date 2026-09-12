from __future__ import annotations

import pytest

from app.models import IntentHypothesis, TranscriptEvent
from app.sessions import SessionEnded, SessionLimit, SessionMissing, SessionStore


def event(speaker: str = "Alex", text: str = "Can we decide today?", **overrides) -> TranscriptEvent:
    return TranscriptEvent(speaker=speaker, text=text, source="test", **overrides)


@pytest.mark.asyncio
async def test_create_is_idempotent_for_active_ids() -> None:
    store = SessionStore()
    first = await store.create("demo", "vllm")
    second = await store.create("demo", "rules")

    assert second is first
    assert second.analysis_mode == "vllm"


@pytest.mark.asyncio
async def test_unknown_session_is_missing_not_created() -> None:
    store = SessionStore()

    with pytest.raises(SessionMissing):
        await store.get("never-started")


@pytest.mark.asyncio
async def test_deduplicates_identical_retries_and_keeps_legitimate_repeats() -> None:
    store = SessionStore()
    await store.create("demo")

    _, first = await store.add_event("demo", event(client_event_id="retry-1"))
    assert first is False
    assert len((await store.get("demo")).transcript) == 1

    # Same client_event_id arriving again (transport retry) is a duplicate.
    _, duplicate = await store.add_event("demo", event(client_event_id="retry-1"))
    assert duplicate is True
    assert len((await store.get("demo")).transcript) == 1

    # The same words spoken again are a new event with a new identity.
    _, repeated = await store.add_event("demo", event(client_event_id="retry-2"))
    assert repeated is False
    assert len((await store.get("demo")).transcript) == 2


@pytest.mark.asyncio
async def test_add_event_updates_participants_and_marks_analysis_pending() -> None:
    store = SessionStore()
    await store.create("demo")

    session, _ = await store.add_event("demo", event(speaker="Maria", text="Can we agree?"))

    participant = session.participants["Maria"]
    assert participant.utterance_count == 1
    assert participant.last_seen_at is not None
    assert participant.recent_lines == ["Can we agree?"]
    assert session.revision == 1
    assert session.analysis_status == "pending"


@pytest.mark.asyncio
async def test_update_insights_sets_participant_current_intent() -> None:
    store = SessionStore()
    await store.create("demo")
    await store.add_event("demo", event(speaker="Maria", text="Can we agree?"))
    insight = IntentHypothesis(
        speaker="Maria",
        intent_label="seeking_alignment",
        hypothesis="Maria may be checking whether the group is aligned.",
        confidence=0.7,
        evidence=["Can we agree?"],
        suggested_user_move="Summarize the shared position and ask who disagrees.",
    )

    session = await store.update_insights(
        "demo", [insight], revision=1, mode="rules", status="ready"
    )

    assert session.participants["Maria"].current_intent is insight
    assert session.insights["Maria"].intent_label == "seeking_alignment"
    assert session.analysis_status == "ready"
    assert session.analyzed_revision == 1


@pytest.mark.asyncio
async def test_update_insights_keeps_newer_revision_pending() -> None:
    store = SessionStore()
    await store.create("demo")
    await store.add_event("demo", event())          # revision 1
    await store.add_event("demo", event(client_event_id="e2"))  # revision 2

    # Work computed for revision 1 may be displayed while revision 2 is still pending.
    session = await store.update_insights(
        "demo", [], revision=1, mode="rules", status="ready"
    )
    assert session is not None
    assert session.analyzed_revision == 1
    assert session.analysis_status == "pending"

    stale = await store.update_insights(
        "demo", [], revision=1, mode="rules", status="ready"
    )
    assert stale is None
    assert (await store.get("demo")).analysis_status == "pending"


@pytest.mark.asyncio
async def test_expired_lists_idle_sessions_but_viewing_never_renews() -> None:
    clock = {"now": 0.0}
    store = SessionStore(idle_seconds=300, clock=lambda: clock["now"])
    await store.create("demo")
    await store.touch("demo")

    clock["now"] = 100
    assert await store.expired() == []

    clock["now"] = 301
    assert await store.expired() == ["demo"]


@pytest.mark.asyncio
async def test_end_clears_content_and_ended_ids_never_reopen() -> None:
    store = SessionStore()
    await store.create("demo")
    await store.add_event("demo", event(client_event_id="e1"))

    snapshot = await store.end("demo")

    assert snapshot is not None
    assert snapshot.status == "ended"
    assert snapshot.transcript == [] and snapshot.insights == [] and snapshot.participants == []
    with pytest.raises(SessionEnded):
        await store.get("demo")
    with pytest.raises(SessionEnded):
        await store.create("demo")
    with pytest.raises(SessionEnded):
        await store.add_event("demo", event())
    # Ending an already ended session reports deleted: false.
    assert await store.end("demo") is None


@pytest.mark.asyncio
async def test_session_limit_rejects_new_active_sessions() -> None:
    store = SessionStore(max_sessions=2)
    await store.create("one")
    await store.create("two")

    with pytest.raises(SessionLimit):
        await store.create("three")
    # Existing sessions keep working.
    _, duplicate = await store.add_event("one", event())
    assert duplicate is False


@pytest.mark.asyncio
async def test_clear_ends_all_sessions_for_shutdown() -> None:
    store = SessionStore()
    await store.create("one")
    await store.create("two")
    await store.add_event("one", event())
    await store.add_event("two", event())

    await store.clear()

    with pytest.raises(SessionMissing):
        await store.get("one")
    with pytest.raises(SessionMissing):
        await store.get("two")


@pytest.mark.asyncio
async def test_owner_can_be_set_before_any_caption_arrives() -> None:
    store = SessionStore()
    await store.create("demo")

    session = await store.set_owner("demo", "  Maria   Lopez ")

    assert session.owner_speaker == "Maria Lopez"
    assert session.snapshot().owner_matched is False


@pytest.mark.asyncio
async def test_owner_match_is_reported_once_that_speaker_is_captured() -> None:
    store = SessionStore()
    await store.create("demo")
    await store.set_owner("demo", "Maria")

    await store.add_event("demo", event(speaker="Dan", client_event_id="d1"))
    assert (await store.get("demo")).snapshot().owner_matched is False

    await store.add_event("demo", event(speaker="Maria", client_event_id="m1"))
    snapshot = (await store.get("demo")).snapshot()
    assert snapshot.owner_matched is True
    assert [p.speaker for p in snapshot.participants if p.is_owner] == ["Maria"]


@pytest.mark.asyncio
async def test_setting_the_owner_later_relabels_existing_participants() -> None:
    store = SessionStore()
    await store.create("demo")
    await store.add_event("demo", event(speaker="Maria", client_event_id="m1"))
    assert (await store.get("demo")).snapshot().owner_matched is False

    await store.set_owner("demo", "Maria")

    snapshot = (await store.get("demo")).snapshot()
    assert snapshot.owner_matched is True
    assert [p.speaker for p in snapshot.participants if p.is_owner] == ["Maria"]


@pytest.mark.asyncio
async def test_owner_can_be_cleared() -> None:
    store = SessionStore()
    await store.create("demo")
    await store.set_owner("demo", "Maria")

    session = await store.set_owner("demo", "")

    assert session.owner_speaker is None
    assert session.snapshot().owner_matched is False


@pytest.mark.asyncio
async def test_unanswered_question_appears_in_the_snapshot() -> None:
    store = SessionStore()
    await store.create("demo")
    await store.set_owner("demo", "Maria")

    await store.add_event(
        "demo", event(speaker="Dan", text="What is the migration cost?", client_event_id="q1")
    )

    cues = (await store.get("demo")).snapshot().cues
    assert [cue.kind for cue in cues] == ["unanswered_question"]

    await store.add_event(
        "demo", event(speaker="Maria", text="About two weeks.", client_event_id="a1")
    )
    assert (await store.get("demo")).snapshot().cues == []


@pytest.mark.asyncio
async def test_a_risk_surfaces_once_and_does_not_repeat_on_the_next_pass() -> None:
    store = SessionStore()
    await store.create("demo")
    await store.add_event("demo", event(speaker="Priya", client_event_id="p1"))

    risk = IntentHypothesis(
        speaker="Priya", intent_label="raising_risk", hypothesis="Priya may be surfacing risk.",
        confidence=0.8, evidence=["line"], evidence_event_ids=["p1"],
        suggested_user_move="Ask what specific evidence would resolve this concern.")
    session = await store.update_insights(
        "demo", [risk], revision=1, mode="vllm", status="ready")
    assert [cue.kind for cue in session.snapshot().cues] == ["new_risk"]

    # A second pass holding the same label is not a new risk.
    await store.add_event("demo", event(speaker="Priya", client_event_id="p2"))
    session = await store.update_insights(
        "demo", [risk], revision=2, mode="vllm", status="ready")
    assert [cue.kind for cue in session.snapshot().cues] == []


@pytest.mark.asyncio
async def test_ending_a_session_clears_owner_and_cues() -> None:
    store = SessionStore()
    await store.create("demo")
    await store.set_owner("demo", "Maria")
    await store.add_event(
        "demo", event(speaker="Dan", text="Should we delay?", client_event_id="q1")
    )
    assert (await store.get("demo")).snapshot().cues

    snapshot = await store.end("demo")

    assert snapshot.status == "ended"
    assert snapshot.owner_speaker is None
    assert snapshot.owner_matched is False
    assert snapshot.cues == []
