# Single-Participant Browser Test Script

Use this when you are alone in Google Meet and want to test the real browser
extension path. It validates capture, backend ingestion, vLLM analysis, dashboard
updates and session cleanup. It does not validate multi-speaker attribution.

## Setup

Open Google Meet, join alone, turn captions on, then start Meeting Observer
capture from the extension popup. Keep the Meet tab visible. Open the dashboard
in a second visible window with the same session ID.

Read one line at a time with a two to four second pause between lines. Speak
naturally; do not read the speaker names from the synthetic sample script.

## Script

1. I want to make a decision today about whether we can move forward with the
   first usable version.
2. My concern is that we may not have enough evidence from the live browser test
   yet.
3. I think we should verify caption capture, dashboard refresh and model latency
   before deciding.
4. The important question is what would count as enough evidence for this test.
5. I want to keep the scope small and avoid adding new features until the basic
   meeting flow works.
6. If the dashboard updates within a few seconds and the evidence matches what I
   said, I can support moving forward.
7. The next step should be clear: either accept the flow for personal testing or
   record the specific defect we need to fix.
8. To summarize, I am trying to decide whether this is reliable enough for my own
   meetings, not whether it is ready for other users.

## What To Check

- Lines appear in the dashboard under one participant.
- The coaching panel shows `vLLM`, `Analysis ready`, and one grounded insight.
- The cited evidence is text you actually read.
- The coaching prompt is useful in the moment.
- Ending the session clears transcript and coaching content.

If no coaching appears, check whether the dashboard says `Analysis unavailable`.
That usually means the vLLM endpoint is not reachable or still starting. If no
new transcript lines appear, keep the Meet tab visible and confirm captions are
enabled.
