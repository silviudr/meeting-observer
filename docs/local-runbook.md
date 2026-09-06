# Local Runbook

## Backend

Use the corrected ASGI entrypoint:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r server/requirements.txt
uvicorn app.asgi:app --app-dir server --reload --host 0.0.0.0 --port 8010
```

Dashboard:

```text
http://localhost:8010
```

Health:

```text
http://localhost:8010/health
```

## Simulation

```bash
python scripts/stream_sample_meeting.py --session demo --base-url http://localhost:8010
```

## Tests

```bash
PYTHONPATH=server pytest server/tests
```

## Chrome Extension

1. Start the backend.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Load unpacked extension from `extension/`.
5. Join a Google Meet call.
6. Turn on live captions.
7. Open the extension popup.
8. Set backend URL to `http://localhost:8010` or the DGX backend URL.
9. Set the session ID to match the dashboard.
