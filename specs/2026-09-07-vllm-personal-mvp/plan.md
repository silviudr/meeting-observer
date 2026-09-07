# Implementation Plan

1. Coordinator: finalize constitution, shared API models, and these task contracts.
2. Analyzer worker: vLLM non-thinking requests, grounded structured insights,
   bounded output, honest failures, deterministic transport-based tests.
   Own `server/app/intent_analyzer.py`, `server/tests/test_intent_analyzer.py`.
3. Dashboard worker: explicit session lifecycle, coaching, auth, correct reconnect,
   ephemeral content, failure states, responsive checks.
   Own `dashboard/` and dashboard-specific tests under `tests/`.
4. Extension worker: speaker/partial-caption parser, bounded retry queue, session
   heartbeat and end handling, minimal permissions, settings/token integration.
   Own `extension/` and extension-specific tests under `tests/`.
5. Coordinator: in-memory store, asynchronous analysis scheduling, canonical API,
   session expiry, secure client contracts, API/lifecycle regression tests.
6. Documentation worker: runtime setup, simulation/evaluation helpers and reusable
   project skills using the finalized contracts. Coordinator integrates all work.
7. Coordinator: run unit/integration/browser checks, review changed files, record
   evidence in validation.md, start a local server for owner review.

Workers receive this feature directory, the constitution, their owned files and
the shared models. They do not need the full conversation. No worker commits or
edits another worker's files. API changes are coordinated before implementation.
