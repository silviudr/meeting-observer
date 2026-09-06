# Google Meet Live Test

## Objective

Validate that the Chrome extension can capture live captions from a Google Meet tab and stream them to the local backend.

## Setup

1. Start the backend with `uvicorn app.asgi:app --app-dir server --reload --host 0.0.0.0 --port 8010`.
2. Open the dashboard at `http://localhost:8010`.
3. Load the unpacked Chrome extension from `extension/`.
4. Join a Google Meet call.
5. Turn on live captions in the Meet controls.
6. Open the extension popup and confirm:
   - Backend URL: `http://localhost:8010`
   - Session ID: `demo`
   - Capture captions: enabled

## Expected Result

- The Meet page shows a small Meeting Observer status indicator.
- Caption lines appear in the dashboard transcript panel.
- Participant intent hypotheses appear after enough lines arrive.
- Duplicate partial captions are mostly suppressed.

## Troubleshooting

Captions do not appear:

- Confirm Meet live captions are turned on.
- Confirm the extension is enabled.
- Reload the Meet tab after loading the extension.
- Check that the backend URL in the popup is reachable.

Speaker names are missing:

- Google Meet may not render speaker names in every caption state.
- The extension will use `Unknown` when a speaker cannot be extracted.

Too many duplicates appear:

- Increase `STABLE_UTTERANCE_MS` in `extension/content.js`.
- Keep backend deduplication enabled.

No dashboard updates:

- Open `/health`.
- Confirm the dashboard session matches the extension session.
- Confirm the backend accepts `POST /api/sessions/{session_id}/events`.
