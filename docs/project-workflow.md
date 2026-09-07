# Project Workflow

Read [mission](../specs/mission.md), [roadmap](../specs/roadmap.md) and
[tech stack](../specs/tech-stack.md), then the active feature's requirements,
plan and validation together. For the current work these are under
`specs/2026-09-07-vllm-personal-mvp/`. Distinguish confirmed decisions from draft
questions, implementation from validation, and local checks from hardware checks.

Project-owned skills are available as repository files:

| Skill | Use |
| --- | --- |
| [feature-spec](../skills/feature-spec/SKILL.md) | Resume an incomplete phase or scope the next feature |
| [feature-validation](../skills/feature-validation/SKILL.md) | Compare implementation with acceptance and record evidence/gaps |
| [meeting-analysis-evaluation](../skills/meeting-analysis-evaluation/SKILL.md) | Evaluate synthetic coaching, grounding and latency |

Ask an agent to read the relevant `skills/<name>/SKILL.md` by path. These files
are not installed automatically; no global, `.agents/` or `.codex/` installation
is required. Keep durable product decisions in specs and operational details in
docs. The skills describe how to use those sources rather than replacing them.

Delegated workers receive the feature directory, relevant constitution files,
owned paths and shared interfaces. Honor ownership and existing edits. Route
changes to feature/constitution documents through their owner when those paths
are outside the worker's assignment. Do not force a branch, commit, interview,
remote launch or dependency installation as a side effect of loading a skill.

Acceptance evidence includes commands, environment, result and remaining limits.
Keep only synthetic fixture IDs, counts, scores and latency metadata in reports.
The coordinator integrates evidence into the feature validation file; a successful
unit suite does not close the live Meet or GX10 acceptance items.
