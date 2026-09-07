---
name: feature-validation
description: Validate a Meeting Observer feature against its acceptance criteria and report reproducible evidence, defects and unverified hardware or browser checks.
---

# Feature Validation

Read the selected feature's `requirements.md`, `plan.md` and `validation.md`, then
relevant constraints in `specs/mission.md` and `specs/tech-stack.md`. Resolve paths
from the repository root. Inspect changed code and existing tests before choosing
checks; preserve worker ownership and user edits.

Map each acceptance criterion to evidence. Run focused existing tests first;
broaden coverage for shared lifecycle or client contracts. The backend command is
`PYTHONPATH=server .venv/bin/python -m pytest server/tests`. Inspect `tests/` and
the feature validation record for current client/browser commands. Do not fabricate
commands for tools absent from the project.

For the personal MVP, cover unknown/ended sessions, stable retry IDs, asynchronous
coalescing, cancellation, expiry, auth, client clearing and absence of durable
meeting content. Use synthetic events through `scripts/stream_sample_meeting.py`;
keep response bodies, tokens, transcript and insights out of retained artifacts.
Run privacy/lifecycle checks in a temporary working directory when they might
create artifacts; do not delete or inspect legacy meeting databases.

Use `docs/meeting-analysis-evaluation.md` for model checks and
`docs/google-meet-live-test.md` for manual acceptance. Distinguish deterministic
transport checks, a live vLLM evaluation, and actual caption-to-display timing.
Local fixtures cannot establish GX10 compatibility or real Meet DOM behavior.

Record commands, environment, sample counts, outcomes and limitations in the
feature's `validation.md` when authorized to edit it; otherwise return that
evidence to its owner. Mark unavailable checks unverified with a concrete reason.
Report defects by severity and file reference; close acceptance only when its
required evidence exists. Do not infer permission to start remote services or
download model weights from a validation request.
