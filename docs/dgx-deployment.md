# DGX Deployment

## Objective

Run Meeting Observer inference locally on an NVIDIA DGX box so meeting transcript data stays inside the local environment.

## Recommended Runtime

Use `vLLM` first. It provides an OpenAI-compatible HTTP API, which keeps the Meeting Observer backend independent from the specific model runtime.

## Network Shape

```text
Chrome extension on laptop
  -> FastAPI backend on laptop or DGX
  -> vLLM endpoint on DGX
  -> dashboard in user's browser
```

For the first deployment, run both FastAPI and `vLLM` on the DGX if the laptop can reach the DGX over the LAN.

## Backend Environment

```bash
export MEETING_OBSERVER_LLM_BASE_URL=http://dgx-host:8000/v1
export MEETING_OBSERVER_LLM_MODEL=local-intent-model
export MEETING_OBSERVER_LLM_API_KEY=local
export MEETING_OBSERVER_DB=/data/meeting-observer/meeting_observer.sqlite
```

Start the backend:

```bash
uvicorn app.asgi:app --app-dir server --host 0.0.0.0 --port 8010
```

Point the Chrome extension backend URL to:

```text
http://dgx-host:8010
```

## vLLM Example

Exact model choice depends on what is installed on the DGX. The backend only requires an OpenAI-compatible `/v1/chat/completions` endpoint.

Example shape:

```bash
vllm serve /models/local-intent-model \
  --host 0.0.0.0 \
  --port 8000 \
  --served-model-name local-intent-model
```

## Operational Requirements

- Restrict backend access to trusted LAN clients.
- Use firewall rules so only required ports are reachable.
- Prefer ephemeral sessions while testing.
- Put SQLite storage on a persistent volume only if meetings need to be retained.
- Add HTTPS or a trusted tunnel before using this outside a private LAN.

## Validation

1. Start `vLLM`.
2. Start the FastAPI backend with the environment above.
3. Open `http://dgx-host:8010/health`.
4. Confirm `model_mode` is `llm`.
5. Stream the sample meeting:

```bash
python scripts/stream_sample_meeting.py --base-url http://dgx-host:8010 --session dgx-test
```

6. Open the dashboard at:

```text
http://dgx-host:8010/?session=dgx-test
```
