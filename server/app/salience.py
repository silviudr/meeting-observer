"""Attention cues computed by the application from observable speech.

Every cue rests on counted events, elapsed time, or already validated
`IntentLabel` values. Nothing here infers sentiment, emotion, engagement or
standing personal traits; see item 8 of `specs/enhancement-backlog.md`.

Cue prose comes from `CUE_TEMPLATES` for the same reason coaching prompts do:
displayed text must never originate from the model.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .models import IntentHypothesis, ParticipantState, SalienceCue, TranscriptEvent


# Labels that read as moving the group forward, versus holding it back. Movement
# between the two groups is a position change; movement inside one is not.
SUPPORTIVE = frozenset({"seeking_decision", "seeking_alignment", "escalating_urgency"})
RESISTANT = frozenset(
    {
        "raising_risk",
        "resisting_scope",
        "delaying_decision",
        "avoiding_commitment",
        "indirect_disagreement",
    }
)

LABEL_NAMES = {
    "seeking_decision": "pushing for a decision",
    "seeking_clarification": "seeking clarification",
    "raising_risk": "raising risk",
    "resisting_scope": "resisting scope",
    "delaying_decision": "delaying the decision",
    "avoiding_commitment": "avoiding commitment",
    "pushing_ownership": "moving ownership",
    "seeking_alignment": "seeking alignment",
    "indirect_disagreement": "disagreeing indirectly",
    "escalating_urgency": "escalating urgency",
    "neutral_or_unclear": "unclear",
}

CUE_TEMPLATES = {
    "unanswered_question": "{speaker} asked a question and you have not spoken since.",
    "new_risk": "{speaker} has raised a risk.",
    "position_change": "{speaker} moved from {before} to {after}.",
    "owner_dominating": "You have held {percent}% of the last {turns} turns.",
    "silent_participant": "{speaker} has not spoken for {minutes} minutes.",
}

CUE_PRIORITIES = {
    "unanswered_question": 100,
    "new_risk": 80,
    "position_change": 70,
    "owner_dominating": 50,
    "silent_participant": 40,
}

# Conservative openers. Captions frequently drop the question mark, but a looser
# rule fires on ordinary statements, which is worse than missing a question.
INTERROGATIVE = re.compile(
    r"^(what|why|how|when|where|who|which|whose|can|could|should|would|will|do|does|did|is|are|was|were|shall|might)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class SalienceConfig:
    silence_seconds: float = 300.0
    airtime_window: int = 10
    owner_share_threshold: float = 0.6
    question_lookback: int = 12
    max_cues: int = 4


DEFAULT_CONFIG = SalienceConfig()


def normalize_name(value: str) -> str:
    return " ".join(str(value or "").split()).casefold()


def is_owner_speaker(owner_speaker: str | None, speaker: str) -> bool:
    """Match a caption speaker against the owner's declared name.

    Google Meet labels the local participant `You` in many layouts, so that
    literal also resolves to the owner once a name is set. Matching is exact
    after normalisation; it is never fuzzy, because a wrong match would
    misattribute speech to the owner.
    """
    if not owner_speaker:
        return False
    candidate = normalize_name(speaker)
    return candidate == normalize_name(owner_speaker) or candidate == "you"


def looks_like_question(text: str) -> bool:
    stripped = str(text or "").strip()
    if not stripped:
        return False
    return stripped.endswith("?") or bool(INTERROGATIVE.match(stripped))


def _cue(kind: str, *, speaker: str | None = None, evidence: list[str] | None = None, **fields) -> SalienceCue:
    return SalienceCue(
        kind=kind,
        message=CUE_TEMPLATES[kind].format(speaker=speaker, **fields),
        priority=CUE_PRIORITIES[kind],
        speaker=speaker,
        evidence_event_ids=evidence or [],
    )


def _unanswered_question(
    transcript: list[TranscriptEvent], owner_speaker: str | None, config: SalienceConfig
) -> SalienceCue | None:
    """The most recent non-owner question with no owner utterance after it."""
    if not owner_speaker:
        return None
    recent = transcript[-config.question_lookback :]
    for index in range(len(recent) - 1, -1, -1):
        event = recent[index]
        if is_owner_speaker(owner_speaker, event.speaker):
            return None  # The owner has spoken more recently than any question.
        if looks_like_question(event.text):
            return _cue("unanswered_question", speaker=event.speaker, evidence=[event.id])
    return None


def _label_cues(
    insights: dict[str, IntentHypothesis], previous_labels: dict[str, str]
) -> list[SalienceCue]:
    cues: list[SalienceCue] = []
    for speaker, insight in insights.items():
        current = insight.intent_label
        previous = previous_labels.get(speaker)
        if previous == current:
            continue
        if current == "raising_risk" and previous != "raising_risk":
            cues.append(
                _cue("new_risk", speaker=speaker, evidence=list(insight.evidence_event_ids))
            )
            continue
        if previous is None:
            continue
        moved = (previous in SUPPORTIVE and current in RESISTANT) or (
            previous in RESISTANT and current in SUPPORTIVE
        )
        if moved:
            cues.append(
                _cue(
                    "position_change",
                    speaker=speaker,
                    evidence=list(insight.evidence_event_ids),
                    before=LABEL_NAMES.get(previous, previous),
                    after=LABEL_NAMES.get(current, current),
                )
            )
    return cues


def _owner_dominating(
    transcript: list[TranscriptEvent], owner_speaker: str | None, config: SalienceConfig
) -> SalienceCue | None:
    if not owner_speaker:
        return None
    window = transcript[-config.airtime_window :]
    if len(window) < config.airtime_window:
        return None
    owned = sum(1 for event in window if is_owner_speaker(owner_speaker, event.speaker))
    share = owned / len(window)
    if share < config.owner_share_threshold:
        return None
    return _cue("owner_dominating", percent=round(share * 100), turns=len(window))


def _silent_participants(
    participants: dict[str, ParticipantState],
    speaker_seen: dict[str, float],
    owner_speaker: str | None,
    now: float,
    config: SalienceConfig,
) -> list[SalienceCue]:
    cues: list[SalienceCue] = []
    for speaker, participant in participants.items():
        if participant.utterance_count < 1 or is_owner_speaker(owner_speaker, speaker):
            continue
        last_seen = speaker_seen.get(speaker)
        if last_seen is None:
            continue
        elapsed = now - last_seen
        if elapsed < config.silence_seconds:
            continue
        cues.append(_cue("silent_participant", speaker=speaker, minutes=int(elapsed // 60)))
    return cues


def compute_cues(
    *,
    transcript: list[TranscriptEvent],
    participants: dict[str, ParticipantState],
    insights: dict[str, IntentHypothesis],
    previous_labels: dict[str, str],
    speaker_seen: dict[str, float],
    owner_speaker: str | None,
    now: float,
    config: SalienceConfig = DEFAULT_CONFIG,
) -> list[SalienceCue]:
    """Return ordered attention cues. An empty list is a valid, quiet result."""
    cues: list[SalienceCue] = []
    question = _unanswered_question(transcript, owner_speaker, config)
    if question is not None:
        cues.append(question)
    cues.extend(_label_cues(insights, previous_labels))
    dominating = _owner_dominating(transcript, owner_speaker, config)
    if dominating is not None:
        cues.append(dominating)
    cues.extend(_silent_participants(participants, speaker_seen, owner_speaker, now, config))
    cues.sort(key=lambda cue: cue.priority, reverse=True)
    return cues[: config.max_cues]


def owner_matched(participants: dict[str, ParticipantState], owner_speaker: str | None) -> bool:
    if not owner_speaker:
        return False
    return any(is_owner_speaker(owner_speaker, speaker) for speaker in participants)
