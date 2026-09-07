# Local Runbook

Run commands from the repository root. The app runs on the local computer;
only inference runs on the private GX10.

## Startup

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r server/requirements.txt
uvicorn app.main:app --app-dir server --host 127.0.0.1 --port 8010 --no-access-log
```

Dashboard: <http://localhost:8010>. Health: <http://localhost:8010/health>.
Health reports configuration, not a successful model inference. No endpoint means
`rules` demo mode. Configured vLLM failures must show `unavailable`, without silent
rule fallback. Valid empty insights mean insufficient evidence. See
[GX10 setup](dgx-deployment.md) for model configuration before starting the app.

Use a single worker: sessions exist in process memory. A restart or development
reload clears active content. No database or retention-volume configuration is
needed. Leave legacy SQLite files untouched; the owner decides their disposition.

## Authentication

Optionally set `MEETING_OBSERVER_ACCESS_TOKEN` in the backend shell before startup
and in the simulation shell. Enter that same value in dashboard and extension
token controls. Keep tokens out of URLs pasted into reports and command output.

HTTP clients send `Authorization: Bearer <token>`; `X-Meeting-Observer-Token`
is also supported. WebSocket clients use the existing `?token=...` convention;
disable access logging as above and do not retain proxy URL logs. Application
and inference credentials are separate: `MEETING_OBSERVER_LLM_API_KEY` authenticates
to vLLM. Tokens belong only in memory or Chrome session storage.

## Synthetic Session

```bash
python3 scripts/stream_sample_meeting.py
python3 scripts/stream_sample_meeting.py --session demo --delay 1.2
```

Each command creates its session explicitly. The first chooses a unique ID and
prints it; select that ID in the dashboard. The second uses `demo` for coordinated
manual checks. Each run has unique event identities, stable across its retries.
The script leaves the session active for inspection; add `--end` to clear it at
completion. It prints counts/status only, never captions, insights or response bodies.

## Lifecycle Contract

IDs contain 1-80 ASCII letters, digits, underscores or hyphens.

| Request | Behavior |
| --- | --- |
| `POST /api/sessions/{id}` | Create explicitly; existing active ID is idempotent; ended ID is 410 |
| `GET /api/sessions/{id}` | Snapshot only; unknown 404, ended 410 |
| `POST /api/sessions/{id}/events` | Active session required; stable `client_event_id` deduplicates retries |
| `POST /api/sessions/{id}/heartbeat` | Renew capture activity; unknown 404, ended 410 |
| `DELETE /api/sessions/{id}` | End, clear content and cancel analysis; returns `deleted` boolean |

Ended IDs cannot reopen during the process lifetime. Events and capture heartbeats
renew activity; dashboard viewing does not. Default inactivity expiry is five
minutes. Event acceptance is asynchronous: inspect `analysis_status` (`idle`,
`pending`, `ready`, `unavailable`) in snapshots rather than expecting immediate
insights in an ingestion response. `analysis_mode` distinguishes `vllm` and `rules`.

Dashboard WebSocket `/ws/dashboard/{id}` sends an empty `status: ended` snapshot
then closes 4001 on end; unknown sessions close 4004 and unauthorized clients 1008.
Clear local content and pending events on end or session switch. Pause/disconnect
does not itself end a session; inactivity expiry still applies.

## Checks and Recovery

```bash
PYTHONPATH=server .venv/bin/python -m pytest server/tests
```

For client checks use the commands recorded in the active feature's
[validation](../specs/2026-09-07-vllm-personal-mvp/validation.md).
401/403: check the client token. 404: explicitly create the session. 410: choose a
new ID. `unavailable`: verify the private model endpoint and settings; do not
interpret rules as vLLM recovery. A rules-mode smoke test does not establish
hardware latency or real Meet capture. Continue with the
[controlled Meet check](google-meet-live-test.md).
