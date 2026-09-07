# Privacy and Session Boundaries

Meeting Observer processes the owner's Google Meet English captions in Chrome.
The extension reads rendered text, not audio. FastAPI and the dashboard run on the
local computer; inference runs on the private GX10. This boundary describes this
application, not Google Meet's own caption processing.

Transcript and insight content stays in process/browser memory for the active
session. Explicit end, inactivity expiry and backend restart clear application
state. End cancels analysis and rejects late work; an ended ID cannot reopen in
the same process. The default inactivity period is five minutes, renewed only by
capture events and heartbeat. Dashboard viewing does not extend retention.

Do not persist content in SQLite, browser storage, logs, telemetry, traces,
evaluation reports or inference prompt/response caches. Model weights and app
settings are separate from meeting content. Tokens stay in memory or Chrome
session storage. Disable URL access logs because WebSocket URLs carry tokens.
Verify runtime/proxy logging and caches before real use. Session cleanup is not
a guarantee of forensic erasure from RAM, GPU memory or operating-system swap.

Existing prototype SQLite files may contain older data. The new app must not use
them; do not silently migrate, inspect or delete their content. Their handling is
an explicit owner decision. There is no meeting archive, export or retention
volume in this version.

Outputs are evidence-backed hypotheses about observable speech, not knowledge of
private thoughts. Evidence must resolve to captured events from the named speaker.
Confidence is uncalibrated. Coaching prompts remain under the owner's control;
the app never speaks or sends a response for them. Insufficient evidence and model
failure must remain visible and distinct.

Use synthetic fixtures for repeatable checks and keep reports to case identifiers,
counts, settings, failure categories and timing. For controlled real-world checks,
agree on disclosure with participants and follow the meeting's applicable policies.
No transcript or insight content should enter support/debug artifacts.
