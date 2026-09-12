# Owner Identity and Salience Requirements

Implements items 1 and 2 of `specs/enhancement-backlog.md`, plus the airtime,
silence and unanswered-question measures folded in from item 8. Extends the
personal vLLM MVP; every constraint in that feature's requirements still holds.

## Problem

The application treats all speakers identically, so it cannot tell the owner
that a question was aimed at them or that they have dominated the discussion.
Separately, every caption re-renders every speaker's hypothesis with no priority
ordering, which produces continuous output that is unlikely to be read during a
live call.

## Decisions and Working Defaults

- The owner is identified by a caption speaker name supplied by the owner. The
  application never guesses it.
- Google Meet renders the local participant as `You` in many layouts, so `You`
  also resolves to the owner whenever an owner name is set. Matching is
  case-insensitive and whitespace-normalised; it is never fuzzy.
- Owner identity is session state, cleared on end and expiry like all other
  session content. It is not meeting content and may be supplied before any
  caption arrives.
- When an owner name is set but no captured speaker has matched it, the
  dashboard says so explicitly. Silent mislabelling is not acceptable.
- Salience cues are computed by the application from captured events, existing
  validated `IntentLabel` values, and participant counts. No cue requires a new
  model capability and no cue text comes from the model.
- Cue prose comes from an application catalog, exactly as coaching prompts do.
- No cue is emitted for sentiment, emotion, engagement, or standing personal
  traits. See item 8 of the backlog for that decision.
- Absence of cues is a valid and expected state. The dashboard says nothing
  needs attention rather than inventing an item.

## Cue Catalog

Each cue carries a kind, an optional speaker, catalog-rendered text, a priority,
and the evidence event IDs supporting it. Cues are ordered by priority.

| Kind | Priority | Condition |
| --- | --- | --- |
| `unanswered_question` | 100 | A non-owner asked a question and the owner has not spoken since |
| `new_risk` | 80 | A speaker's intent label moved into `raising_risk` |
| `position_change` | 70 | A speaker's label moved between the supportive and resistant clusters |
| `owner_dominating` | 50 | The owner holds at least 60% of the last 10 or more turns |
| `silent_participant` | 40 | A participant who has spoken has said nothing for 5 minutes |

`unanswered_question` and `owner_dominating` require a matched owner. The other
three do not, so the feature degrades usefully when no owner is set.

Question detection uses a terminal question mark or a clear interrogative
opening. It is a text heuristic over captions, not an inference about intent,
and it can miss questions that captions render without punctuation.

Cluster membership for `position_change`: supportive is `seeking_decision`,
`seeking_alignment` and `escalating_urgency`; resistant is `raising_risk`,
`resisting_scope`, `delaying_decision`, `avoiding_commitment` and
`indirect_disagreement`. Movement within a cluster is not a position change.

## API Contract

- `POST /api/sessions/{id}` accepts an optional JSON body `{"owner_speaker": str
  | null}`. Omitting the body preserves the existing no-body behaviour.
- `POST /api/sessions/{id}/owner` sets or clears the owner on an active session
  and returns a snapshot. 404 unknown, 410 ended, as elsewhere.
- Owner names are 1-120 characters after normalisation, matching the existing
  speaker field limit. An empty or null value clears the owner.
- Snapshot adds `owner_speaker` (nullable), `owner_matched` (boolean) and
  `cues` (list, possibly empty). `ParticipantState` adds `is_owner`.

## Client Requirements

- The extension popup accepts an owner display name, stores it with the other
  settings, and sends it when starting a session. It is a setting, not meeting
  content, so it may persist in extension storage like the backend URL.
- The dashboard shows a glance area with the highest-priority cue, the full cue
  list, and the owner's match state. The owner can set the name from the
  dashboard as well, because caption names are not known until captions arrive.
- The owner's own participant row is visually distinguished.

## Out of Scope

Intent transitions as a displayed history (backlog item 3), the owner objective
(item 4), open loops beyond the unanswered-question cue (item 5), insight
stability (item 6), evidence strength display (item 7), and the analyzer enum
fields (item 8). Cue thresholds are fixed defaults in this feature; making them
configurable is deferred until real meetings show what they should be.
