const DEFAULT_CONFIG = {
  backendUrl: "http://localhost:8010",
  sessionId: "demo",
  captureEnabled: true
};

const CAPTION_SCAN_INTERVAL_MS = 600;
const STABLE_UTTERANCE_MS = 900;
const RECENT_CACHE_LIMIT = 80;

let config = { ...DEFAULT_CONFIG };
let sequence = 0;
let pending = null;
let lastCandidateKey = "";
let recentSent = [];
let statusEl = null;

chrome.storage.local.get(DEFAULT_CONFIG, (stored) => {
  config = { ...DEFAULT_CONFIG, ...stored };
  start();
});

chrome.storage.onChanged.addListener((changes) => {
  for (const [key, change] of Object.entries(changes)) {
    config[key] = change.newValue;
  }
  updateStatus();
});

function start() {
  ensureStatus();
  updateStatus();
  const observer = new MutationObserver(scanCaptions);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.setInterval(scanCaptions, CAPTION_SCAN_INTERVAL_MS);
}

function scanCaptions() {
  if (!config.captureEnabled) {
    updateStatus("paused");
    return;
  }

  const candidate = findCaptionCandidate();
  if (!candidate) {
    updateStatus("captions off");
    return;
  }

  const key = `${candidate.speaker}\n${candidate.text}`;
  const now = Date.now();

  if (key !== lastCandidateKey) {
    pending = { ...candidate, firstSeenAt: now, lastSeenAt: now };
    lastCandidateKey = key;
    updateStatus("listening");
    return;
  }

  if (!pending) {
    return;
  }

  pending.lastSeenAt = now;
  if (now - pending.firstSeenAt >= STABLE_UTTERANCE_MS) {
    sendUtterance(pending);
    pending = null;
  }
}

function findCaptionCandidate() {
  const candidates = [
    ...document.querySelectorAll('[aria-live="polite"], [role="status"], [data-message-text]'),
    ...visibleLowerPageBlocks()
  ];

  let best = null;
  for (const el of candidates) {
    const parsed = parseCaptionElement(el);
    if (!parsed) {
      continue;
    }
    if (!best || parsed.text.length > best.text.length) {
      best = parsed;
    }
  }
  return best;
}

function visibleLowerPageBlocks() {
  const blocks = [];
  const viewportHeight = window.innerHeight || 1;
  for (const el of document.querySelectorAll("div")) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 16) {
      continue;
    }
    if (rect.top < viewportHeight * 0.42) {
      continue;
    }
    if (!isVisible(el)) {
      continue;
    }
    const text = normalizeText(el.innerText || "");
    if (text.length >= 4 && text.length <= 600) {
      blocks.push(el);
    }
  }
  return blocks.slice(-40);
}

function parseCaptionElement(el) {
  if (!isVisible(el)) {
    return null;
  }

  const raw = normalizeText(el.innerText || el.textContent || "");
  if (!raw || raw.length < 4 || raw.length > 600) {
    return null;
  }
  if (looksLikeMeetChrome(raw)) {
    return null;
  }

  const lines = raw
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean);

  if (!lines.length) {
    return null;
  }

  let speaker = "Unknown";
  let text = raw;

  if (lines.length >= 2 && looksLikeSpeaker(lines[0])) {
    speaker = lines[0];
    text = lines.slice(1).join(" ");
  } else {
    const colonMatch = raw.match(/^([A-Z][^:]{1,60}):\s+(.+)$/);
    if (colonMatch) {
      speaker = colonMatch[1].trim();
      text = colonMatch[2].trim();
    }
  }

  text = normalizeText(text);
  if (!text || looksLikeMeetChrome(text)) {
    return null;
  }

  return { speaker, text };
}

function looksLikeSpeaker(value) {
  if (value.length > 80) {
    return false;
  }
  if (/[.!?]$/.test(value)) {
    return false;
  }
  return /^[\p{L}\p{N} .,'-]+$/u.test(value);
}

function looksLikeMeetChrome(value) {
  const lower = value.toLowerCase();
  const blocked = [
    "turn on captions",
    "turn off captions",
    "present now",
    "raise hand",
    "more options",
    "meeting details",
    "show everyone",
    "chat with everyone",
    "leave call",
    "microphone",
    "camera"
  ];
  return blocked.some((term) => lower.includes(term));
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function isVisible(el) {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

async function sendUtterance(candidate) {
  const event = {
    speaker: candidate.speaker,
    text: candidate.text,
    timestamp: new Date().toISOString(),
    source: "google-meet-captions",
    sequence: ++sequence
  };

  const dedupeKey = `${event.speaker}\n${event.text}`;
  if (recentSent.includes(dedupeKey)) {
    return;
  }
  recentSent.push(dedupeKey);
  recentSent = recentSent.slice(-RECENT_CACHE_LIMIT);

  try {
    const response = await fetch(
      `${config.backendUrl.replace(/\/$/, "")}/api/sessions/${encodeURIComponent(config.sessionId)}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event)
      }
    );
    updateStatus(response.ok ? "capturing" : "backend error");
  } catch {
    updateStatus("backend offline");
  }
}

function ensureStatus() {
  if (statusEl) {
    return;
  }

  statusEl = document.createElement("div");
  statusEl.id = "meeting-observer-status";
  Object.assign(statusEl.style, {
    position: "fixed",
    left: "12px",
    bottom: "12px",
    zIndex: "2147483647",
    background: "#17202a",
    color: "#ffffff",
    border: "1px solid rgba(255, 255, 255, 0.18)",
    borderRadius: "8px",
    padding: "6px 9px",
    font: "12px system-ui, sans-serif",
    boxShadow: "0 8px 18px rgba(0, 0, 0, 0.24)"
  });
  document.body.appendChild(statusEl);
}

function updateStatus(status = null) {
  ensureStatus();
  const enabled = config.captureEnabled ? "on" : "off";
  statusEl.textContent = `Observer ${enabled}: ${status || "ready"} -> ${config.sessionId}`;
}
