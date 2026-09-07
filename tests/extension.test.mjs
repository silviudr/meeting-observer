import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 16; i += 1) await Promise.resolve(); };

// core.js and popup.js are classic scripts that attach to globalThis when the
// CommonJS `module` is absent, which is the case for an ES-module import.
await import(dataUrl(await read("../extension/core.js")));
await import(dataUrl(await read("../extension/popup.js")));
const core = globalThis.MeetingObserver;
const { mountPopup } = globalThis.MeetingObserverPopup;

// content.js exports only under CommonJS detection; provide shims and re-export.
const content = (await import(dataUrl(
  "const module = { exports: {} };\nconst require = () => globalThis.MeetingObserver;\n"
  + await read("../extension/content.js")
  + "\nexport default module.exports;"
))).default;

assert.ok(core, "core.js must expose MeetingObserver");
assert.equal(typeof mountPopup, "function", "popup.js must expose mountPopup");
assert.ok(content.readCaptions, "content.js must export readCaptions");

const settings = { backendUrl: "http://localhost:8010", sessionId: "demo", captureEnabled: true };
const caption = (id) => ({
  speaker: "Maria", text: "Can we decide today?", client_event_id: id,
  sequence: 1, timestamp: "2026-09-07T12:00:00.000Z",
});

test("validateSettings accepts only loopback HTTP backends and ASCII session IDs", () => {
  assert.deepEqual(
    core.validateSettings({ backendUrl: "http://localhost:8010", sessionId: "demo", captureEnabled: false }),
    { backendUrl: "http://localhost:8010", sessionId: "demo", captureEnabled: false },
  );
  assert.deepEqual(
    core.validateSettings({ backendUrl: "http://127.0.0.1:8020/", sessionId: "Live_Meeting-1", captureEnabled: true }),
    { backendUrl: "http://127.0.0.1:8020", sessionId: "Live_Meeting-1", captureEnabled: true },
  );
  for (const backendUrl of [
    "https://localhost:8010", "http://example.com", "http://localhost:8010/path",
    "http://localhost:8010/?session=demo", "http://user:pw@localhost:8010", "ftp://localhost",
  ]) {
    assert.throws(() => core.validateSettings({ backendUrl, sessionId: "demo", captureEnabled: false }), /backend origin/);
  }
  assert.throws(() => core.validateSettings({ backendUrl: "http://localhost:8010", sessionId: "has space", captureEnabled: false }), /Session ID/);
});

test("parseCaption preserves multiline and colon speaker attribution", () => {
  assert.deepEqual(core.parseCaption("Maria\nCan we decide today?"), { speaker: "Maria", text: "Can we decide today?" });
  assert.deepEqual(core.parseCaption("Maria: Can we decide today?"), { speaker: "Maria", text: "Can we decide today?" });
  assert.deepEqual(core.parseCaption("Maria:\nCan we decide today?"), { speaker: "Maria", text: "Can we decide today?" });
  assert.deepEqual(core.parseCaption("   Søren Ø \n Hej med dig "), { speaker: "Søren Ø", text: "Hej med dig" });
  assert.deepEqual(core.parseCaption("Any text", "Priya"), { speaker: "Priya", text: "Any text" });
});

test("parseCaption rejects rows that are not attributable speech", () => {
  assert.equal(core.parseCaption(""), null);
  assert.equal(core.parseCaption("Maria.\nHello"), null); // sentence punctuation: not a speaker line
  assert.equal(core.parseCaption("Just talking with no speaker"), null);
  assert.equal(core.parseCaption("x".repeat(10001), "Maria"), null);
});

test("captionDelta emits only new stable growth from partials", () => {
  assert.equal(core.captionDelta("", "Can we"), "Can we");
  assert.equal(core.captionDelta("Can we", "Can we"), "");
  assert.equal(core.captionDelta("Can we decide", "Can we"), ""); // contraction
  assert.equal(core.captionDelta("Can we", "Can we decide today"), "decide today");
  assert.equal(core.captionDelta("Can we, decide", "Can we, decide today"), "today");
  assert.equal(core.captionDelta("Can", "Candle"), ""); // no separator: word grew, not a new word
  assert.equal(core.captionDelta("Let's ship it now", "Let's ship it today"), ""); // correction of delivered text
  assert.equal(core.captionDelta("First complete line", "Completely different words"), "Completely different words");
});

