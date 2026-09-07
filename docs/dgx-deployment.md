# Private vLLM Guide

Status: **runtime launch pending.** This filename is retained for existing links.
The app and dashboard stay on the local computer at `http://localhost:8010`;
a private GPU machine serves inference only.

## Known State

One development environment used an NVIDIA GB10-class machine with 128 GB unified
memory, vLLM `0.26.0`, and a cached `nvidia/Qwen3.6-35B-A3B-NVFP4` checkpoint.
Do not rely on that exact setup. Record your own GPU, driver, vLLM version,
model revision, memory limits and serving command.

Preferred first model: `nvidia/Qwen3.6-35B-A3B-NVFP4`. NVIDIA recommends this artifact
for DGX Spark in its [vLLM guide](https://build.nvidia.com/spark/vllm/agent-ready-models).
Applying a Spark recipe to other GB10-class systems is an inference, not proof of
compatibility. The [NVIDIA model card](https://huggingface.co/nvidia/Qwen3.6-35B-A3B-NVFP4)
describes the quantized artifact. Ollama comparison is optional, not required.

## Resolve Before Launch

Before using the model for real meetings, launch the installed vLLM environment,
check architecture/driver compatibility against the current official recipe, and
record the actual model revision, quantization, context limit, generation limit
and service configuration. Do not download weights as part of documentation or
synthetic local validation.

Configure runtime and any proxy to avoid prompt/response logging, request-body
tracing, durable response caches and content-bearing crash artifacts. Verify those
settings on the selected version before sending real captions. An in-memory KV
cache is distinct from durable content retention; session end is not a claim of
forensic GPU-memory erasure.

## Application Connection

Once an endpoint is verified and already running, point the app at its actual
OpenAI-compatible `/v1` URL. This example assumes a separately verified local
tunnel on port 8000; it does not establish or start one:

```bash
export MEETING_OBSERVER_LLM_BASE_URL=http://127.0.0.1:8000/v1
export MEETING_OBSERVER_LLM_MODEL=nvidia/Qwen3.6-35B-A3B-NVFP4
# Set MEETING_OBSERVER_LLM_API_KEY to the configured runtime credential.
uvicorn app.main:app --app-dir server --host 127.0.0.1 --port 8010 --no-access-log
```

For direct private-network access substitute the verified private host and port.
Use a trusted tunnel or protected network path and runtime authentication; do not
expose the app or inference service publicly. Confirm `/v1/models` advertises the
configured served model name without printing credentials or response content
from inference calls.

The application uses `/v1/chat/completions`, bounded output and structured JSON.
The [vLLM API documentation](https://docs.vllm.ai/en/latest/serving/openai_compatible_server/)
documents the compatible endpoint and extra parameters. Disable thinking for every
request using `chat_template_kwargs: {"enable_thinking": false}`, as documented
in the [Qwen model card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B).
Check the actual wire request and response; JSON formatting alone does not prove
thinking is disabled. Reject residual reasoning and unsupported evidence.

## Acceptance

Run the [synthetic evaluator](meeting-analysis-evaluation.md) first, then the full
simulation and controlled Meet check. Report model/runtime revisions, settings,
sample count, cold versus warm state, evidence validity and coaching review.
Keep raw inference request latency separate from finalized-caption-to-displayed-
insight latency. Candidate warm application goals are median <=5 seconds and
p95 <=10 seconds; neither has been measured here. Health success, unit tests and
token throughput do not establish those goals.
