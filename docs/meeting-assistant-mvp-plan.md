# Meeting Assistant MVP Plan

## Goal

Build a private meeting assistant that observes a Google Meet conversation through live captions, infers likely participant intent from what is said, and feeds those hypotheses back to the user in real time.

The assistant should avoid claiming to know anyone's hidden thoughts. It should present observable, evidence-backed hypotheses such as:

> Alex may be delaying a decision. Evidence: Alex asked for more data after the group appeared ready to decide.

## MVP Principle

Start with the simplest live path:

1. The user joins a Google Meet call in Chrome.
2. The user turns on Google Meet live captions.
3. A Chrome extension reads the captions rendered in the Meet page.
4. The extension streams caption events to a local backend.
5. The backend analyzes recent context and participant history.
6. A private dashboard shows likely intent, confidence, evidence, and suggested user moves.

This avoids a meeting bot, audio capture, speaker diarization, and official Meet transcript dependencies for the first version.

## System Components

### 1. Chrome Extension

Purpose: capture live Google Meet caption text.

Responsibilities:

- Run only on `https://meet.google.com/*`.
- Detect whether captions are visible.
- Watch the caption DOM for new or updated lines.
- Extract speaker name when available.
- Deduplicate partial caption updates.
- Attach timestamps.
- Send transcript events to the local backend over WebSocket or HTTP.
- Show a small local status indicator: connected, captions detected, lines captured.

Initial permissions:

- `activeTab`
- `storage`
- host permission for `https://meet.google.com/*`

Avoid audio permissions in the MVP.

### 2. Local Backend

Purpose: receive transcript events and run intent analysis.

Recommended stack:

- FastAPI
- WebSocket endpoint for live caption events
- REST endpoint for session state and health checks
- SQLite for early local persistence
- Postgres later if multi-user or enterprise deployment is needed

Responsibilities:

- Accept transcript events from the extension.
- Normalize speaker names.
- Store transcript lines with timestamps.
- Maintain rolling meeting context.
- Maintain per-participant state.
- Request structured intent analysis from a local model.
- Broadcast updated insights to the dashboard.

### 3. Local Model Runtime

Purpose: run inference privately on the NVIDIA DGX box.

Recommended first options:

- `vLLM` for a local OpenAI-compatible inference server.
- `Ollama` only if rapid prototyping matters more than deployment control.
- `TensorRT-LLM` later if optimized NVIDIA deployment becomes important.

Model requirements:

- Strong instruction following.
- Reliable JSON output.
- Good conversational reasoning.
- Low enough latency for rolling updates.

The first version can analyze text only. Audio transcription is a later phase.

### 4. Intent Analyzer

Purpose: convert transcript context into structured hypotheses.

Input:

- Last few minutes of transcript.
- Recent statements by each participant.
- Existing participant state.
- Current agenda or goal if the user provided one.

Output JSON shape:

```json
{
  "speaker": "Alex",
  "intent_label": "decision_delay",
  "hypothesis": "Alex may be slowing the decision until implementation risk is clearer.",
  "confidence": 0.68,
  "evidence": [
    "I think we need more data before deciding.",
    "Can we validate the migration cost first?"
  ],
  "suggested_user_move": "Ask Alex what specific data would make them comfortable deciding today.",
  "updated_at": "2026-08-30T18:45:00Z"
}
```

Initial intent labels:

- `seeking_decision`
- `seeking_clarification`
- `raising_risk`
- `resisting_scope`
- `delaying_decision`
- `avoiding_commitment`
- `pushing_ownership`
- `seeking_alignment`
- `indirect_disagreement`
- `escalating_urgency`
- `neutral_or_unclear`

### 5. Private Dashboard

Purpose: show the user live meeting intelligence without disrupting the call.

Recommended stack:

- React or Next.js
- WebSocket client for live updates
- Simple responsive layout

Primary views:

- Live transcript stream.
- Participant list.
- Per-participant intent cards.
- High-confidence alerts.
- Suggested user moves.
- Post-meeting summary.

Card fields:

- Participant name.
- Current likely intent.
- Confidence.
- Evidence quotes.
- Trend: new, increasing, decreasing, unresolved.
- Suggested user move.

## Privacy and Consent Guardrails

The product should be designed as a transparent meeting companion.

MVP guardrails:

- Captions are enabled by the user in Google Meet.
- No audio capture in the MVP.
- No cloud processing by default.
- Data stays on the user's machine or local DGX network.
- Store meetings locally with a clear delete option.
- Label outputs as hypotheses, not facts.
- Keep evidence attached to every inference.