test("CaptionTracker stabilizes partials into one final utterance", () => {
  const tracker = new core.CaptionTracker({ stableMs: 900, limit: 8 });
  const key = {};
  assert.deepEqual(tracker.update([{ key, speaker: "Maria", text: "Can we" }], 1000), []);
  assert.deepEqual(tracker.update([{ key, speaker: "Maria", text: "Can we decide" }], 1400), []);
  assert.deepEqual(tracker.update([{ key, speaker: "Maria", text: "Can we decide today" }], 1800), []);
  assert.deepEqual(
    tracker.update([{ key, speaker: "Maria", text: "Can we decide today" }], 2700),
    [{ speaker: "Maria", text: "Can we decide today" }],
  );
  // Committed text is never re-sent...
  assert.deepEqual(tracker.update([{ key, speaker: "Maria", text: "Can we decide today" }], 4000), []);
  // ...but the tail of a late partial still arrives when the row disappears.
  tracker.update([{ key, speaker: "Maria", text: "Can we decide today please" }], 4200);
  assert.deepEqual(tracker.update([], 6000), [{ speaker: "Maria", text: "please" }]);
});

test("CaptionTracker commits the old speaker's row when the speaker changes", () => {
  const tracker = new core.CaptionTracker({ stableMs: 900 });
  const key = {};
  assert.deepEqual(tracker.update([{ key, speaker: "Maria", text: "Hello" }], 1000), []);
  assert.deepEqual(
    tracker.update([{ key, speaker: "Dan", text: "Hi" }], 1100),
    [{ speaker: "Maria", text: "Hello" }],
  );
  assert.deepEqual(tracker.update([{ key, speaker: "Dan", text: "Hi" }], 2100), [{ speaker: "Dan", text: "Hi" }]);
});

test("SpeechChunker merges obvious same-speaker caption fragments", () => {
  const chunker = new core.SpeechChunker({ quietMs: 2500, maxGapMs: 10000 });
  assert.deepEqual(chunker.add({ speaker: "You", text: "My concern." }, 0), []);
  assert.deepEqual(chunker.add({ speaker: "You", text: "Is that we may not have enough evidence." }, 8000), []);
  assert.deepEqual(chunker.flushDue(11000), [
    { speaker: "You", text: "My concern. Is that we may not have enough evidence." },
  ]);
});

test("SpeechChunker separates complete thoughts and speaker changes", () => {
  const chunker = new core.SpeechChunker({ quietMs: 2500, maxGapMs: 10000 });
  assert.deepEqual(chunker.add({ speaker: "You", text: "I want to make a decision today." }, 0), []);
  assert.deepEqual(chunker.add({ speaker: "You", text: "My concern." }, 3000), [
    { speaker: "You", text: "I want to make a decision today." },
  ]);
  assert.deepEqual(chunker.add({ speaker: "Alex", text: "I need more data." }, 4000), [
    { speaker: "You", text: "My concern." },
  ]);
  assert.deepEqual(chunker.flushDue(7000), [{ speaker: "Alex", text: "I need more data." }]);
});

test("RetryQueue dedupes transport retries and bounds pending items", () => {
  const queue = new core.RetryQueue({ limit: 2, maxAgeMs: 120000, maxAttempts: 3 });
  const event = (id) => ({ ...caption(id) });
  assert.equal(queue.add(event("e1"), 0), true);
  assert.equal(queue.add(event("e1"), 0), true); // already known: not queued twice
  assert.equal(queue.items.length, 1);
  assert.equal(queue.add(event("e2"), 0), true);
  assert.equal(queue.add(event("e3"), 0), false); // over the pending limit
  assert.equal(queue.dropped, 1);
  assert.equal(queue.items.length, 2);
});

