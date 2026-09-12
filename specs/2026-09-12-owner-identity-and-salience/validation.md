# Validation

Status: automated local checks passed and a synthetic end-to-end run confirmed
the feature through the real application. Controlled Google Meet validation of
owner-name matching against live caption labels is pending.

## Automated Acceptance

Run on 2026-09-12 from the repository root.

- `cd server && ../.venv/bin/python -m pytest tests`
  - Result: 141 passed, up from 104. 25 new in `tests/test_salience.py`, 7 new
    in `tests/test_sessions.py`, 5 new in `tests/test_owner_api.py`.
- `node --test tests/*.test.mjs`
  - Result: 46 passed, up from 37. 2 new extension tests, 7 new dashboard tests.

Two pre-existing extension assertions were updated because `validateSettings`
now returns `ownerSpeaker`. No assertion was weakened; both still compare the
full settings object.

## What the Automated Checks Cover

- Owner matching is exact after case folding and whitespace normalisation.
  `Maria Lopez` does not match `Maria` or `Mario Lopez`. Meet's `You` label
  resolves to the owner only once a name is set.
- Owner state can be declared before any caption arrives, applied to speakers
  already captured, changed mid-session, and cleared.
- An unmatched owner name reports as unmatched. The dashboard renders "Waiting
  to hear ... in captions" rather than appearing to track someone.
- Each cue triggers on its condition and stays silent otherwise: an answered
  question produces no cue, a held `raising_risk` label does not resurface, and
  movement inside one label cluster is not a position change.
- The owner's own question is never an unanswered question, and the owner is
  never reported as a silent participant.
- Cues are ordered by priority and capped. Cue text is asserted to equal the
  application catalog template, so model output cannot reach the glance area.
- Airtime requires a full window; a nine-turn meeting does not fire it.
- Owner and cue state clear on session end alongside transcript and insights.
- The owner endpoint returns 404 for unknown sessions, 410 for ended sessions
  and 401 without the access token when one is configured.
- Session creation without a body still behaves exactly as before.
- The dashboard clears the glance area on session end and disables the owner
  control when no session is active. Reconnects do not resend the owner name.

## End-to-End Evidence

Host-visible uvicorn on `127.0.0.1:8011` in rules mode, then
`scripts/stream_sample_meeting.py --session live --delay 0.05`:

- Session created with `owner_speaker: Maria` before any caption; the snapshot
  correctly reported `owner_matched: false` and no cues.
- After 8 synthetic captions the snapshot reported `owner_matched: true`, marked
  exactly one participant of four as the owner, and produced one cue:
  `unanswered_question` naming Priya at priority 100.
- That is the correct result for the fixture. Priya's ownership question is the
  last question asked, and the owner does not speak after it. No other cue
  crossed a threshold, which is the intended quiet behaviour.

## Not Verified

- Real Google Meet caption speaker labels. Whether Meet renders the owner as
  `You`, as a display name, or as both in the same session is assumed from
  documentation and not confirmed against a live call. This is the main risk in
  the feature and needs the controlled Meet procedure.
- Threshold suitability. Five minutes of silence, a ten-turn airtime window and
  a 60% owner share are chosen defaults, not measured ones. Real meetings should
  decide whether they fire too often or too rarely.
- Question detection recall against live captions. The heuristic is deliberately
  conservative and will miss questions that captions render without punctuation
  or a clear interrogative opening.
- Cue behaviour with vLLM analysis rather than rules-mode labels. Cue computation
  reads validated `IntentLabel` values and does not depend on which analyzer
  produced them, but this has not been observed against the GX10.
