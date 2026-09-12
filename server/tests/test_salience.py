from __future__ import annotations

from app.models import IntentHypothesis, ParticipantState, TranscriptEvent
from app.salience import (
    DEFAULT_CONFIG,
    SalienceConfig,
    compute_cues,
    is_owner_speaker,
    looks_like_question,
    owner_matched,
)


def event(event_id: str, speaker: str, text: str = "Some caption text.") -> TranscriptEvent:
    return TranscriptEvent(id=event_id, speaker=speaker, text=text)


def insight(speaker: str, label: str, evidence: list[str] | None = None) -> IntentHypothesis:
    return IntentHypothesis(
        speaker=speaker,
        intent_label=label,
        hypothesis=f"{speaker} hypothesis.",
        confidence=0.7,
        evidence=["line"],
        evidence_event_ids=evidence or ["e1"],
        suggested_user_move="Ask for an explicit decision, owner, and date.",
    )


def cues(**overrides):
    base = dict(
        transcript=[],
        participants={},
        insights={},
        previous_labels={},
        speaker_seen={},
        owner_speaker=None,
        now=0.0,
        config=DEFAULT_CONFIG,
    )
    base.update(overrides)
    return compute_cues(**base)


def kinds(result) -> list[str]:
    return [cue.kind for cue in result]


# --- owner matching -------------------------------------------------------


def test_owner_matches_exactly_and_ignores_case_and_spacing() -> None:
    assert is_owner_speaker("Maria Lopez", "maria   lopez") is True
    assert is_owner_speaker("Maria Lopez", "Maria") is False
    assert is_owner_speaker("Maria Lopez", "Mario Lopez") is False


def test_meet_renders_the_local_participant_as_you() -> None:
    assert is_owner_speaker("Maria", "You") is True
    assert is_owner_speaker("Maria", "you") is True


def test_no_owner_set_means_nothing_matches_including_you() -> None:
    assert is_owner_speaker(None, "You") is False
    assert is_owner_speaker("", "Maria") is False


def test_owner_matched_reports_whether_a_captured_speaker_matched() -> None:
    participants = {"Dan": ParticipantState(speaker="Dan")}
    assert owner_matched(participants, "Maria") is False
    participants["Maria"] = ParticipantState(speaker="Maria")
    assert owner_matched(participants, "Maria") is True
    assert owner_matched(participants, None) is False


# --- question detection ---------------------------------------------------


def test_question_detection_accepts_marks_and_clear_openers() -> None:
    assert looks_like_question("Are we aligned") is True
    assert looks_like_question("no punctuation here?") is True
    assert looks_like_question("What do you mean by that") is True


def test_question_detection_rejects_plain_statements() -> None:
    assert looks_like_question("I think we should ship on Friday.") is False
    assert looks_like_question("") is False
    assert looks_like_question("   ") is False


# --- unanswered question --------------------------------------------------


def test_unanswered_question_from_another_speaker_is_surfaced() -> None:
    transcript = [event("q1", "Dan", "What is the migration cost?")]
    result = cues(transcript=transcript, owner_speaker="Maria")
    assert kinds(result) == ["unanswered_question"]
    assert result[0].speaker == "Dan"
    assert result[0].evidence_event_ids == ["q1"]


def test_owner_speaking_after_the_question_clears_it() -> None:
    transcript = [
        event("q1", "Dan", "What is the migration cost?"),
        event("a1", "Maria", "About two weeks of work."),
    ]
    assert cues(transcript=transcript, owner_speaker="Maria") == []


def test_the_owners_own_question_is_not_an_unanswered_question() -> None:
    transcript = [event("q1", "Maria", "What is the migration cost?")]
    assert cues(transcript=transcript, owner_speaker="Maria") == []


def test_no_question_cue_without_an_owner() -> None:
    transcript = [event("q1", "Dan", "What is the migration cost?")]
    assert cues(transcript=transcript) == []


# --- label-derived cues ---------------------------------------------------


def test_moving_into_raising_risk_surfaces_a_new_risk() -> None:
    result = cues(
        insights={"Priya": insight("Priya", "raising_risk", ["r1"])},
        previous_labels={"Priya": "seeking_alignment"},
    )
    assert kinds(result) == ["new_risk"]
    assert result[0].evidence_event_ids == ["r1"]


def test_a_risk_already_held_does_not_resurface() -> None:
    result = cues(
        insights={"Priya": insight("Priya", "raising_risk")},
        previous_labels={"Priya": "raising_risk"},
    )
    assert result == []