test("RetryQueue retries transient failures with backoff, then drops after max attempts", async () => {
  const queue = new core.RetryQueue({ limit: 8, maxAgeMs: 120000, maxAttempts: 3 });
  queue.add(caption("e1"), 0);
  const sent = [];
  let now = 0;
  await queue.pump(() => { sent.push(1); return "retry"; }, now);
  assert.equal(sent.length, 1);
  assert.equal(queue.items.length, 1);
  await queue.pump(() => { sent.push(1); return "retry"; }, now); // backoff: not due yet
  assert.equal(sent.length, 1);
  now = 1000;
  await queue.pump(() => { sent.push(1); return "retry"; }, now);
  assert.equal(sent.length, 2);
  now = 3000;
  await queue.pump(() => { sent.push(1); return "retry"; }, now);
  assert.equal(sent.length, 3);
  assert.equal(queue.items.length, 0);
  assert.equal(queue.dropped, 1);
});

test("RetryQueue drops stale events and discards results cleared mid-flight", async () => {
  const queue = new core.RetryQueue({ limit: 8, maxAgeMs: 60000, maxAttempts: 5 });
  queue.add(caption("old"), 0);
  let sends = 0;
  await queue.pump(() => { sends += 1; return "ok"; }, 61000);
  assert.equal(sends, 0); // aged out before sending
  assert.equal(queue.dropped, 1);

  queue.add(caption("e2"), 0);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const inFlight = queue.pump(() => gate, 0);
  queue.clear(); // session end clears pending work mid-delivery
  release();
  await inFlight;
  assert.equal(queue.busy, false);
  assert.equal(queue.items.length, 0);

  queue.add(caption("e3"), 0);
  await queue.pump(() => "ok", 0);
  assert.equal(queue.items.length, 0); // cleared state still delivers new work
});

test("CaptureController starts a session and delivers a caption with auth and stable identity", async () => {
  const calls = [];
  let now = 1000;
  const controller = new core.CaptureController({
    fetchFn: async (url, options) => {
      calls.push({ path: new URL(url).pathname, options });
      return { ok: true, status: 200 };
    },
    now: () => now, uuid: () => "u-1", heartbeatMs: 30000, presenceMs: 60000,
  });
  const state = await controller.start({ ...settings }, "secret", 7);
  assert.equal(state.captureEnabled, true);
  assert.equal(controller.active, true);
  assert.equal(calls[0].path, "/api/sessions/demo");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret");

  assert.equal(controller.enqueue(caption("evt-1"), 7, controller.epoch), "ok");
  assert.equal(controller.enqueue(caption("evt-1"), 7, controller.epoch), "ok"); // same id: already known
  assert.equal(controller.queue.items.length, 1);
  now += 50;
  await controller.tick();
  const delivery = calls.find((call) => call.path === "/api/sessions/demo/events");
  assert.ok(delivery, "event must be delivered");
  assert.deepEqual(JSON.parse(delivery.options.body), { ...caption("evt-1"), source: "google-meet-captions" });
  assert.equal(controller.queue.items.length, 0);
});

test("CaptureController retries transient event failures without losing the caption", async () => {
  let now = 0;
  let deliveries = 0;
  const controller = new core.CaptureController({
    fetchFn: async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/events")) {
        deliveries += 1;
        return deliveries >= 3 ? { ok: true, status: 200 } : { ok: false, status: 503 };
      }
      return { ok: true, status: 200 };
    },
    now: () => now, uuid: () => "u-1", heartbeatMs: 100000, presenceMs: 60000,
  });
  await controller.start({ ...settings }, "", 7);
  controller.enqueue(caption("evt-2"), 7, controller.epoch);
  await controller.tick(); // 503 -> retry
  assert.equal(deliveries, 1);
  assert.equal(controller.queue.items.length, 1);
  assert.equal(controller.status, "Backend busy; retrying");
  now += 1000;
  await controller.tick(); // 503 -> retry
  assert.equal(deliveries, 2);
  assert.equal(controller.active, true);
  now += 2000;
  await controller.tick(); // delivered
  assert.equal(deliveries, 3);
  assert.equal(controller.queue.items.length, 0);
  assert.equal(controller.status, "Connected");
});

