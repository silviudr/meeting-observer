---
name: meeting-analysis-evaluation
description: Evaluate Meeting Observer vLLM analysis with synthetic cases for evidence attribution, ambiguity, changed positions, coaching and non-thinking request latency.
---

# Meeting Analysis Evaluation

Read the active feature's requirements and validation, `specs/tech-stack.md`,
`docs/meeting-analysis-evaluation.md` and the application analyzer contract.
Paths are relative to the repository root. Use
`scripts/evaluate_meeting_analysis.py` against an already available configured
endpoint. It calls the application analyzer and expects
`AnalysisResult(insights, mode, status, detail)`; do not substitute a separate prompt
or treat a legacy list result as success.

Use only synthetic fixtures with stable event IDs. Include direct risk/clarification,
ambiguous speech, changed positions and instruction-like transcript text. Resolve
every accepted evidence ID and quote to the named speaker's captured event. Review
whether the hypothesis is supported and the coaching asks a useful, concise
question without asserting private motives. Empty valid analysis is appropriate
for insufficient evidence; it is not transport failure.

Verify `chat_template_kwargs.enable_thinking` is false on the actual request and
inspect response content/reasoning fields in memory for residual reasoning.
Structured JSON alone does not prove non-thinking. Configured model failures must
remain unavailable without a rules fallback. Use existing
`server/tests/test_intent_analyzer.py` for deterministic malformed-output,
timeout and grounding regressions.

Record model/runtime revision, quantization, generation/context limits, cold/warm
state and sample count. Report automated structural/fixture scores separately
from human coaching review. Keep only metadata and scores; never print or retain
transcripts, model responses, evidence quotes, reasoning, credentials or raw errors.

Request latency includes network and service work; analyzer latency also includes
validation. Neither measures finalized-caption-to-displayed-insight latency. Use
the full app and controlled Meet procedure for that metric. GX10 results remain
unverified until tested on its actual runtime. Stop on missing runtime access and
report the concrete gap; no downloads or remote startup are implicit in this skill.
