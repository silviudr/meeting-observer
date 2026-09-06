# Meeting Observer

Private meeting assistant MVP for Google Meet live captions.

The first implementation is intentionally simple:

- A Chrome extension observes Google Meet live captions.
- A FastAPI backend receives transcript events.
- A local analyzer infers evidence-backed intent hypotheses.
- A static dashboard shows transcript, participants, and suggestions in real time.
- Optional local DGX inference is supported through an OpenAI-compatible endpoint such as `vLLM`.

## Quick Start

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r server/requirements.txt
uvicorn app.main:app --app-dir server --reload --host 0.0.0.0 --port 8010
```

Open the dashboard:

```text
http://localhost:8010
```

Stream a fake meeting into the backend:

```bash
python scripts/stream_sample_meeting.py --session demo --base-url http://localhost:8010
```

## Google Meet Extension

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable Developer mode.
4. Select Load unpacked.
5. Choose the `extension/` directory.
6. Join a Google Meet call.
7. Turn on live captions in Meet.
8. Open the extension popup and confirm the backend URL and session ID.

The extension reads captions rendered in the Meet tab. It does not capture audio.

## Local LLM / DGX

The backend uses a rule-based analyzer by default. To use a DGX-hosted OpenAI-compatible model:

```bash
export MEETING_OBSERVER_LLM_BASE_URL=http://dgx-host:8000/v1
export MEETING_OBSERVER_LLM_MODEL=local-intent-model
export MEETING_OBSERVER_LLM_API_KEY=local
```

Then start the backend normally. See [docs/dgx-deployment.md](docs/dgx-deployment.md).

## Project Layout

```text
docs/       Planning and deployment notes
extension/  Chrome Manifest V3 extension
server/     FastAPI backend and analyzer
dashboard/  Static dashboard served by the backend
scripts/    Local simulation tools
```

## Safety Framing

Intent outputs are hypotheses, not facts. Each hypothesis should include confidence and evidence from the transcript.