test("terminal session responses stop capture and clear pending captions", async () => {
  let now = 0;
  let heartbeats = 0;
  const controller = new core.CaptureController({
    fetchFn: async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/heartbeat")) {
        heartbeats += 1;
        return heartbeats === 1 ? { ok: true, status: 200 } : { ok: false, status: 404 };
      }
      if (path.endsWith("/events")) return { ok: false, status: 503 }; // keep the item queued
      return { ok: true, status: 200 };
    },
    now: () => now, uuid: () => "u-1", heartbeatMs: 100, presenceMs: 60000,
  });
  await controller.start({ ...settings }, "", 7);
  controller.enqueue(caption("evt-3"), 7, controller.epoch);
  now += 100;
  await controller.tick(); // heartbeat ok + event retry
  assert.equal(controller.active, true);
  assert.equal(controller.queue.items.length, 1);
  now += 100;
  await controller.tick(); // heartbeat 404 -> terminal
  assert.equal(heartbeats, 2);
  assert.equal(controller.active, false);
  assert.match(controller.status, /Start explicitly/);
  assert.equal(controller.queue.items.length, 0);
  assert.equal(controller.enqueue(caption("evt-4"), 7, controller.epoch), "stale");
});

test("capture pauses when the meeting presence signal disappears", async () => {
  let now = 0;
  const first = new core.CaptureController({
    fetchFn: async () => ({ ok: true, status: 200 }),
    now: () => now, uuid: () => "u-1", heartbeatMs: 1000, presenceMs: 10000,
  });
  await first.start({ ...settings }, "", 7);
  now += 5000;
  first.present(7, false);
  assert.equal(first.active, false);
  assert.match(first.status, /Meeting left/);

  const second = new core.CaptureController({
    fetchFn: async () => ({ ok: true, status: 200 }),
    now: () => now, uuid: () => "u-2", heartbeatMs: 1000, presenceMs: 10000,
  });
  await second.start({ ...settings }, "", 9);
  now += 20000; // no presence pulses from the content script
  await second.tick();
  assert.equal(second.active, false);
  assert.match(second.status, /Meeting tab unavailable/);
});

test("enqueue validates shape, epoch, and tab before accepting captions", async () => {
  const controller = new core.CaptureController({
    fetchFn: async () => ({ ok: true, status: 200 }),
    now: () => 0, uuid: () => "u-1", heartbeatMs: 100000, presenceMs: 60000,
  });
  await controller.start({ ...settings }, "", 7);
  const epoch = controller.epoch;
  assert.equal(controller.enqueue(caption("ok-1"), 7, epoch), "ok");
  assert.equal(controller.enqueue(caption("ok-1"), 8, epoch), "stale"); // different tab
  assert.equal(controller.enqueue(caption("ok-2"), 7, "stale-epoch"), "stale");
  const malformed = [
    { ...caption("bad"), speaker: "" },
    { ...caption("bad"), speaker: "x".repeat(121) },
    { ...caption("bad"), text: "   " },
    { ...caption("bad"), text: "x".repeat(10001) },
    { ...caption("bad"), client_event_id: "" },
    { ...caption("bad"), client_event_id: "not one token" },
    { ...caption("bad"), client_event_id: "x".repeat(121) },
    { ...caption("bad"), sequence: 0 },
    { ...caption("bad"), sequence: 1.5 },
    { ...caption("bad"), timestamp: "yesterday" },
  ];
  for (const bad of malformed) assert.equal(controller.enqueue(bad, 7, epoch), "drop");
  assert.equal(controller.queue.items.length, 1);
});

class PopupElement {
  constructor() { this.listeners = new Map(); }
  value = "";
  textContent = "";
  disabled = false;
  checked = false;
  addEventListener(type, callback) {
    const list = this.listeners.get(type) || [];
    list.push(callback);
    this.listeners.set(type, list);
  }
  emit(type, event = {}) {
    for (const callback of this.listeners.get(type) || []) callback(event);
  }
}

