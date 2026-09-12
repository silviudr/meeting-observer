# Owner Identity and Salience Plan

Numbered tasks. Backend and its tests land before client work so the snapshot
contract is fixed before either client consumes it.

1. Add `SalienceCue`, `SalienceKind` and `ParticipantState.is_owner` to
   `server/app/models.py`; extend `SessionSnapshot` with `owner_speaker`,
   `owner_matched` and `cues`. Add an `OwnerIn` request model.

2. Create `server/app/salience.py` holding the cue text catalog, cluster
   definitions, owner-name matching, question detection, threshold config and a
   pure `compute_cues` function. Keep it free of I/O so it is directly testable.

3. Extend `MeetingSession` in `server/app/sessions.py` with `owner_speaker`,
   monotonic per-speaker last-seen times, previous intent labels, and the
   current cue list. Record last-seen on `add_event`; record previous labels in
   `update_insights` before insights are replaced.

4. Recompute cues inside the store lock on `add_event` and `update_insights`,
   and expose `set_owner`. Clear all new state on `end`, exactly as transcript,
   insights and participants are cleared.

5. Add `POST /api/sessions/{id}/owner` to `server/app/main.py` and accept an
   optional owner body on session creation. Both go through the existing
   `active()` check so ended and unknown sessions behave as they do elsewhere.

6. Write `server/tests/test_salience.py` covering each cue's trigger and
   non-trigger, owner matching including `You`, question detection limits,
   cluster movement versus in-cluster movement, and the empty-cue case. Extend
   `server/tests/test_sessions.py` for owner lifecycle and cue clearing on end.

7. Extend `extension/core.js` settings validation and defaults with
   `ownerSpeaker`, send it on session start, and add the popup field in
   `extension/popup.html` and `extension/popup.js`.

8. Add the dashboard glance area, cue list, owner control and owner match state
   in `dashboard/index.html`, `dashboard/static/app.js` and
   `dashboard/static/styles.css`.

9. Extend `tests/extension.test.mjs` and `tests/dashboard.test.mjs` for the
   owner setting and cue rendering, including the no-cue state.

10. Record actual evidence in `validation.md`, run both suites, and update
    `README.md` and `docs/local-runbook.md` for the new setting and endpoint.

## Risks

- Question detection over captions is a heuristic and will both miss and
  over-fire. It is presented as an observation about text, never as certainty.
- Silence timing uses the store's monotonic clock, so it measures wall time
  since the last caption from that speaker, not true speaking time.
- Cue recomputation runs under the session lock on every accepted event. It must
  stay O(recent events) so ingestion acknowledgement is not delayed.
