# Personal vLLM MVP Requirements

Build the existing Google Meet/Chrome caption workflow into a session-only personal
coaching application. vLLM on the ASUS GX10 is the preferred inference runtime;
start with nvidia/Qwen3.6-35B-A3B-NVFP4 and explicitly disable thinking per request.
Use synthetic input for repeatable development and test runs.

## Decisions and Working Defaults

- Preserve FastAPI and the static dashboard. Use one canonical app entrypoint.
- Retain meeting content only in process/browser memory. No SQLite meeting writes.
- Provide explicit session creation and end. Ended IDs cannot be reopened during
  the process lifetime; late requests never create sessions implicitly.
- Default to five minutes of inactivity before expiry, configurable. Only capture
  events and capture heartbeat renew activity, not dashboard viewing.
- English Google Meet captions and the current dashboard are working assumptions
  pending the owner's clarification. No audio or automatic replies.
- Return concise coaching prompts with exact evidence and speaker attribution.
- No silent rule fallback when configured vLLM fails. Demo mode without a model
  is explicitly labeled rules. Empty valid analysis means insufficient evidence.
- Ingestion acknowledges promptly; one coalescing analysis task per session keeps
  requests bounded. End/expiry cancels analysis and clears clients.
- Token auth is optional for loopback use and supported by every client when set.
- No remote deployment or performance claim until the GX10 connection is available
  and the actual model has been tested. Do not delete existing SQLite files.

## Shared API Contract

Session IDs use 1-80 ASCII letters, digits, underscores or hyphens.

- POST `/api/sessions/{id}`: explicitly start, or return an already active session;
  return 410 for an ended ID. Response is a session snapshot.
- GET `/api/sessions/{id}`: snapshot, 404 unknown, 410 ended; never creates.
- DELETE `/api/sessions/{id}`: end and clear, returns `{deleted: boolean}`.
- POST `/api/sessions/{id}/heartbeat`: renew active capture session; 404/410 otherwise.
- POST `/api/sessions/{id}/events`: existing event fields plus optional
  `client_event_id` stable across retries. Accept only active sessions. Response
  retains `accepted`, `duplicate`, `event`, `insights`; analysis is asynchronous.
- WS `/ws/dashboard/{id}`: JSON snapshots; terminal empty snapshot has
  `status: "ended"` then socket closes with code 4001. Missing session closes 4004;
  unauthorized closes 1008. WS ingest remains supported.
- HTTP auth: `Authorization: Bearer ...` or `X-Meeting-Observer-Token`.
  WebSocket auth: existing `?token=...` convention; no access logging of URLs.
- Snapshot adds `status` active/ended, `revision`, `analysis_mode` vllm/rules,
  `analysis_status` idle/pending/ready/unavailable, `analysis_detail` nullable.
- Insights keep existing fields and add `evidence_event_ids` and `analysis_mode`.
  Confidence is uncalibrated; do not display it as a probability.

Browser clients retain no transcript or insight content in persistent storage.
Access tokens stay in memory or Chrome session storage. Session selection and
backend location are settings; session data must clear on end and session switch.
