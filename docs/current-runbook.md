# Current Runbook

Use this runbook for the current full MVP entrypoint.

## Start Backend

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r server/requirements.txt
uvicorn app.complete:app --app-dir server --reload --host 0.0.0.0 --port 8010
```

## Optional Local Token

```bash
export MEETING_OBSERVER_ACCESS_TOKEN=change-me
```

When this is set, API and WebSocket clients need to provide the token. For early local testing, leave it unset.

## Dashboard

```text
http://localhost:8010
```

## Simulated Meeting

```bash
python scripts/stream_sample_meeting.py --session demo --base-url http://localhost:8010
```

## Google Meet

1. Load `extension/` as an unpacked Chrome extension.
2. Start the backend.
3. Join Google Meet.
4. Turn on live captions.
5. Set the extension backend URL to `http://localhost:8010`.
6. Use the same session ID in the extension and dashboard.

## DGX

```bash
export MEETING_OBSERVER_LLM_BASE_URL=http://dgx-host:8000/v1
export MEETING_OBSERVER_LLM_MODEL=local-intent-model
export MEETING_OBSERVER_LLM_API_KEY=local
uvicorn app.complete:app --app-dir server --host 0.0.0.0 --port 8010
```
