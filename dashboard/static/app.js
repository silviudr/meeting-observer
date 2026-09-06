const state = {
  sessionId: localStorage.getItem("meetingObserverSession") || "demo",
  socket: null,
  snapshot: null,
};

const els = {
  form: document.querySelector("#sessionForm"),
  sessionInput: document.querySelector("#sessionInput"),
  statusText: document.querySelector("#statusText"),
  lineCount: document.querySelector("#lineCount"),
  participantCount: document.querySelector("#participantCount"),
  insightCount: document.querySelector("#insightCount"),
  transcriptList: document.querySelector("#transcriptList"),
  insightsList: document.querySelector("#insightsList"),
  modelMode: document.querySelector("#modelMode"),
  clearButton: document.querySelector("#clearButton"),
};

els.sessionInput.value = state.sessionId;

function wsUrl(sessionId) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/dashboard/${encodeURIComponent(sessionId)}`;
}

async function loadHealth() {
  try {
    const response = await fetch("/health");
    const health = await response.json();
    els.modelMode.textContent = health.model_mode;
  } catch {
    els.modelMode.textContent = "offline";
  }
}

function connect(sessionId) {
  if (state.socket) {
    state.socket.close();
  }

  state.sessionId = sessionId;
  localStorage.setItem("meetingObserverSession", sessionId);
  els.statusText.textContent = `Connecting to ${sessionId}`;

  const socket = new WebSocket(wsUrl(sessionId));
  state.socket = socket;

  socket.addEventListener("open", () => {
    els.statusText.textContent = `Connected to ${sessionId}`;
  });

  socket.addEventListener("message", (event) => {
    state.snapshot = JSON.parse(event.data);
    render();
  });

  socket.addEventListener("close", () => {
    if (state.socket === socket) {
      els.statusText.textContent = "Disconnected";
      window.setTimeout(() => connect(state.sessionId), 2000);
    }
  });

  socket.addEventListener("error", () => {
    els.statusText.textContent = "Connection error";
  });
}

function render() {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return;
  }

  els.lineCount.textContent = snapshot.transcript.length;
  els.participantCount.textContent = snapshot.participants.length;
  els.insightCount.textContent = snapshot.insights.length;
  renderTranscript(snapshot.transcript);
  renderInsights(snapshot.insights);
}

function renderTranscript(transcript) {
  if (!transcript.length) {
    els.transcriptList.innerHTML = `<li class="empty">Waiting for captions.</li>`;
    return;
  }

  els.transcriptList.innerHTML = transcript
    .slice(-120)
    .map((event) => {
      const when = new Date(event.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      return `
        <li class="transcript-line">
          <div>
            <span class="speaker">${escapeHtml(event.speaker)}</span>
            <span class="time">${when}</span>
          </div>
          <div class="utterance">${escapeHtml(event.text)}</div>
        </li>
      `;
    })
    .join("");

  els.transcriptList.scrollTop = els.transcriptList.scrollHeight;
}

function renderInsights(insights) {
  if (!insights.length) {
    els.insightsList.innerHTML = `<div class="empty">Waiting for enough signal.</div>`;
    return;
  }

  els.insightsList.innerHTML = insights
    .map((insight) => {
      const evidence = insight.evidence
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("");
      return `
        <article class="insight">
          <div class="insight-top">
            <div>
              <strong>${escapeHtml(insight.speaker)}</strong>
              <div class="intent-label">${escapeHtml(formatLabel(insight.intent_label))}</div>
            </div>
            <span class="confidence">${Math.round(insight.confidence * 100)}%</span>
          </div>
          <p class="hypothesis">${escapeHtml(insight.hypothesis)}</p>
          <ul class="evidence">${evidence}</ul>
          <p class="move">${escapeHtml(insight.suggested_user_move)}</p>
        </article>
      `;
    })
    .join("");
}

function formatLabel(label) {
  return label.replaceAll("_", " ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const sessionId = els.sessionInput.value.trim() || "demo";
  connect(sessionId);
});

els.clearButton.addEventListener("click", async () => {
  await fetch(`/api/sessions/${encodeURIComponent(state.sessionId)}`, { method: "DELETE" });
  state.snapshot = null;
  renderTranscript([]);
  renderInsights([]);
  els.lineCount.textContent = "0";
  els.participantCount.textContent = "0";
  els.insightCount.textContent = "0";
});

loadHealth();
connect(state.sessionId);
