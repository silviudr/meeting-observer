from __future__ import annotations

import json
import os
from collections import Counter
from datetime import datetime, timezone

import httpx
from pydantic import ValidationError

from .models import IntentHypothesis, TranscriptEvent


class IntentAnalyzer:
    async def analyze(
        self,
        session_id: str,
        transcript: list[TranscriptEvent],
        existing: dict[str, IntentHypothesis],
    ) -> list[IntentHypothesis]:
        raise NotImplementedError


class RuleBasedIntentAnalyzer(IntentAnalyzer):
    def __init__(self, max_recent_events: int = 40) -> None:
        self.max_recent_events = max_recent_events

    async def analyze(
        self,
        session_id: str,
        transcript: list[TranscriptEvent],
        existing: dict[str, IntentHypothesis],
    ) -> list[IntentHypothesis]:
        del session_id
        recent = transcript[-self.max_recent_events :]
        by_speaker: dict[str, list[TranscriptEvent]] = {}
        for event in recent:
            by_speaker.setdefault(event.speaker.strip() or "Unknown", []).append(event)

        insights: list[IntentHypothesis] = []
        for speaker, events in by_speaker.items():
            text = " ".join(event.text for event in events).lower()
            label, confidence, user_move = self._classify(text)
            evidence = self._evidence(events, label)
            if not evidence:
                evidence = [events[-1].text[:220]]

            hypothesis = self._hypothesis(speaker, label)
            previous = existing.get(speaker)
            if previous and previous.intent_label == label and confidence < previous.confidence:
                confidence = previous.confidence

            insights.append(
                IntentHypothesis(
                    speaker=speaker,
                    intent_label=label,
                    hypothesis=hypothesis,
                    confidence=confidence,
                    evidence=evidence[:3],
                    suggested_user_move=user_move,
                    updated_at=datetime.now(timezone.utc),
                )
            )

        return sorted(insights, key=lambda item: item.confidence, reverse=True)

    def _classify(self, text: str) -> tuple[str, float, str]:
        patterns: list[tuple[str, float, list[str], str]] = [
            (
                "seeking_decision",
                0.72,
                ["decide", "decision", "can we agree", "are we aligned", "next step", "ship it"],
                "Ask for an explicit decision, owner, and date.",
            ),
            (
                "raising_risk",
                0.76,
                ["risk", "concern", "worried", "issue", "blocker", "security", "compliance", "migration cost"],
                "Ask which risk is most likely and what would reduce it.",
            ),
            (
                "delaying_decision",
                0.70,
                ["more data", "not ready", "come back", "next week", "later", "before deciding", "validate first"],
                "Ask what specific information is required to decide.",
            ),
            (
                "avoiding_commitment",
                0.68,
                ["maybe", "not sure", "depends", "hard to say", "circle back", "leave it open"],
                "Ask for the smallest commitment they can make now.",
            ),
            (
                "resisting_scope",
                0.70,
                ["out of scope", "too much", "scope creep", "not part of", "keep it small"],
                "Restate the boundary and ask what should be excluded.",
            ),
            (
                "seeking_clarification",
                0.66,
                ["what do you mean", "clarify", "can you explain", "how exactly", "which one", "why"],
                "Answer the specific ambiguity, then check whether it resolves the concern.",
            ),
            (
                "pushing_ownership",
                0.66,
                ["who owns", "owner", "responsible", "accountable", "you take", "they should"],
                "Name a proposed owner and ask for confirmation.",
            ),
            (
                "seeking_alignment",
                0.65,
                ["aligned", "same page", "agree", "buy in", "consensus"],
                "Summarize the shared position and ask who disagrees.",
            ),
            (
                "indirect_disagreement",
                0.62,
                ["i hear you", "that said", "however", "but", "i'm not convinced", "not convinced"],
                "Invite the disagreement directly and ask what would change their view.",
            ),
            (
                "escalating_urgency",
                0.69,
                ["urgent", "asap", "deadline", "today", "by tomorrow", "running out", "critical"],
                "Clarify the deadline and ask what must happen first.",
            ),
        ]

        scores: Counter[str] = Counter()
        details: dict[str, tuple[float, str]] = {}
        for label, base_confidence, phrases, user_move in patterns:
            matches = sum(1 for phrase in phrases if phrase in text)
            if matches:
                scores[label] += matches
                details[label] = (min(base_confidence + (matches - 1) * 0.05, 0.9), user_move)

        if not scores:
            return (
                "neutral_or_unclear",
                0.45,
                "Keep listening or ask an open question if the participant's position matters.",
            )

        label, _ = scores.most_common(1)[0]
        confidence, user_move = details[label]
        return label, confidence, user_move

    def _evidence(self, events: list[TranscriptEvent], label: str) -> list[str]:
        label_terms = {
            "seeking_decision": ["decide", "decision", "agree", "aligned", "next step", "ship"],
            "raising_risk": ["risk", "concern", "worried", "issue", "blocker", "security", "compliance"],
            "delaying_decision": ["more data", "not ready", "later", "next week", "before deciding", "validate"],
            "avoiding_commitment": ["maybe", "not sure", "depends", "circle back", "leave it open"],
            "resisting_scope": ["out of scope", "too much", "scope creep", "keep it small"],
            "seeking_clarification": ["mean", "clarify", "explain", "exactly", "which", "why"],
            "pushing_ownership": ["who owns", "owner", "responsible", "accountable"],
            "seeking_alignment": ["aligned", "same page", "agree", "buy in", "consensus"],
            "indirect_disagreement": ["however", "but", "not convinced", "that said"],
            "escalating_urgency": ["urgent", "asap", "deadline", "today", "tomorrow", "critical"],
        }
        terms = label_terms.get(label, [])
        evidence = []
        for event in reversed(events):
            lower = event.text.lower()
            if any(term in lower for term in terms):
                evidence.append(event.text[:220])
        return list(reversed(evidence[-3:]))

    def _hypothesis(self, speaker: str, label: str) -> str:
        templates = {
            "seeking_decision": f"{speaker} may be trying to move the group toward a decision.",
            "seeking_clarification": f"{speaker} may need clearer definitions or requirements before agreeing.",
            "raising_risk": f"{speaker} may be surfacing risk that could block or reshape the decision.",
            "resisting_scope": f"{speaker} may be trying to constrain scope.",
            "delaying_decision": f"{speaker} may be slowing the decision until more information is available.",
            "avoiding_commitment": f"{speaker} may be avoiding a firm commitment.",
            "pushing_ownership": f"{speaker} may be trying to clarify or move ownership.",
            "seeking_alignment": f"{speaker} may be checking whether the group is aligned.",
            "indirect_disagreement": f"{speaker} may be signaling disagreement indirectly.",
            "escalating_urgency": f"{speaker} may be increasing urgency around timeline or priority.",
            "neutral_or_unclear": f"{speaker}'s intent is not clear enough yet.",
        }
        return templates[label]