function popupHarness({ getState = { state: null, accessToken: "" }, configureReply = { state: null }, tabs = [{ id: 42 }] } = {}) {
  const elements = {};
  const sent = [];
  const broadcastListeners = [];
  const document = {
    activeElement: null,
    querySelector: (selector) => elements[selector.slice(1)] ||= new PopupElement(),
  };
  const chromeApi = {
    runtime: {
      onMessage: { addListener: (fn) => broadcastListeners.push(fn) },
      sendMessage: (message) => {
        sent.push(message);
        return Promise.resolve(message.type === "observer:get" ? getState : configureReply);
      },
    },
    tabs: { query: async () => tabs },
  };
  mountPopup({ chrome: chromeApi, document, validateSettings: core.validateSettings });
  return {
    elements, sent,
    broadcast(state) { for (const fn of broadcastListeners) fn({ type: "observer:state", state }); },
    async apply() {
      elements.settingsForm.emit("submit", { preventDefault() {} });
      await flush();
      await flush();
    },
  };
}

test("popup loads worker state and session-held token without storage access", async () => {
  const h = popupHarness({ getState: { state: { backendUrl: "http://localhost:8010", sessionId: "demo", captureEnabled: true, status: "Connected", queued: 0, dropped: 0 }, accessToken: "session-token" } });
  await flush();
  assert.deepEqual(h.sent.map((m) => m.type), ["observer:get"]);
  assert.equal(h.elements.backendUrl.value, "http://localhost:8010");
  assert.equal(h.elements.sessionId.value, "demo");
  assert.equal(h.elements.accessToken.value, "session-token");
  assert.equal(h.elements.captureEnabled.checked, true);
  assert.equal(h.elements.save.textContent, "Start capture");
  assert.match(h.elements.status.textContent, /Connected/);
});

test("Apply sends validated settings with the active tab when capture is enabled", async () => {
  const h = popupHarness({ configureReply: { state: { backendUrl: "http://localhost:8010", sessionId: "live-1", captureEnabled: true, status: "Connected", queued: 0, dropped: 0 } } });
  await flush();
  h.elements.backendUrl.value = "http://localhost:8010";
  h.elements.sessionId.value = "live-1";
  h.elements.accessToken.value = "secret";
  h.elements.captureEnabled.checked = true;
  await h.apply();
  assert.deepEqual(h.sent[1], {
    type: "observer:configure",
    settings: { backendUrl: "http://localhost:8010", sessionId: "live-1", captureEnabled: true },
    accessToken: "secret",
    tabId: 42,
  });
  assert.equal(h.elements.save.disabled, false);
  assert.equal(h.elements.save.textContent, "Start capture");
  assert.match(h.elements.status.textContent, /Connected/);
});

test("Apply without capture configures settings and leaves the tab alone", async () => {
  const h = popupHarness({ configureReply: { state: { backendUrl: "http://localhost:8010", sessionId: "demo", captureEnabled: false, status: "Paused" } } });
  await flush();
  h.elements.backendUrl.value = "http://127.0.0.1:8010";
  h.elements.sessionId.value = "demo";
  h.elements.captureEnabled.checked = false;
  await h.apply();
  assert.equal(h.sent[1].tabId, null);
  assert.equal(h.sent[1].settings.captureEnabled, false);
  assert.equal(h.elements.save.textContent, "Save paused");
});

test("starting capture without an active tab explains the prerequisite", async () => {
  const h = popupHarness({ tabs: [] });
  await flush();
  h.elements.backendUrl.value = "http://localhost:8010";
  h.elements.sessionId.value = "live-1";
  h.elements.captureEnabled.checked = true;
  await h.apply();
  assert.equal(h.sent.length, 1); // no configure message was sent
  assert.match(h.elements.status.textContent, /Open the Google Meet call tab/);
});

test("invalid settings stop locally with the validator's message", async () => {
  const h = popupHarness();
  await flush();
  h.elements.backendUrl.value = "https://example.com";
  h.elements.sessionId.value = "demo";
  h.elements.captureEnabled.checked = false;
  await h.apply();
  assert.equal(h.sent.length, 1);
  assert.match(h.elements.status.textContent, /backend origin/);
});

