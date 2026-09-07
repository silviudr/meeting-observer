---
name: feature-spec
description: Scope or resume a Meeting Observer feature from the roadmap and maintain its requirements, implementation plan and acceptance criteria.
---

# Feature Specification

Read `specs/mission.md`, `specs/tech-stack.md`, `specs/roadmap.md` and any active
feature directory before choosing work. Paths are relative to the repository root.
Resume a partially completed phase when appropriate; unchecked tasks inside an
otherwise completed phase still count. Do not choose only wholly unchecked phases.

Use existing decisions and inspect affected code and tests before asking about
unresolved choices. Ask only when missing information changes scope or behavior.
Preserve the user's current authorization and file ownership; route spec edits to
the coordinator when specs are outside your assignment.

For authorized spec work, create or update `specs/YYYY-MM-DD-feature-name/`:

- `requirements.md`: observable behavior, scope, interfaces, confirmed decisions
  and explicitly unresolved questions.
- `plan.md`: numbered, reviewable task groups with owners, dependencies and shared
  contracts where concurrent work touches the same behavior.
- `validation.md`: acceptance mapped to existing or needed tests, runnable commands,
  manual checks, hardware checks and completion criteria. Start unrun checks as unrun.

For the personal vLLM MVP, use `specs/2026-09-07-vllm-personal-mvp/` as the shared
contract. Preserve explicit session creation/end, ephemeral content, grounded
speaker evidence, coaching prompts and honest analysis modes. Inspect
`server/tests/` and `tests/` to connect requirements to actual coverage; do not
assume a test file proves acceptance.

Keep feature work focused. Loading this skill does not require a new branch,
commit, dependency, or remote action. Finish with changed specs, implementation
dependencies and unresolved decisions, separating candidate targets from results.
