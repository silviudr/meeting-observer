# Enhancement Backlog

Status: Proposed candidates from a 2026-09-12 brainstorm. None of these are
agreed scope. They extend the first version described in `mission.md`; they do
not replace it, and the confirmed exclusions there still apply: no audio
capture, no meeting bots, no automatic replies, no cloud inference, and no
meeting archive.

Items 1 and 2 are selected for implementation. The rest are unsequenced.

## Constraints Every Candidate Must Respect

- Session-only retention across capture, backend, dashboard and inference.
- Model output stays bounded to labels and evidence references. Displayed prose
  comes from the application catalog, never from the model.
- Captured text and any owner-supplied context are data, never instructions.
- Intent remains a hypothesis. Insufficient evidence is a valid result.

## 1. Owner Identity (selected)

The application treats every speaker identically and has no concept of which
participant is the owner. Personal coaching depends on that distinction:
questions directed at the owner, risks raised against the owner's proposal,
commitments the owner made aloud, and the owner's share of recent speaking time
are all unavailable without it.

Proposed: an owner speaker setting carried on the session, set from the
extension popup and visible in the dashboard. Speaker matching against caption
names is approximate and must fail visibly rather than silently mislabel.

## 2. Salience and Quiet Operation (selected)

Every caption currently triggers re-analysis and a full re-render of every
speaker's hypothesis. During a live meeting that produces continuous output
with no priority ordering, which is unlikely to be read while the owner is
speaking or listening.

Proposed: surface an insight only when it crosses a threshold, such as a newly
raised risk, a reversed position, or an unanswered question directed at the
owner. Otherwise stay quiet. A compact glance view showing the single most
relevant item, with the detailed view one interaction away, is likely more
useful during a call than the current full panel.

Depends on item 1 for the owner-directed cases.

## 3. Intent Transitions

`session.insights` is replaced wholesale on each analysis pass, so a speaker
moving between labels overwrites silently. Changed positions are named as a
validation case in `mission.md` but cannot currently be displayed.

The `existing` insights parameter is already threaded from `SessionStore`
through `analysis_input` into `IntentAnalyzer.analyze`, and neither analyzer
reads it. Transitions can be computed by the application from two already
validated enum values, adding no model trust surface.

## 4. Owner Objective for the Meeting

Proposed: a free-text objective supplied before or during the session, so the
conversation can be tracked against the owner's intended outcome rather than
only described. Treat the objective as data with the same discipline applied to
captions. Evaluate whether this can be done without inviting the model to
assert facts, owners or dates.

## 5. Open Loops Within the Session

Questions asked and not answered, ownership proposed and not confirmed, risks
raised and not addressed. These are live-assistance signals and expire with the
session; they are distinct from action items and meeting minutes, which
`mission.md` deprioritizes. The test for inclusion is whether an item is
actionable before the meeting ends.

## 6. Insight Stability

Recomputing every insight on every caption rewrites the panel even when nothing
has changed. Proposed: retain a hypothesis until evidence actually moves it, and
display its age. Presentational only; no analysis change required.

## 7. Evidence Strength Instead of a Confidence Number

The specs are consistent that confidence is uncalibrated and not a probability,
and the dashboard then renders a value between 0 and 1, which readers will
interpret as a probability. Proposed: display supporting evidence count instead.
This removes a documentation disclaimer that is contradicted by the interface.

## 8. Measurable Meeting Analytics

Owner decision on 2026-09-12: pursue analytics that rest on observable,
measurable speech. Do not infer sentiment, emotional state, engagement, or
standing personal traits such as willingness to cooperate.

Rationale: captions carry no audio, prosody or expression, so affect inference
rests on thin evidence while rendering as a confident indicator. A standing
per-person score also conflicts with `docs/privacy-and-consent.md`, which limits
outputs to hypotheses about observable speech, and would be damaging if the
dashboard were ever shared.

Design rule: score the moment, not the person; score the room, not the
individual.

Measurable without any model inference, from existing `ParticipantState` fields:

- Airtime share over a recent window, including the owner's own share.
- Time since a participant last spoke.
- Question rate, and questions left unanswered.

Cooperation signal without trait scoring: aggregate the existing `IntentLabel`
values already produced per speaker over a recent window. Repeated
`avoiding_commitment`, `delaying_decision` or `resisting_scope` carries the same
decision-relevant signal, stays tied to evidence, and describes moments rather
than people.

Candidate bounded enum fields for the analyzer, preserving the trust boundary
because all rendered prose stays in the application catalog:

- `stance`: supports, opposes, conditional, unstated.
- `conditionality`: the stated precondition for agreement. Highest value of the
  set; a stated condition is the concrete path to the owner's outcome.
- `assertion_type`: fact, opinion, question.

Group-level measures needing no per-person judgment: convergence or divergence
over a window, decision progress, count of open threads, and whether the owner's
stated objective has been raised at all.

Airtime, silence and unanswered questions are folded into item 2. The enum
fields require their own specification and evaluation fixtures.

Cross-meeting trend analytics would require an archive and are therefore a
mission-level change, not a feature. Within-session trends are in scope.

## Open Question: End-of-Session Handoff

Session-only retention is confirmed and the analysis is genuinely live. At the
end of a real meeting the owner may still want the risk they never addressed or
the commitment they made. An owner-initiated copy-to-clipboard action at session
end would persist nothing in the application while letting content leave by
explicit human action.

This needs an owner decision before any implementation. It is recorded here so
the gap is chosen deliberately rather than discovered during a meeting.
