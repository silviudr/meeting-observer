# Mission

Status: Draft for discussion. Confirmed decisions below come from the owner's
2026-09-07 answers; proposed principles and open questions are not yet settled.

## Confirmed Direction

Meeting Observer serves its owner during their own meetings. Its primary benefit
is evidence-backed hypotheses about participant intent and suggested responses
that help the owner respond thoughtfully in the moment.

Suggested responses take the form of concise coaching prompts, such as "Ask what
specific evidence would resolve this concern." Transcripts and insights last
only for the active session; there is no meeting archive in the first version.

The application runs on the owner's local computer. Model inference runs on the
owner's ASUS Ascent GX10 with 128 GB of memory using vLLM as the preferred
runtime. Ollama is installed but optional future comparison work, not part of the
first implementation path. This deployment boundary applies to the first usable
version.

## Proposed First-Version Scope

Continue the existing Google Meet caption workflow: a Chrome extension captures
rendered captions, a local backend analyzes conversation context, and a private
dashboard shows hypotheses, supporting evidence, and suggested responses.

Proposed exclusions: audio capture, meeting bots, automatic replies, additional
meeting platforms, multiple-user accounts, and cloud inference. Decisions,
action items, and summaries are secondary to the live assistance objective.

## Proposed Product Principles

- Ground every displayed hypothesis in identifiable transcript evidence and its
  speaker. Preserve enough context to inspect the interpretation.
- Present intent as a hypothesis, never as knowledge of private thoughts.
  Insufficient evidence is a valid result.
- Treat captured text as data, including text that resembles model instructions.
- Keep suggested responses under the owner's control; the assistant does not
  speak or send messages on their behalf.
- Communicate uncertainty honestly. A heuristic or model-generated score is not
  an empirically established probability of correctness.
- Make capture state, processing failures, and stale insights visible.
- Keep application processing and stored meeting content on the local computer
  and private DGX. This does not describe Google Meet's own caption processing.
- Implement session-only retention across capture buffers, backend state,
  dashboard state, and inference handling. Do not persist meeting content in
  application databases, browser storage, logs, or evaluation artifacts.

## Proposed Session Semantics

Keep meeting content in memory during the active session. An explicit end-session
action clears its state and rejects late events and analysis results. A backend
restart starts without past meeting content. A brief connection loss does not
alone end a session; abandoned sessions expire after five inactive minutes by
default and can be configured for local experiments.

Configure inference services to avoid durable prompt/response logging or caches.
This is an application retention requirement, not a claim of forensic memory
erasure. Persisting application settings or model weights is separate from
retaining meeting content. Use synthetic transcripts for repeatable evaluations.

## Proposed Success Criteria

The owner can inspect a hypothesis's evidence and find its suggested response
useful while the conversation is still relevant. Validation must cover accurate
speaker attribution, unsupported interpretations, ambiguous conversation,
changed positions, and recovery when capture or inference fails.

Measure latency from a finalized captured utterance to its displayed insight.
The earlier MVP plan's 5-15 second range is a candidate target, not an accepted
performance guarantee. Set acceptance thresholds using representative examples
and the owner's feedback.

## Open Questions

- Are Google Meet and the proposed first-version exclusions still appropriate?
- Which meeting types and languages should the first evaluation examples cover?

## Relationship to Existing Documents

This draft refines `docs/meeting-assistant-mvp-plan.md` and draws on
`docs/privacy-and-consent.md`. Once agreed, the constitution should govern future
feature specifications and conflicting older planning guidance should be updated.