def test_crossing_between_clusters_is_a_position_change() -> None:
    result = cues(
        insights={"Dan": insight("Dan", "seeking_decision")},
        previous_labels={"Dan": "delaying_decision"},
    )
    assert kinds(result) == ["position_change"]
    assert "delaying the decision" in result[0].message
    assert "pushing for a decision" in result[0].message


def test_movement_inside_one_cluster_is_not_a_position_change() -> None:
    result = cues(
        insights={"Dan": insight("Dan", "avoiding_commitment")},
        previous_labels={"Dan": "delaying_decision"},
    )
    assert result == []


def test_a_first_ever_label_is_not_a_position_change() -> None:
    result = cues(insights={"Dan": insight("Dan", "seeking_decision")}, previous_labels={})
    assert result == []


# --- airtime and silence --------------------------------------------------


def test_owner_dominating_fires_once_the_window_is_full() -> None:
    transcript = [event(f"e{i}", "Maria") for i in range(7)]
    transcript += [event(f"o{i}", "Dan") for i in range(3)]
    result = cues(transcript=transcript, owner_speaker="Maria")
    assert "owner_dominating" in kinds(result)
    cue = next(c for c in result if c.kind == "owner_dominating")
    assert "70%" in cue.message


def test_a_short_meeting_does_not_trigger_airtime() -> None:
    transcript = [event(f"e{i}", "Maria") for i in range(9)]
    assert "owner_dominating" not in kinds(cues(transcript=transcript, owner_speaker="Maria"))


def test_balanced_airtime_stays_quiet() -> None:
    transcript = [event(f"e{i}", "Maria" if i % 2 else "Dan") for i in range(12)]
    assert "owner_dominating" not in kinds(cues(transcript=transcript, owner_speaker="Maria"))


def test_silence_is_reported_after_the_threshold() -> None:
    participants = {"Priya": ParticipantState(speaker="Priya", utterance_count=3)}
    result = cues(participants=participants, speaker_seen={"Priya": 0.0}, now=420.0)
    assert kinds(result) == ["silent_participant"]
    assert "7 minutes" in result[0].message


def test_recent_speech_is_not_silence() -> None:
    participants = {"Priya": ParticipantState(speaker="Priya", utterance_count=3)}
    assert cues(participants=participants, speaker_seen={"Priya": 0.0}, now=60.0) == []


def test_the_owner_is_never_reported_as_silent() -> None:
    participants = {"Maria": ParticipantState(speaker="Maria", utterance_count=3)}
    result = cues(
        participants=participants, speaker_seen={"Maria": 0.0}, now=420.0, owner_speaker="Maria"
    )
    assert kinds(result) == []


# --- ordering and quiet operation ----------------------------------------


def test_no_signal_produces_no_cues() -> None:
    transcript = [event("e1", "Dan", "We shipped the change on Tuesday.")]
    assert cues(transcript=transcript, owner_speaker="Maria") == []


def test_cues_are_ordered_by_priority_and_capped() -> None:
    transcript = [event("q1", "Dan", "Should we delay?")]
    participants = {
        f"P{i}": ParticipantState(speaker=f"P{i}", utterance_count=1) for i in range(5)
    }
    result = cues(
        transcript=transcript,
        participants=participants,
        insights={"Priya": insight("Priya", "raising_risk")},
        previous_labels={"Priya": "seeking_alignment"},
        speaker_seen={f"P{i}": 0.0 for i in range(5)},
        owner_speaker="Maria",
        now=420.0,
    )
    assert len(result) == DEFAULT_CONFIG.max_cues
    assert kinds(result)[:2] == ["unanswered_question", "new_risk"]
    assert [cue.priority for cue in result] == sorted(
        (cue.priority for cue in result), reverse=True
    )


def test_thresholds_are_configurable_for_local_experiments() -> None:
    participants = {"Priya": ParticipantState(speaker="Priya", utterance_count=1)}
    config = SalienceConfig(silence_seconds=30.0)
    result = compute_cues(
        transcript=[],
        participants=participants,
        insights={},
        previous_labels={},
        speaker_seen={"Priya": 0.0},
        owner_speaker=None,
        now=45.0,
        config=config,
    )
    assert kinds(result) == ["silent_participant"]


def test_cue_text_comes_only_from_the_application_catalog() -> None:
    from app.salience import CUE_TEMPLATES

    transcript = [event("q1", "Dan", "What is the plan?")]
    result = cues(transcript=transcript, owner_speaker="Maria")
    template = CUE_TEMPLATES[result[0].kind]
    assert result[0].message == template.format(speaker="Dan")
