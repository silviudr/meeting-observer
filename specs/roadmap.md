# Roadmap

Status: Proposed implementation order. The prototype is committed, but existing
code is not evidence that a phase meets its acceptance criteria.

## Phase 0: Agree on the Constitution and Workflow

- [x] Confirm coaching prompts and session-only transcript/insight retention.
- [x] Record ASUS Ascent GX10, 128 GB RAM, with Ollama and vLLM installed.
- [ ] Resolve remaining mission boundaries and abandoned-session behavior.
- [ ] Record the local computer and DGX environment.
- [ ] Agree on mission, technical constraints, and this implementation order.
- [x] Adapt `feature-spec` and define the project's validation workflow.

Exit: product decisions and remaining experiments are distinguishable; the next
phase has requirements, a numbered plan, and explicit validation criteria.

## Phase 1: Establish a Reproducible Local Baseline

- [x] Consolidate the backend entrypoint and startup documentation.
- [x] Make the simulated transcript-to-dashboard path reproducible.
- [ ] Verify existing tests and document unresolved prototype defects.

Exit: a documented local startup displays simulated events and clearly identifies
the analysis mode; validation records what has and has not been verified.

## Phase 2: Establish Evaluation Examples and Choose DGX Inference

- [x] Define the `meeting-analysis-evaluation` workflow and transcript fixtures.
- [ ] Agree on criteria for evidence, uncertainty, useful responses, and latency.
- [ ] Benchmark the selected model under vLLM on the actual GX10.
- [ ] Begin with Qwen3.6-35B-A3B in non-thinking mode; validate coaching quality
  and end-to-end latency before selecting a model/runtime configuration.
- [x] Document the selected runtime, model, settings, and local connection path.

Exit: selection is supported by measured latency and quality results. If neither
candidate meets the criteria, record the failure and revise the plan.

## Phase 3: Make Caption Capture Reliable

- [x] Specify and correct speaker extraction and partial-caption handling.
- [x] Verify deduplication, retry behavior, and session separation.
- [x] Check paused capture, missing captions, and backend disconnection states.

Exit: representative caption fixtures and a controlled Meet session verify
attribution and delivery, including interruption and recovery.

## Phase 4: Define and Implement Session Lifecycle

- [x] Replace SQLite meeting persistence with in-memory session state.
- [x] Implement explicit session end, cleanup, restart, and abandoned-session behavior.
- [x] Verify that browser storage, logs, and inference services do not retain
  meeting content; define how to handle any legacy database explicitly.
- [x] Verify access controls across local and private-network components.
- [x] Prevent in-flight work from restoring deleted session data.

Exit: lifecycle and access tests demonstrate the agreed behavior, including
restart, disconnection, and deletion during analysis.

## Phase 5: Deliver Grounded Live Hypotheses

- [x] Integrate the selected DGX configuration into the live event workflow.
- [x] Validate output evidence and attribution; handle insufficient evidence.
- [x] Handle timeouts, malformed output, fallback, and stale analysis explicitly.

Exit: agreed evaluation cases meet quality and latency criteria through the
application, including failure cases.

## Phase 6: Refine Suggested Responses and Validate Personal Use

- [x] Present concise coaching prompts with inspectable supporting evidence.
- [ ] Verify the dashboard is readable and usable alongside an active meeting.
- [ ] Collect owner feedback during controlled sessions and resolve blocking gaps.
- [ ] Record a repeatable startup procedure and validated first-version limits.

Exit: the owner finds suggestions useful during representative meetings and the
complete workflow satisfies the agreed acceptance criteria.

## Feature Discipline

Before implementing a phase, create `specs/YYYY-MM-DD-feature-name/` containing
`requirements.md`, `plan.md`, and `validation.md`. Keep each implementation
reviewable; split a phase into smaller feature specifications where necessary.
Record actual validation evidence and unresolved failures before marking work
complete. Changes to scope or constraints must be reflected in the constitution.
