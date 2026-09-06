from __future__ import annotations

import pytest

from app.intent_analyzer import RuleBasedIntentAnalyzer
from app.models import TranscriptEvent


@pytest.mark.asyncio
async def test_rule_analyzer_detects_delay() -> None:
    analyzer = RuleBasedIntentAnalyzer()
    transcript = [
        TranscriptEvent(
            speaker="Dan",
            text="I think we need more data before deciding.",
            source="test",
        )
    ]

    insights = await analyzer.analyze("test", transcript, {})

    assert insights[0].speaker == "Dan"
    assert insights[0].intent_label == "delaying_decision"
    assert insights[0].evidence


@pytest.mark.asyncio
async def test_rule_analyzer_detects_risk() -> None:
    analyzer = RuleBasedIntentAnalyzer()
    transcript = [
        TranscriptEvent(
            speaker="Priya",
            text="My concern is compliance risk if the review slips.",
            source="test",
        )
    ]

    insights = await analyzer.analyze("test", transcript, {})

    assert insights[0].speaker == "Priya"
    assert insights[0].intent_label == "raising_risk"
    assert insights[0].confidence > 0.7
