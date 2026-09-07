# Tech Stack

Status: Draft for discussion. Deployment location, session-only retention, and
coaching prompts are confirmed. Stack changes and the model candidate below are
proposals; no model or runtime benchmark has been run on the owner's hardware.

## Application Structure

| Layer | Proposed choice | Reason |
| --- | --- | --- |
| Caption capture | Existing Chrome Manifest V3 extension | Continue the prototype's Google Meet integration |
| Backend | Python, FastAPI, Pydantic | Preserve the existing ingestion and validation implementation |
| Live updates | HTTP ingestion and WebSocket dashboard updates | Existing interfaces support the intended local workflow |
| Dashboard | Existing HTML, CSS, and JavaScript | Current scope does not establish a need for a framework migration |
| Session storage | In-memory state with explicit session cleanup | Confirmed session-only retention; replace current SQLite meeting writes |
| Inference | vLLM on the owner's GX10 | Confirmed preferred runtime; model/configuration require validation |
| Verification | Existing pytest tests plus browser and model evaluation checks | Verify the complete caption-to-insight workflow |

The confirmed deployment is:

```text
Google Meet captions in Chrome
  -> extension on local computer
  -> FastAPI on local computer
  -> vLLM on private GX10
  -> FastAPI on local computer
  -> dashboard on local computer
```

The current backend uses an OpenAI-compatible chat completion interface. Verify
the selected runtime's request, response, and structured-output behavior before
treating it as compatible. Do not assume both runtimes need permanent support.

## Confirmed Hardware and Model Proposal

The owner has an ASUS Ascent GX10 with 128 GB RAM and both Ollama and vLLM
installed. ASUS specifies a GB10 CPU/GPU and 128 GB unified memory in its
[GX10 specifications](https://www.asus.com/us/networking-iot-servers/desktop-ai-supercomputer/ultra-small-ai-supercomputers/asus-ascent-gx10/techspec/).
Installed runtime versions, available models, and free memory remain unverified.

Initial benchmark candidate: **Qwen3.6-35B-A3B in non-thinking mode**. Its model
card describes 35 billion total parameters with 3 billion active per token and
documents disabling thinking through the chat template. This makes it a plausible
candidate for concise live coaching; it does not establish meeting-analysis
quality or latency. See the
[Qwen model card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B).

Start with `nvidia/Qwen3.6-35B-A3B-NVFP4` under vLLM. The owner selected vLLM as
the preferred runtime; Ollama comparison is optional future work. NVIDIA
recommends the NVFP4 build for DGX Spark in its
[serving guide](https://build.nvidia.com/spark/vllm/agent-ready-models), and Ollama
lists its build in the [model library](https://ollama.com/library/qwen3.6).
Applying the Spark recipe to the GX10 is an inference from their GB10 hardware;
verify runtime, driver, and recipe compatibility on the GX10 before deployment.
Runtime preference is an engineering decision, not a claim of measured speed.

Proposed benchmark workload: one active meeting, bounded recent context, brief
structured hypotheses, evidence references, and one or two coaching prompts.
Keep the model warm and measure increasing context lengths. Begin with thinking
disabled using vLLM's supported mechanism, checking both output quality
and that extra reasoning is actually disabled. Tune cadence and output length to
avoid an analysis backlog; preserve earlier relevant evidence in session memory.

Proposed responsiveness target for discussion: median finalized-caption-to-insight
latency at most 5 seconds and 95th percentile at most 10 seconds in warm operation.
These are evaluation goals, not measured results. Reconcile them with the mission's
earlier candidate range when agreeing on acceptance criteria.

## Model and Configuration Validation

Choose the fastest supported configuration that meets agreed insight-quality
criteria on the actual GX10 under vLLM. No measured configuration is established yet.

Before selection, record hardware, available memory, installed runtimes, model,
quantization, context size, generation settings, and runtime versions. Compare
equivalent models and settings where supported; disclose differences otherwise.

Replay representative short and long meeting contexts. Measure median and tail
latency to complete usable insights, structured-output validity, evidence
correctness, and memory use. Report cold startup separately from warm inference.
Measure the full application path as well as model request latency; streaming
token speed alone does not establish time to a displayed insight.

## Proposed Engineering Rules

- Establish one documented backend entrypoint; the prototype currently has three.
- Specify event identity, partial-caption handling, ordering, and retry behavior.
- Keep model work from blocking caption ingestion and prevent stale analysis
  from replacing newer state or restoring a deleted session.
- Validate speaker and evidence references against captured events, not only the
  output JSON shape.
- Make fallback behavior explicit. Rule-based output must be distinguishable
  from DGX model output.
- Replace durable meeting writes with in-memory session state. Prevent meeting
  content from entering browser persistence, application/runtime logs, or durable
  inference caches. Clear session buffers and reject late work after session end.
- Verify retention with synthetic fixtures, including restart and abandoned
  sessions. Document and handle legacy SQLite data explicitly during migration;
  do not silently delete existing files.
- Define the local/private-network access boundary and verify configuration
  consistently across the extension, backend, dashboard, and inference service.
- Treat documentation and configuration as part of each feature's validation.

## Proposed Reusable Skills

These are proposed workflows, not installed project skills:

- `feature-spec`: adapt the course skill to turn a roadmap phase into
  requirements, numbered tasks, and validation criteria. Resume partially
  completed phases and ask only questions not already answered in the specs.
- `feature-validation`: compare behavior with acceptance criteria and record
  evidence, defects, and unverified checks. Scale tests to the feature's risk.
- `meeting-analysis-evaluation`: replay transcript examples and evaluate
  attribution, supporting evidence, ambiguity, response usefulness, and latency.
- `changelog`: adapt the course skill when repeatable release reporting is needed.

Use the available `skill-creator` when authoring these workflows. General Python,
browser, database, and model-integration work does not require one skill file per
technology. Keep durable product decisions in the constitution, not only in
agent-specific instructions.

## Open Questions

- Installed runtime versions, available models, and free GX10 memory.
- Local computer operating system and browser.
- Abandoned-session timeout and reconnect semantics.
- Accepted latency and insight-quality thresholds.
