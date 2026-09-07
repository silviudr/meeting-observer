# Validation

Status: automated local checks passed; live GX10 and Google Meet checks pending.

## Automated Acceptance

Run on 2026-09-07 from the repository root.

- `cd server && ../.venv/bin/python -m pytest tests`
  - Result: 109 passed.
- `node --test tests/*.test.mjs`
  - Result: 2 browser-side suites passed.
- In-process FastAPI smoke using `httpx.ASGITransport`
  - Result: `/health` returned rules mode, explicit session create succeeded,
    one synthetic caption was accepted, snapshot returned one rules insight,
    delete cleared the session, and subsequent GET returned 410.
- Host-visible uvicorn plus `python3 scripts/stream_sample_meeting.py --session browser-test --delay 0.05`
  - Result: backend reported rules mode, the sample script created the session,
    accepted 8 synthetic events without duplicates, and the snapshot contained
    8 transcript rows, 4 participants, 4 rules-mode coaching insights and
    `analysis_status: ready`.

- vLLM request disables thinking and bounds output/context; accepted evidence is
  resolved from event IDs and correct speakers. Malformed responses, timeouts,
  unsupported evidence and residual reasoning fail honestly without rule fallback.
- Session content does not survive end, expiry, or backend restart and produces
  no database file. Unknown/ended sessions reject late work. Identical retries
  deduplicate while legitimate repeated speech remains possible.
- Slow model inference does not delay event acknowledgment; overlapping events
  coalesce and cancelled work never restores a deleted session.
- All clients can authenticate; unauthorized HTTP/WS requests are rejected.
- Caption fixtures preserve multiline speaker attribution, stabilize partials,
  retry transient failures and clear pending data on session changes/end.
- Dashboard session switches, reconnect, end, errors and coaching are exercised
  with synthetic events at desktop and mobile widths.

Socket-level curl smoke against a sandbox-started uvicorn process could not
connect from a separate sandbox command. A host-visible uvicorn process was then
started and verified on `127.0.0.1:8010`.

## Hardware Acceptance (Requires GX10)

Record vLLM/model versions, quantization, memory and runtime settings. Verify no
reasoning is generated, structured output and coaching quality on sample cases,
then measure finalized-caption-to-insight median and p95 latency. Candidate goals:
median <=5 seconds and p95 <=10 seconds in warm operation. Also report raw inference
latency separately. Local mock tests do not establish these hardware results.

## Manual Acceptance

Controlled Google Meet test verifies the live DOM, speaker names, capture pause,
disconnect recovery, end-session cleanup and useful English coaching. Real Meet
validation cannot be replaced by DOM fixtures alone.
