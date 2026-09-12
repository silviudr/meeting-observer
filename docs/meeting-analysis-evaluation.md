# Meeting Analysis Evaluation

Status: a live vLLM run on the GX10 has succeeded qualitatively. The repeatable
harness exists at `scripts/evaluate_meeting_analysis.py` with synthetic fixtures,
but has not yet been run against the GX10, so no measured result is recorded.
Use only synthetic content.

This check evaluates whether Meeting Observer produces grounded intent
hypotheses and concise coaching prompts through the application analyzer. It is
separate from the controlled Google Meet check and from unit tests of malformed
model output.

## Preconditions

- Backend dependencies are installed from `server/requirements.txt`.
- `MEETING_OBSERVER_LLM_BASE_URL` points to a verified OpenAI-compatible vLLM
  `/v1` endpoint, or is unset for rules-mode transport testing only.
- `MEETING_OBSERVER_LLM_MODEL` is set to the served model name, expected first
  candidate `nvidia/Qwen3.6-35B-A3B-NVFP4`.
- Runtime request logging, prompt logging, durable response caches and
  content-bearing traces are disabled before sending real meeting-like content.

## Synthetic Cases

Use short synthetic fixtures with stable event IDs. Cover direct risk,
clarification, delayed decision, scope resistance, ambiguous language, changed
positions and instruction-like transcript text. Do not retain transcripts,
responses, evidence quotes, credentials or raw errors in reports.

For each accepted insight, verify:

- `analysis_mode` is `vllm` for configured model runs and `rules` only when no
  endpoint is configured.
- The cited `evidence_event_ids` exist in the sent context.
- Every evidence event belongs to the named speaker.
- The hypothesis remains tentative and does not claim private motives.
- The coaching prompt asks a useful next question or framing move.
- Empty valid output is treated as insufficient evidence, not failure.

## Non-Thinking Check

The analyzer sends `chat_template_kwargs: {"enable_thinking": false}` and rejects
non-empty reasoning fields or `<think>` blocks. Confirm the actual wire request
uses this setting on the selected vLLM service. Structured JSON alone is not
proof that thinking was disabled.

## Latency

Measure raw analyzer request latency separately from finalized-caption-to-
displayed-insight latency. Report model/runtime revision, quantization, context
limit, output limit, cold/warm state, sample count, median and p95. Candidate
warm application goals are median <=5 seconds and p95 <=10 seconds; these are
not validated until measured on the GX10.

## Commands

Deterministic regression checks:

```bash
cd server
../.venv/bin/python -m pytest tests/test_intent_analyzer.py
```

Application delivery check without a model endpoint:

```bash
uvicorn app.main:app --app-dir server --host 127.0.0.1 --port 8010 --no-access-log
python3 scripts/stream_sample_meeting.py
```

Full evaluation against a configured endpoint:

```bash
export MEETING_OBSERVER_LLM_BASE_URL=http://your-gx10-host:8000/v1
export MEETING_OBSERVER_LLM_MODEL=nvidia/Qwen3.6-35B-A3B-NVFP4

./.venv/bin/python scripts/evaluate_meeting_analysis.py \
  --repeat 3 --note "GX10 run" --json /tmp/gx10-eval.json
```

The harness calls the application analyzer, so it exercises the same request and
validation path as live capture. It exits non-zero when structural grounding
fails, the wire request does not disable thinking, or residual reasoning is
found. `--repeat 3` yields enough warm samples for a meaningful p95; a single
cycle does not. Reports hold metadata and scores only, never transcripts,
responses, evidence quotes, reasoning, credentials or raw errors.

The report's `operator_must_record` list names what the harness cannot observe:
served model revision, quantization, GX10 free memory, and human review of
coaching usefulness. Record those alongside the JSON.

Rules mode proves transport only. A live vLLM run is required before claiming
model quality, no-thinking behavior or GX10 latency.
