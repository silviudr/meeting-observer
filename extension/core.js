(function (root) {
  "use strict";
  const DEFAULTS = Object.freeze({ backendUrl: "http://localhost:8010", sessionId: "demo", captureEnabled: false });
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function validateSettings(input) {
    const url = new URL(input.backendUrl);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error("Use an HTTP localhost or 127.0.0.1 backend origin.");
    }
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.sessionId)) {
      throw new Error("Session ID needs 1-80 letters, digits, underscores or hyphens.");
    }
    return { backendUrl: url.origin, sessionId: input.sessionId, captureEnabled: input.captureEnabled === true };
  }

  function parseCaption(raw, explicitSpeaker = "") {
    // Preserve rendered line boundaries until the speaker has been separated.
    const lines = String(raw || "").split(/\r?\n/).map(normalize).filter(Boolean);
    let speaker = normalize(explicitSpeaker);
    let text = lines.join(" ");
    if (!speaker && lines.length > 1 && looksLikeSpeaker(lines[0])) {
      speaker = lines[0];
      text = lines.slice(1).join(" ");
    } else if (!speaker) {
      const match = text.match(/^([^:]{1,120}):\s+(.+)$/);
      if (match && looksLikeSpeaker(match[1])) { speaker = match[1]; text = match[2]; }
    }
    if (!speaker || speaker.length > 120 || !text || text.length > 10000) return null;
    return { speaker, text };
  }
  function looksLikeSpeaker(value) {
    return value.length <= 120 && !/[.!?]$/.test(value) && /^[\p{L}\p{N} .,'()\u2019-]+$/u.test(value);
  }
  function captionDelta(previous, next) {
    if (!previous) return next;
    if (next === previous || previous.startsWith(next)) return "";
    if (next.startsWith(previous)) {
      const rest = next.slice(previous.length);
      return /^[\s.,!?;:]/.test(rest) ? rest.replace(/^[\s.,!?;:]+/, "") : "";
    }
    const before = previous.split(" ");
    const after = next.split(" ");
    let shared = 0;
    while (shared < Math.min(before.length, after.length) && before[shared] === after[shared]) shared++;
    // Rewrites of delivered partials cannot retract the earlier backend event.
    if (shared >= Math.ceil(Math.min(before.length, after.length) / 2)) return "";
    return next;
  }

  class CaptionTracker {
    constructor({ stableMs = 900, limit = 64 } = {}) {
      this.stableMs = stableMs; this.limit = limit; this.rows = new Map();
    }
    clear() { this.rows.clear(); }
    update(candidates, now) {
      const output = [];
      const present = new Set();
      const commit = (row) => {
        const text = captionDelta(row.committed, row.text);
        if (text) output.push({ speaker: row.speaker, text });
        row.committed = row.text;
      };
      for (const candidate of candidates.slice(0, this.limit)) {
        const { key, speaker, text } = candidate;
        present.add(key);
        let row = this.rows.get(key);
        if (row && row.speaker !== speaker) { commit(row); row = null; }
        if (!row) {
          row = { speaker, text, changedAt: now, committed: "" };
          this.rows.set(key, row);
        } else if (row.text !== text) {
          if (captionDelta(row.text, text) === text) commit(row);
          row.text = text; row.changedAt = now;
        }
        if (now - row.changedAt >= this.stableMs) commit(row);
      }
      for (const [key, row] of this.rows) {
        if (!present.has(key)) { commit(row); this.rows.delete(key); }
      }
      return output;
    }
  }

  class SpeechChunker {
    constructor({ quietMs = 2500, maxGapMs = 10000, maxWords = 80 } = {}) {
      this.quietMs = quietMs; this.maxGapMs = maxGapMs; this.maxWords = maxWords;
      this.pending = null;
    }
    clear() { this.pending = null; }
    add(candidate, now) {
      const speaker = normalize(candidate?.speaker);
      const text = normalize(candidate?.text);
      if (!speaker || !text) return [];
      if (!this.pending) {
        this.pending = { speaker, text, updatedAt: now };
        return [];
      }
      if (this.pending.speaker === speaker && now - this.pending.updatedAt <= this.maxGapMs &&
          this.shouldMerge(this.pending.text, text)) {
        this.pending.text = `${this.pending.text} ${text}`.replace(/\s+/g, " ").trim();
        this.pending.updatedAt = now;
        return [];
      }
      const flushed = this.flush();
      this.pending = { speaker, text, updatedAt: now };
      return flushed;
    }
    flushDue(now) {
      return this.pending && now - this.pending.updatedAt >= this.quietMs ? this.flush() : [];
    }
    flush() {
      if (!this.pending) return [];
      const item = { speaker: this.pending.speaker, text: this.pending.text };
      this.pending = null;
      return [item];
    }
    shouldMerge(previous, next) {
      const previousWords = previous.split(/\s+/).filter(Boolean).length;
      const totalWords = previousWords + next.split(/\s+/).filter(Boolean).length;
      if (totalWords > this.maxWords) return false;
      if (previousWords <= 4) return true;
      if (/[,:;]$/.test(previous)) return true;
      if (/\b(and|or|but|because|that|about|whether|with|from|to|of|for|if|while)$/i.test(previous)) return true;
      if (/^(is|are|am|was|were|that|which|who|where|when|why|how|and|or|but|because|so|then|to|for|from|with|about|whether|if)\b/i.test(next)) return true;
      return false;
    }
  }

  class RetryQueue {
    constructor({ limit = 64, maxAgeMs = 120000, maxAttempts = 5 } = {}) {
      this.limit = limit; this.maxAgeMs = maxAgeMs; this.maxAttempts = maxAttempts;
      this.items = []; this.seen = new Set(); this.dropped = 0; this.generation = 0; this.busy = false;
    }
    clear() {
      this.generation++; this.items = []; this.seen.clear(); this.busy = false; this.dropped = 0;
    }
    add(event, now) {
      if (this.seen.has(event.client_event_id)) return true;
      if (this.items.length >= this.limit) { this.dropped++; return false; }
      this.seen.add(event.client_event_id);
      if (this.seen.size > this.limit * 4) this.seen.delete(this.seen.values().next().value);
      this.items.push({ event: { ...event }, createdAt: now, nextAt: now, attempts: 0 });
      return true;
    }
    async pump(send, now) {
      if (this.busy) return;
      while (this.items.length && now - this.items[0].createdAt >= this.maxAgeMs) {
        this.items.shift(); this.dropped++;
      }
      const item = this.items[0];
      if (!item || item.nextAt > now) return;
      const generation = this.generation;
      this.busy = true; item.attempts++;
      let result;
      try { result = await send(item.event); } catch { result = "retry"; }
      if (generation !== this.generation) return;
      this.busy = false;
      if (result === "ok") this.items.shift();
      else if (result === "drop" || item.attempts >= this.maxAttempts) { this.items.shift(); this.dropped++; }
      else item.nextAt = now + Math.min(30000, 1000 * 2 ** (item.attempts - 1));
    }
  }

  class CaptureController {
    constructor({ fetchFn, now = Date.now, uuid = () => crypto.randomUUID(), onChange = () => {},
      heartbeatMs = 30000, presenceMs = 90000, requestTimeoutMs = 8000 } = {}) {
      Object.assign(this, { fetchFn, now, uuid, onChange, heartbeatMs, presenceMs, requestTimeoutMs });
      this.config = { ...DEFAULTS }; this.token = ""; this.queue = new RetryQueue();
      this.requests = new Set(); this.epoch = this.uuid(); this.active = false;
      this.tabId = null; this.status = "Paused"; this.heartbeatBusy = false;
    }
    snapshot() {
      return { ...this.config, captureEnabled: this.active, epoch: this.epoch,
        tabId: this.tabId, status: this.status, queued: this.queue.items.length, dropped: this.queue.dropped };
    }
    publish() { this.onChange(this.snapshot()); }
    stop(status = "Paused") {
      this.epoch = this.uuid(); this.active = false; this.tabId = null;
      this.config.captureEnabled = false; this.queue.clear();
      for (const controller of this.requests) controller.abort();
      this.requests.clear(); this.heartbeatBusy = false; this.status = status; this.publish();
    }
    async request(path, body) {
      const controller = new AbortController();
      this.requests.add(controller);
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      const config = this.config;
      try {
        return await this.fetchFn(`${config.backendUrl}/api/sessions/${encodeURIComponent(config.sessionId)}${path}`, {
          method: "POST", signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error",
          headers: { "Content-Type": "application/json", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {})
        });
      } finally { clearTimeout(timeout); this.requests.delete(controller); }
    }
    terminal(response) {
      if ([404, 410, 401, 403].includes(response.status)) {
        this.stop(response.status === 410 ? "Session ended. Choose a new session ID." :
          response.status === 404 ? "Session unavailable. Start explicitly to continue." : "Authorization failed. Capture paused.");
        return true;
      }
      return false;
    }
    async start(input, token, tabId) {
      const config = validateSettings(input);
      this.stop("Connecting"); this.config = { ...config, captureEnabled: false };
      this.token = token; this.tabId = tabId;
      const epoch = this.epoch;
      this.publish();
      try {
        const response = await this.request("", null);
        if (epoch !== this.epoch || this.terminal(response)) return this.snapshot();
        if (!response.ok) throw new Error("connect");
        this.active = true; this.config.captureEnabled = true;
        this.lastPresentAt = this.now(); this.lastHeartbeatAt = this.now(); this.status = "Connected"; this.publish();
      } catch {
        if (epoch === this.epoch) this.stop("Backend unavailable. Start again to connect.");
      }
      return this.snapshot();
    }
    present(tabId, meetingPresent) {
      if (tabId !== this.tabId) return;
      if (!meetingPresent) { this.stop("Meeting left. Capture paused."); return; }
      this.lastPresentAt = this.now();
    }
    enqueue(event, tabId, epoch) {
      if (!this.active || tabId !== this.tabId || epoch !== this.epoch) return "stale";
      if (!event || typeof event.speaker !== "string" || !event.speaker.trim() || event.speaker.length > 120 ||
          typeof event.text !== "string" || !event.text.trim() || event.text.length > 10000 ||
          !/^[A-Za-z0-9_-]{1,120}$/.test(event.client_event_id || "") ||
          !Number.isSafeInteger(event.sequence) || event.sequence < 1 ||
          typeof event.timestamp !== "string" || !Number.isFinite(Date.parse(event.timestamp))) return "drop";
      const accepted = this.queue.add({ speaker: event.speaker, text: event.text,
        client_event_id: event.client_event_id, sequence: event.sequence,
        timestamp: event.timestamp, source: "google-meet-captions" }, this.now());
      this.publish();
      return accepted ? "ok" : "drop";
    }
    async tick() {
      if (!this.active) return;
      if (this.now() - this.lastPresentAt > this.presenceMs) { this.stop("Meeting tab unavailable. Capture paused."); return; }
      const epoch = this.epoch;
      const tasks = [];
      if (!this.heartbeatBusy && this.now() - this.lastHeartbeatAt >= this.heartbeatMs) {
        this.lastHeartbeatAt = this.now(); this.heartbeatBusy = true;
        tasks.push((async () => {
          try {
            const response = await this.request("/heartbeat", null);
            if (epoch !== this.epoch || this.terminal(response)) return;
            this.status = response.ok ? "Connected" : "Heartbeat failed; retrying";
          } catch { if (epoch === this.epoch) this.status = "Backend offline; retrying"; }
          finally { if (epoch === this.epoch) { this.heartbeatBusy = false; this.publish(); } }
        })());
      }
      tasks.push(this.queue.pump(async (event) => {
        try {
          const response = await this.request("/events", event);
          if (epoch !== this.epoch || this.terminal(response)) return "drop";
          if (response.ok) { this.status = "Connected"; return "ok"; }
          const retry = response.status >= 500 || [408, 429].includes(response.status);
          this.status = retry ? "Backend busy; retrying" : "Caption rejected";
          return retry ? "retry" : "drop";
        } catch {
          if (epoch === this.epoch) this.status = "Backend offline; retrying";
          return "retry";
        }
      }, this.now()));
      await Promise.allSettled(tasks);
      if (epoch === this.epoch) this.publish();
    }
  }
  const api = {
    DEFAULTS, normalize, validateSettings, parseCaption, captionDelta,
    CaptionTracker, SpeechChunker, RetryQueue, CaptureController,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MeetingObserver = api;
})(globalThis);
