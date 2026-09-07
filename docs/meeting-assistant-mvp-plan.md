# Meeting Assistant MVP Direction

The original prototype plan is superseded by the [mission](../specs/mission.md),
[roadmap](../specs/roadmap.md), [technical direction](../specs/tech-stack.md) and
[personal vLLM feature contract](../specs/2026-09-07-vllm-personal-mvp/requirements.md).
Draft/open items in the constitution remain owned by the coordinator.

The confirmed working scope is personal Google Meet use in Chrome, English
captions, a local FastAPI app and static dashboard on port 8010, private GX10 vLLM
inference, evidence-backed hypotheses and concise coaching prompts. Transcript
and insight content is session-only. There is no audio capture, automatic reply,
meeting archive, persistent database or post-meeting summary workflow.

Start with synthetic delivery, then grounded model evaluation, lifecycle and
client checks, and finally a controlled live Meet check. vLLM with
`nvidia/Qwen3.6-35B-A3B-NVFP4` and thinking disabled is the preferred candidate;
hardware compatibility and performance still require measurement. Ollama is an
optional comparison, not a prerequisite.

Use the [local runbook](local-runbook.md), [GX10 guide](dgx-deployment.md), and
[project workflow](project-workflow.md). Record actual evidence in the active
feature's validation file through its owner; implementation presence alone does
not establish acceptance.
