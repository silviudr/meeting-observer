# Controlled Google Meet Check

Status: manual acceptance pending. DOM fixtures do not prove compatibility with
the current live Meet page. Use a controlled meeting with synthetic statements
and participants aware of the test; do not save real meeting content in reports.

1. Follow the [local runbook](local-runbook.md). Open <http://localhost:8010>.
2. Load `extension/` through Chrome's `chrome://extensions` developer mode and
   reload the Meet tab after loading or updating the extension.
3. Choose a fresh session ID, explicitly start it, and select the same ID in
   dashboard and extension. Set backend URL `http://localhost:8010` and the same
   access token in both clients when auth is enabled.
4. Join Google Meet, enable English captions, then enable extension capture.
   Read synthetic lines from `scripts/stream_sample_meeting.py` aloud.
   If you are testing alone, use the
   [single-participant script](single-participant-browser-test.md) instead.
5. Keep the Meet tab visible while testing capture. A background or hidden Meet
   tab may throttle timers or stop rendering caption DOM updates; use a separate
   visible window for the dashboard if you need to watch both.
6. Check speaker attribution, multiline captions and partial revisions. A final
   utterance should arrive once; later legitimate repetition must remain possible.
7. Pause/resume capture and briefly interrupt the backend connection. Check bounded
   retry, stable event IDs, capture status and recovery without duplicate lines.
8. Switch sessions and confirm content and pending queues clear. End a session
   during analysis; confirm transcript/insights clear and late work cannot restore
   them. Reusing the ended ID must return 410.
9. Leave an active session without capture events/heartbeat for the configured
   inactivity period (default five minutes). Dashboard viewing must not keep it
   alive. Verify expiry cleanup, then restart the backend and verify no old content.

Inspect evidence quotes and speaker references for each hypothesis. Suggestions
should be concise coaching prompts; confidence must not imply calibrated certainty.
In rules mode validate delivery only. With configured vLLM, interrupt model access
and verify visible `unavailable` state without rules masquerading as model output.

Record browser/version, fixture identifiers, pass/fail, defects and timing metadata
in the feature validation record through its owner. Measure finalized-caption to
displayed-insight latency across warm samples separately from evaluator request
latency. Do not retain screenshots, traces or logs containing real content/tokens.

If captions are missing, check Meet captions, capture state, explicit session start,
token, backend reachability and selected ID. Unknown speakers should remain
`Unknown`; do not invent attribution. Diagnose duplicate handling against fixtures
before changing timing constants.