Before broader use, add:

- Consent and disclosure workflow.
- Organization policy controls.
- Retention settings.
- Redaction for sensitive terms.
- Audit logs.

## Development Phases

### Phase 0: Local Simulation Harness

Objective: prove the intent analyzer without needing real meetings.

Steps:

1. Create a small backend service.
2. Add an endpoint that accepts fake transcript events.
3. Build a script that streams sample lines into the backend.
4. Implement the first intent-analysis prompt.
5. Return structured JSON.
6. Display results in a minimal dashboard.

Success criteria:

- The system can process transcript events in order.
- The dashboard updates live.
- Each intent hypothesis includes evidence and confidence.

### Phase 1: Google Meet Caption Capture

Objective: capture live captions from an actual Google Meet tab.

Steps:

1. Create a Chrome Manifest V3 extension.
2. Add a content script for `meet.google.com`.
3. Detect visible caption elements.
4. Use a `MutationObserver` to watch caption updates.
5. Extract speaker and text.
6. Deduplicate repeated partial caption renders.
7. Send finalized utterances to the backend.
8. Add a small extension popup with connection status.

Success criteria:

- User can join a Meet call, turn on captions, and see transcript lines in the dashboard.
- Duplicate caption fragments are mostly suppressed.
- Speaker names are captured when Meet renders them.

### Phase 2: Live Intent Dashboard

Objective: make the feedback useful during a meeting.

Steps:

1. Add participant state tracking.
2. Run intent analysis every few utterances or every fixed interval.
3. Group insights by participant.
4. Show high-confidence changes prominently.
5. Add suggested user moves.
6. Add a post-meeting summary.

Success criteria:

- The dashboard produces useful, evidence-backed hypotheses within 5-15 seconds of relevant conversation.
- Low-confidence or unclear signals are labeled honestly.
- The user can quickly scan the room state during a call.

### Phase 3: DGX Deployment

Objective: run model inference locally on the NVIDIA DGX box.

Steps:

1. Choose a local model.
2. Deploy it behind `vLLM` with an OpenAI-compatible API.
3. Configure the backend to call the local model endpoint.
4. Run latency and throughput tests.
5. Add model timeout and fallback behavior.
6. Add deployment docs for LAN access from the user's laptop.

Success criteria:

- No transcript data leaves the local environment.
- The backend can call the DGX-hosted model reliably.
- Intent updates remain fast enough for live use.

### Phase 4: Hardening

Objective: prepare for real repeated use.

Steps:

1. Add meeting session management.
2. Add local auth for dashboard access.
3. Add meeting deletion and retention controls.
4. Add prompt/version logging.
5. Add tests for caption deduplication and intent JSON validation.
6. Add error states for captions off, backend offline, model unavailable, and malformed model output.

Success criteria:

- The extension and dashboard fail clearly.
- Stored meeting data is manageable.
- Intent outputs remain parseable and auditable.

## Suggested Repository Structure

```text
meeting-observer/
  docs/
    meeting-assistant-mvp-plan.md
  extension/
    manifest.json
    src/
      content.ts
      popup.ts
      background.ts
  server/
    app/
      main.py
      models.py
      transcript.py
      intent_analyzer.py
      sessions.py
    tests/
  dashboard/
    src/
      app/
      components/
      lib/
  scripts/
    stream_sample_meeting.py
```

## First Build Target

Build the local simulation before touching Google Meet.

Initial task list:

1. Scaffold `server/` with FastAPI.
2. Add a transcript event endpoint.
3. Add a fake transcript streamer script.
4. Add an intent analyzer interface.
5. Add a placeholder rule-based analyzer.
6. Add the dashboard live view.
7. Replace the placeholder analyzer with a local LLM call.
8. Add the Chrome extension caption capture.

This gives a working system early and keeps Google Meet DOM fragility isolated to one later component.

## Known Risks

- Google Meet caption DOM can change without notice.
- Captions may omit speaker names in some conditions.
- Live captions may lag or revise text while a participant is speaking.
- Intent inference can be misleading if confidence and evidence are not handled carefully.
- Legal and trust requirements vary by jurisdiction and organization.
- Local DGX deployment reduces cloud privacy risk but does not remove consent obligations.

## Open Decisions

- Which local model to run first on the DGX.
- Whether the dashboard should run on the user's laptop or the DGX.
- Whether the extension streams over WebSocket directly to the DGX or to a local laptop proxy.
- How explicit the product should be about participant notification and consent.
- Whether meeting data should persist by default or be ephemeral by default.
