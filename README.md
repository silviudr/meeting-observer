# Meeting Observer

Personal Google Meet coaching from English captions in Chrome. The extension
sends captions to FastAPI on the local computer; a private dashboard displays
evidence-backed intent hypotheses and concise coaching prompts. No audio capture
or automatic replies. Transcript and insight content lasts only in session memory.

## What You Need

- Python 3.12 or newer.
- Google Chrome or Chromium with Developer Mode enabled for the unpacked
  extension.
- A local or private-network OpenAI-compatible vLLM endpoint for real model
  analysis. Without one, the app runs in clearly labeled `rules` demo mode.
- Google Meet captions enabled in the meeting tab.

## Start The Local App

From the repository root:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r server/requirements.txt
uvicorn app.main:app --app-dir server --host 127.0.0.1 --port 8010 --no-access-log
```

Open <http://localhost:8010>. With no model endpoint configured, analysis is
explicitly labeled `rules`; this is a synthetic demo, not model validation.

To verify the local app without Google Meet, run:

```bash
python3 scripts/stream_sample_meeting.py
```

Select the session ID printed by the script in the dashboard. Use `--session demo`
for a predictable ID while that session remains active. An ended ID returns 410;
choose a new ID. The script creates the session before sending events and prints
only metadata. End the session in the dashboard when finished.

## Use vLLM For Real Analysis

Start an OpenAI-compatible vLLM server on a private machine or local GPU box. The
first tested target model is `nvidia/Qwen3.6-35B-A3B-NVFP4` with thinking disabled
by the application request.

Example vLLM server command used for the first GB10-class test:

```bash
source ~/vllm-env/bin/activate

vllm serve nvidia/Qwen3.6-35B-A3B-NVFP4 \
  --host 0.0.0.0 \
  --port 8000 \
  --trust-remote-code \
  --kv-cache-dtype fp8 \
  --attention-backend flashinfer \
  --moe-backend marlin \
  --max-model-len 8192 \
  --max-num-seqs 2 \
  --max-num-batched-tokens 4096 \
  --disable-log-stats
```

Use a protected private network path, firewall rule, or SSH tunnel if binding
vLLM to `0.0.0.0`. For lower memory pressure, start with `--max-num-seqs 1` and
`--max-num-batched-tokens 2048`.

Example backend configuration:

```bash
export MEETING_OBSERVER_LLM_BASE_URL=http://your-vllm-host:8000/v1
export MEETING_OBSERVER_LLM_MODEL=nvidia/Qwen3.6-35B-A3B-NVFP4
export MEETING_OBSERVER_LLM_API_KEY=local

uvicorn app.main:app --app-dir server --host 127.0.0.1 --port 8010 --no-access-log
```

Replace `your-vllm-host` with your private hostname, IP address, or SSH tunnel
endpoint. Keep the FastAPI app bound to `127.0.0.1` unless you intentionally
secure and expose it on your LAN.

Check that vLLM is reachable before starting a meeting test:

```bash
curl http://your-vllm-host:8000/v1/models
curl http://localhost:8010/health
```

`/health` should report `{"ok": true, "model_mode": "vllm"}` when the backend is
configured for model analysis. It does not prove quality or latency; run the
synthetic and browser checks below. See the [vLLM guide](docs/dgx-deployment.md)
for runtime notes. Ollama is optional future comparison work, not a dependency.

Thinking mode is intentionally disabled for every model request with
`chat_template_kwargs: {"enable_thinking": false}`. This keeps inference faster
and reduces the chance that hidden reasoning leaks into responses; the analyzer
also rejects non-empty reasoning fields or `<think>` blocks.

## Load The Chrome Extension

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click **Load unpacked**.
4. Select this repository's `extension/` directory.
5. Reload the Google Meet tab after loading or updating the extension.

To capture a meeting:

1. Join a Google Meet call and turn captions on.
2. Open the Meeting Observer extension popup from the active Meet tab.
3. Set backend URL to `http://localhost:8010`.
4. Choose a fresh session ID, for example `demo1`.
5. Enter the access token only if `MEETING_OBSERVER_ACCESS_TOKEN` is set.
6. Check **Capture captions** and click **Start capture**.
7. Open <http://localhost:8010> and connect to the same session ID.

Keep the Meet tab visible during capture. Chrome and Meet may throttle hidden
tabs, and this extension depends on rendered caption text.

If you are testing alone, use
[the single-participant script](docs/single-participant-browser-test.md). That
validates the browser flow but not multi-speaker attribution.

## Optional Access Token

Set the same token in the backend shell and in the dashboard/extension fields:

```bash
export MEETING_OBSERVER_ACCESS_TOKEN=local-secret
```

HTTP clients send it as `Authorization: Bearer local-secret`. WebSocket clients
use the dashboard/extension token field. Do not put meeting transcripts, tokens,
or raw model responses in retained logs.

## Verify Changes

```bash
cd server
../.venv/bin/python -m pytest tests

cd ..
node --test tests/*.test.mjs
```

## Guides and Workflow

- [Local runbook](docs/local-runbook.md): startup, auth, lifecycle and simulation.
- [Google Meet check](docs/google-meet-live-test.md): controlled capture validation.
- [Synthetic model evaluation](docs/meeting-analysis-evaluation.md): evidence,
  no-thinking checks and inference timing.
- [Privacy](docs/privacy-and-consent.md): session boundaries and content handling.
- [Project workflow](docs/project-workflow.md): specs and project-owned skills.

The [active feature](specs/2026-09-07-vllm-personal-mvp/requirements.md) defines
the implementation contract; [validation](specs/2026-09-07-vllm-personal-mvp/validation.md)
records actual acceptance evidence. Confidence is uncalibrated, not a probability
of knowing another person's intent.