class OpenAICompatibleIntentAnalyzer(IntentAnalyzer):
    def __init__(self, fallback: IntentAnalyzer) -> None:
        self.fallback = fallback
        self.base_url = os.getenv("MEETING_OBSERVER_LLM_BASE_URL", "").rstrip("/")
        self.model = os.getenv("MEETING_OBSERVER_LLM_MODEL", "local-intent-model")
        self.api_key = os.getenv("MEETING_OBSERVER_LLM_API_KEY", "local")
        self.timeout = float(os.getenv("MEETING_OBSERVER_LLM_TIMEOUT", "20"))

    @property
    def enabled(self) -> bool:
        return bool(self.base_url)

    async def analyze(
        self,
        session_id: str,
        transcript: list[TranscriptEvent],
        existing: dict[str, IntentHypothesis],
    ) -> list[IntentHypothesis]:
        if not self.enabled:
            return await self.fallback.analyze(session_id, transcript, existing)

        recent = transcript[-60:]
        messages = [
            {
                "role": "system",
                "content": (
                    "You analyze meeting transcripts. Return only JSON with an 'insights' array. "
                    "Each item must include speaker, intent_label, hypothesis, confidence, evidence, "
                    "suggested_user_move. Treat intent as a hypothesis, not a fact."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "session_id": session_id,
                        "allowed_intent_labels": [
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
                        ],
                        "transcript": [
                            {
                                "speaker": event.speaker,
                                "text": event.text,
                                "timestamp": event.timestamp.isoformat(),
                            }
                            for event in recent
                        ],
                    }
                ),
            },
        ]

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json={
                        "model": self.model,
                        "messages": messages,
                        "temperature": 0.2,
                        "response_format": {"type": "json_object"},
                    },
                )
                response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            payload = json.loads(content)
            parsed = [IntentHypothesis(**item) for item in payload.get("insights", [])]
            if parsed:
                return parsed
        except (httpx.HTTPError, KeyError, json.JSONDecodeError, ValidationError, TypeError, ValueError):
            return await self.fallback.analyze(session_id, transcript, existing)

        return await self.fallback.analyze(session_id, transcript, existing)


def build_analyzer() -> OpenAICompatibleIntentAnalyzer:
    return OpenAICompatibleIntentAnalyzer(fallback=RuleBasedIntentAnalyzer())