test("worker state broadcasts refresh the popup without new requests", async () => {
  const h = popupHarness();
  await flush();
  assert.equal(h.sent.length, 1);
  h.broadcast({ status: "Backend offline; retrying", captureEnabled: true, sessionId: "demo", queued: 2, dropped: 0 });
  assert.match(h.elements.status.textContent, /Backend offline/);
  assert.match(h.elements.status.textContent, /2 queued/);
  assert.equal(h.elements.captureEnabled.checked, true);
  assert.equal(h.sent.length, 1);
});

test("a missing content script gets a reload hint; other errors pass through", async () => {
  const missing = popupHarness({ configureReply: { error: "Could not establish connection. Receiving end does not exist." } });
  await flush();
  missing.elements.backendUrl.value = "http://localhost:8010";
  missing.elements.sessionId.value = "live-1";
  missing.elements.captureEnabled.checked = true;
  await missing.apply();
  assert.match(missing.elements.status.textContent, /Reload the Google Meet tab/);

  const meet = popupHarness({ configureReply: { error: "Join the Google Meet call before starting." } });
  await flush();
  meet.elements.backendUrl.value = "http://localhost:8010";
  meet.elements.sessionId.value = "live-1";
  meet.elements.captureEnabled.checked = true;
  await meet.apply();
  assert.match(meet.elements.status.textContent, /Join the Google Meet call/);
});

function makeNode({ text = "", matches = {}, lists = {}, hiddenStyle = false } = {}) {
  return {
    innerText: text,
    textContent: text,
    hiddenStyle,
    closest: () => null,
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    querySelector: (selector) => matches[selector] ?? null,
    querySelectorAll: (selector) => lists[selector] ?? [],
  };
}

test("readCaptions attributes rows via speaker elements and the colon fallback", () => {
  const win = {
    getComputedStyle: (el) => el.hiddenStyle
      ? { display: "none", visibility: "visible", opacity: "1" }
      : { display: "block", visibility: "visible", opacity: "1" },
  };
  const attributed = makeNode({
    matches: { [content.SPEAKER]: makeNode({ text: "Maria" }), [content.TEXT]: makeNode({ text: "Can we decide today?" }) },
  });
  const colonRow = makeNode({ text: "Priya: Can we agree on the date?" });
  const hiddenRow = makeNode({
    text: "Dan: Hidden while captions are off",
    matches: { [content.SPEAKER]: makeNode({ text: "Dan" }), [content.TEXT]: makeNode({ text: "Hidden while captions are off" }) },
    hiddenStyle: true,
  });
  const region = makeNode({ lists: { [content.ROW]: [attributed, colonRow, hiddenRow] } });
  const doc = makeNode({ lists: { [content.REGION]: [region] } });

  const candidates = content.readCaptions(doc, win);

  assert.deepEqual(candidates.map(({ speaker, text }) => ({ speaker, text })), [
    { speaker: "Maria", text: "Can we decide today?" },
    { speaker: "Priya", text: "Can we agree on the date?" },
  ]);
  assert.ok(candidates.every(({ key }) => key === attributed || key === colonRow));
});

test("meetingPresent requires a Meet meeting path and a leave-call control", () => {
  const leave = makeNode({});
  leave.getAttribute = (name) => name === "aria-label" ? "Leave call (Ctrl+Alt+H)" : "";
  const tooltipLeave = makeNode({});
  tooltipLeave.getAttribute = (name) => name === "data-tooltip" ? "Leave call" : "";
  const unrelated = makeNode({});
  unrelated.getAttribute = () => "Turn on captions";
  const inCall = makeNode({ lists: { [content.LEAVE]: [unrelated, leave] } });
  const tooltipInCall = makeNode({ lists: { [content.LEAVE]: [tooltipLeave] } });
  const notInCall = makeNode({});
  assert.equal(content.meetingPresent(inCall, { pathname: "/abc-defg-hij" }), true);
  assert.equal(content.meetingPresent(tooltipInCall, { pathname: "/abc-defg-hij" }), true);
  assert.equal(content.meetingPresent(inCall, { pathname: "/abc-defg-hij/popup" }), true);
  assert.equal(content.meetingPresent(inCall, { pathname: "/settings" }), false);
  assert.equal(content.meetingPresent(notInCall, { pathname: "/abc-defg-hij" }), false);
});
