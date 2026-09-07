/* global chrome, MeetingObserver */
(function () {
  "use strict";
  const core = typeof module !== "undefined" && module.exports ? require("./core.js") : MeetingObserver;
  const BADGE_ID = "meeting-observer-status";
  const REGION = '[jsname="dsyhDe"], .a4cQT, [data-caption-region], [role="region"][aria-label="Captions"]';
  const ROW = '.nMcdL, [data-caption-row]';
  const SPEAKER = '.NWpY1d, [data-speaker-name]';
  const TEXT = '.ygicle, [data-caption-text]';
  const UI = 'button, [role="button"], input, textarea, [role="dialog"], [role="menu"], [role="log"]';
  const LEAVE = 'button[aria-label], [role="button"][aria-label], button[data-tooltip], [role="button"][data-tooltip]';
  const CONTACT_STALE_MS = 90000;

  function ownNode(node) {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    return Boolean(el && (el.id === BADGE_ID || el.closest?.(`#${BADGE_ID}`)));
  }
  function relevantMutations(records) {
    return records.some((record) => {
      if (ownNode(record.target)) return false;
      if (record.type === "childList") {
        const nodes = [...record.addedNodes, ...record.removedNodes];
        if (nodes.length && nodes.every(ownNode)) return false;
      }
      return true;
    });
  }
  function isVisible(el, win) {
    const style = win.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 &&
      rect.width > 0 && rect.height > 0 && !el.closest('[aria-hidden="true"]');
  }
  function readCaptions(doc, win) {
    const candidates = [];
    const rows = new Set();
    for (const region of doc.querySelectorAll(REGION)) {
      const children = [...region.querySelectorAll(ROW)];
      if (children.length) children.forEach((row) => rows.add(row));
      else rows.add(region);
    }
    // Meet's established caption row signature also works without a region wrapper.
    for (const row of doc.querySelectorAll(ROW)) {
      if (row.querySelector(SPEAKER) && row.querySelector(TEXT)) rows.add(row);
    }
    for (const row of rows) {
      if (ownNode(row) || row.closest(UI) || row.querySelector(UI) || !isVisible(row, win)) continue;
      const speakerEl = row.querySelector(SPEAKER);
      const textEl = row.querySelector(TEXT);
      const parsed = speakerEl && textEl
        ? core.parseCaption(textEl.innerText || textEl.textContent, speakerEl.innerText || speakerEl.textContent)
        : core.parseCaption(row.innerText || row.textContent);
      if (parsed) candidates.push({ key: row, ...parsed });
      if (candidates.length >= 64) break;
    }
    return candidates;
  }
  function meetingPresent(doc, location) {
    if (!/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\/|$)/.test(location.pathname)) return false;
    for (const el of doc.querySelectorAll(LEAVE)) {
      const label = `${el.getAttribute?.("aria-label") || ""} ${el.getAttribute?.("data-tooltip") || ""}`;
      if (/\bleave\s+call\b/i.test(label)) return true;
    }
    return false;
  }

  function run() {
    const tracker = new core.CaptionTracker();
    const chunker = new core.SpeechChunker();
    const outbox = new core.RetryQueue();
    let state = { captureEnabled: false, epoch: null, status: "Paused" };
    let sequence = 0;
    let pulseBusy = false;
    let eventBusy = false;
    let scheduled = false;
    let lastContact = Date.now();
    const badge = document.createElement("div");
    badge.id = BADGE_ID;
    badge.setAttribute("aria-live", "off");
    Object.assign(badge.style, { position: "fixed", left: "12px", bottom: "12px",
      zIndex: "2147483647", background: "#17202a", color: "#ffffff", borderRadius: "6px",
      padding: "6px 9px", font: "12px system-ui, sans-serif", maxWidth: "calc(100vw - 48px)",
      pointerEvents: "none" });
    document.body.appendChild(badge);

    function paint() {
      const text = `Observer: ${state.status}${state.captureEnabled ? ` | ${state.sessionId}` : ""}`;
      if (badge.textContent !== text) badge.textContent = text;
    }
    function accept(next) {
      if (!next) return;
      if (next.epoch !== state.epoch || !next.captureEnabled) {
        tracker.clear(); chunker.clear(); outbox.clear(); sequence = 0;
      }
      state = next; lastContact = Date.now(); paint();
    }
    async function deliver() {
      if (eventBusy || !state.captureEnabled) return;
      eventBusy = true;
      const epoch = state.epoch;
      await outbox.pump(async (event) => {
        const reply = await chrome.runtime.sendMessage({ type: "observer:event", epoch, event });
        if (epoch !== state.epoch) return "drop";
        if (reply?.state) accept(reply.state);
        return reply?.result === "ok" ? "ok" : reply?.result === "drop" || reply?.result === "stale" ? "drop" : "retry";
      }, Date.now());
      eventBusy = false;
    }
    function scan() {
      scheduled = false;
      if (!state.captureEnabled) return;
      if (!meetingPresent(document, location) || Date.now() - lastContact > CONTACT_STALE_MS) {
        accept({ ...state, captureEnabled: false, status: "Capture paused" });
        return;
      }
      const now = Date.now();
      const chunks = [];
      for (const candidate of tracker.update(readCaptions(document, window), now)) {
        chunks.push(...chunker.add(candidate, now));
      }
      chunks.push(...chunker.flushDue(now));
      for (const candidate of chunks) {
        outbox.add({ ...candidate, timestamp: new Date().toISOString(), sequence: ++sequence,
          client_event_id: crypto.randomUUID(), source: "google-meet-captions" }, now);
      }
      void deliver();
    }
    async function pulse() {
      if (pulseBusy) return;
      pulseBusy = true;
      try {
        const reply = await chrome.runtime.sendMessage({ type: "observer:pulse",
          meetingPresent: meetingPresent(document, location) });
        if (reply?.state) accept(reply.state);
      } catch {
        accept({ ...state, captureEnabled: false, status: "Extension disconnected. Start again." });
      } finally { pulseBusy = false; }
    }
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      if (message.type === "observer:probe") respond({ meetingPresent: meetingPresent(document, location) });
      if (message.type === "observer:state") accept(message.state);
    });
    const observer = new MutationObserver((records) => {
      if (!scheduled && state.captureEnabled && relevantMutations(records)) {
        scheduled = true; window.setTimeout(scan, 100);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("visibilitychange", () => { void pulse(); scan(); });
    window.setInterval(() => { void pulse(); scan(); }, 600);
    window.addEventListener("pagehide", () => {
      tracker.clear(); chunker.clear(); outbox.clear();
      void chrome.runtime.sendMessage({ type: "observer:pulse", meetingPresent: false }).catch(() => {});
    });
    paint(); void pulse();
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { ownNode, relevantMutations, readCaptions, meetingPresent, REGION, ROW, SPEAKER, TEXT, LEAVE };
  } else run();
})();
