export function mountDashboard({ window, document, fetch, WebSocket }) {
  const els = Object.fromEntries([
    "sessionForm", "sessionInput", "tokenInput", "statusText", "lineCount",
    "participantCount", "insightCount", "transcriptList", "insightsList",
    "modelMode", "analysisStatus", "clearButton",
  ].map((id) => [id, document.querySelector(`#${id}`)]));
  const state = {
    generation: 0, sessionId: null, token: "", snapshot: null,
    socket: null, request: null, requestTimer: null, timer: null, attempts: 0, active: false,
  };
  const validId = (id) => /^[A-Za-z0-9_-]{1,80}$/.test(id);
  const current = (generation) => state.generation === generation;
  const status = (message) => { els.statusText.textContent = message; };

  function clearTimer() {
    window.clearTimeout(state.timer);
    state.timer = null;
  }

  function clearContent() {
    state.snapshot = null;
    els.transcriptList.replaceChildren();
    els.insightsList.replaceChildren();
    els.transcriptList.scrollTop = 0;
    els.insightsList.scrollTop = 0;
    els.lineCount.textContent = "0";
    els.participantCount.textContent = "0";
    els.insightCount.textContent = "0";
    els.modelMode.textContent = "Not connected";
    els.analysisStatus.textContent = "No active analysis";
    els.analysisStatus.dataset.status = "idle";
  }

  // Invalidate callbacks before aborting requests or closing the old socket.
  function stop() {
    state.generation += 1;
    state.active = false;
    clearTimer();
    window.clearTimeout(state.requestTimer);
    state.requestTimer = null;
    state.request?.abort();
    state.request = null;
    const socket = state.socket;
    state.socket = null;
    socket?.close();
    clearContent();
    els.clearButton.disabled = true;
    return state.generation;
  }

  function terminal(message) {
    stop();
    state.sessionId = null;
    state.token = "";
    els.tokenInput.value = "";
    status(message);
  }

  function httpMessage(code) {
    if (code === 401 || code === 403) return "Access denied. Check the access token.";
    if (code === 404) return "Session not found. Start a session explicitly.";
    if (code === 410) return "Session ended. Choose a new session ID.";
    if (code === 422) return "Invalid session ID. Use 1-80 letters, digits, underscores or hyphens.";
    return `Request failed (HTTP ${code}).`;
  }

  async function request(method, generation) {
    const controller = new AbortController();
    state.request = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    state.requestTimer = timeout;
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(state.sessionId)}`, {
        method,
        headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        const error = new Error(httpMessage(response.status));
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } finally {
      window.clearTimeout(timeout);
      if (current(generation) && state.request === controller) {
        state.request = null;
        state.requestTimer = null;
      }
    }
  }

  function acceptSnapshot(snapshot, generation) {
    if (!current(generation) || !state.active) return false;
    if (snapshot?.session_id !== state.sessionId) throw new Error("Unexpected session response.");
    if (snapshot.status === "ended") {
      terminal("Session ended. Choose a new session ID.");
      return false;
    }
    if (snapshot.status !== "active" || !Number.isInteger(snapshot.revision)
      || !Array.isArray(snapshot.transcript) || !Array.isArray(snapshot.insights)
      || !Array.isArray(snapshot.participants)) throw new Error("Invalid session response.");
    if (state.snapshot && snapshot.revision < state.snapshot.revision) return true;
    state.snapshot = snapshot;
    render(snapshot);
    els.clearButton.disabled = false;
    return true;
  }

  function retry(generation, reason = "Connection lost") {
    if (!current(generation) || !state.active) return;
    clearTimer();
    const delay = Math.min(1000 * 2 ** Math.min(state.attempts++, 5), 30000);
    status(`${reason}. Reconnecting; displayed content may be stale.`);
    state.timer = window.setTimeout(() => {
      if (!current(generation) || !state.active) return;
      state.timer = null;
      load("GET", generation);
    }, delay);
  }

  function connectSocket(generation) {
    const url = new URL(`/ws/dashboard/${encodeURIComponent(state.sessionId)}`, window.location.href);
    url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    if (state.token) url.searchParams.set("token", state.token);
    let socket;
    try {
      socket = new WebSocket(url.href);
    } catch {
      retry(generation);
      return;
    }
    state.socket = socket;
    const ownsSocket = () => current(generation) && state.active && state.socket === socket;
    function recover(reason) {
      if (!ownsSocket()) return;
      state.socket = null;
      socket.close();
      retry(generation, reason);
    }
    // Recheck a silent connection with GET; dashboard traffic never renews capture activity.
    function watchdog() {
      clearTimer();
      state.timer = window.setTimeout(() => recover("Connection timed out"), 20000);
    }
    watchdog();
    socket.addEventListener("open", () => {
      if (!ownsSocket()) return;
      status(`Connected to ${state.sessionId}`);
      watchdog();
    });
    socket.addEventListener("message", (event) => {
      if (!ownsSocket()) return;
      try {
        if (!acceptSnapshot(JSON.parse(event.data), generation)) return;
        state.attempts = 0;
        status(`Connected to ${state.sessionId}`);
        watchdog();
      } catch {
        recover("Invalid server response");
      }
    });
    socket.addEventListener("close", (event) => {
      if (!ownsSocket()) return;
      state.socket = null;
      if (event.code === 4001) terminal("Session ended. Choose a new session ID.");
      else if (event.code === 4004) terminal("Session not found. Start a session explicitly.");
      else if (event.code === 1008) terminal("Access denied. Check the access token.");
      else retry(generation);
    });
    socket.addEventListener("error", () => {
      // Browsers report an error before close; preserve the close code when available.
      if (ownsSocket()) status("Connection error; checking session.");
    });
  }

  async function load(method, generation) {
    if (!current(generation) || !state.active) return;
    try {
      const snapshot = await request(method, generation);
      if (!acceptSnapshot(snapshot, generation)) return;
      status(`Connecting to ${state.sessionId}`);
      connectSocket(generation);
    } catch (error) {
      if (!current(generation)) return;
      if (method === "GET" && (!error.status || error.status >= 500 || error.status === 429)) {
        retry(generation, error.status ? httpMessage(error.status) : "Server unavailable");
      } else {
        terminal(error.status ? httpMessage(error.status) : "Unable to start session. Check the connection and retry Start / Connect.");
      }
    }
  }

  function start(sessionId, method) {
    const generation = stop();
    state.sessionId = null;
    state.token = "";
    if (!validId(sessionId)) {
      status("Invalid session ID. Use 1-80 letters, digits, underscores or hyphens.");
      return;
    }
    state.sessionId = sessionId;
    state.token = els.tokenInput.value;
    state.active = true;
    state.attempts = 0;
    els.sessionInput.value = sessionId;
    status(`${method === "POST" ? "Starting" : "Looking up"} ${sessionId}`);
    load(method, generation);
  }

  async function endSession() {
    if (!state.sessionId || els.clearButton.disabled) return;
    const generation = stop();
    state.token = els.tokenInput.value;
    status("Ending session...");
    try {
      await request("DELETE", generation);
      if (current(generation)) terminal("Session ended. Choose a new session ID.");
    } catch (error) {
      if (!current(generation)) return;
      if (error.status === 404 || error.status === 410) {
        terminal("Session ended. Choose a new session ID.");
      } else {
        // Keep only the target and credential so End can be retried without reconnecting.
        els.clearButton.disabled = false;
        status(`End not confirmed. ${error.status ? httpMessage(error.status) : "Server unavailable."} Retry End session.`);
      }
    }
  }

  function render(snapshot) {
    els.lineCount.textContent = String(snapshot.transcript.length);
    els.participantCount.textContent = String(snapshot.participants.length);
    els.insightCount.textContent = String(snapshot.insights.length);
    els.modelMode.textContent = modeLabel(snapshot.analysis_mode);
    const messages = {
      idle: "Waiting for captions.",
      pending: snapshot.insights.length ? "Analysis pending. Previous coaching shown." : "Analysis pending.",
      ready: snapshot.insights.length ? "Analysis ready. Intent is a hypothesis." : "Insufficient evidence for coaching.",
      unavailable: snapshot.insights.length ? "Analysis unavailable. Previous coaching may be stale." : "Analysis unavailable.",
    };
    els.analysisStatus.dataset.status = snapshot.analysis_status;
    els.analysisStatus.textContent = (messages[snapshot.analysis_status] || "Analysis status unknown.")
      + (snapshot.analysis_detail ? ` ${snapshot.analysis_detail}` : "");
    renderTranscript(snapshot.transcript);
    renderInsights(snapshot.insights, snapshot.transcript);
  }

  function renderTranscript(transcript) {
    const list = els.transcriptList;
    const oldTop = list.scrollTop;
    const follow = list.scrollHeight - oldTop - list.clientHeight < 48;
    const anchor = [...list.children].find((child) => child.offsetTop + child.offsetHeight > oldTop);
    const anchorId = anchor?.dataset.eventId;
    const anchorOffset = anchor ? anchor.offsetTop - oldTop : 0;
    list.innerHTML = transcript.length ? transcript.map((event) => {
      const when = new Date(event.timestamp).toLocaleTimeString([], {
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
      return `<li class="transcript-line" data-event-id="${escapeHtml(event.id)}">
        <div><span class="speaker">${escapeHtml(event.speaker)}</span>
        <span class="time">${escapeHtml(when)}</span></div>
        <div class="utterance">${escapeHtml(event.text)}</div></li>`;
    }).join("") : '<li class="empty">Waiting for captions.</li>';
    const newAnchor = [...list.children].find((child) => child.dataset.eventId === anchorId);
    list.scrollTop = follow ? list.scrollHeight : newAnchor ? newAnchor.offsetTop - anchorOffset : oldTop;
  }

  function renderInsights(insights, transcript) {
    const events = new Map(transcript.map((event) => [event.id, event]));
    const scrollTop = els.insightsList.scrollTop;
    els.insightsList.innerHTML = insights.map((insight) => {
      const evidence = (insight.evidence || []).map((line, index) => {
        const event = events.get(insight.evidence_event_ids?.[index]);
        return `<li><strong>${escapeHtml(event?.speaker || insight.speaker)}:</strong> ${escapeHtml(line)}</li>`;
      }).join("");
      return `<article class="insight">
        <div class="insight-top"><div><strong>${escapeHtml(insight.speaker)}</strong>
          <div class="intent-label">${escapeHtml(insight.intent_label.replaceAll("_", " "))}</div></div>
          <span class="model-mode">${modeLabel(insight.analysis_mode)}</span></div>
        <p class="move">${escapeHtml(insight.suggested_user_move)}</p>
        <p class="hypothesis"><span class="label">Hypothesis:</span> ${escapeHtml(insight.hypothesis)}</p>
        <ul class="evidence" aria-label="Supporting evidence">${evidence}</ul>
      </article>`;
    }).join("");
    els.insightsList.scrollTop = scrollTop;
  }

  els.sessionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    start(els.sessionInput.value, "POST");
  });
  els.clearButton.addEventListener("click", endSession);
  window.addEventListener("pagehide", () => {
    terminal("No active session");
    els.sessionInput.value = "";
  });
  clearContent();
  const session = new URL(window.location.href).searchParams.get("session");
  if (session !== null) start(session, "GET");
}

function modeLabel(mode) {
  return mode === "vllm" ? "vLLM" : mode === "rules" ? "Rules demo" : "Unknown mode";
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

if (typeof document !== "undefined") {
  mountDashboard({ window, document, fetch: window.fetch.bind(window), WebSocket: window.WebSocket });
}
