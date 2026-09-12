import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Load the browser ES module without changing the repository's Node module settings.
const source = await readFile(new URL("../dashboard/static/app.js", import.meta.url), "utf8");
const { mountDashboard } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const snapshot = (sessionId = "alpha", overrides = {}) => ({
  session_id: sessionId, status: "active", revision: 1,
  transcript: [{ id: "event1", speaker: "Ada", text: "Synthetic caption", timestamp: "2026-09-07T12:00:00Z" }],
  participants: [{ speaker: "Ada" }],
  insights: [{
    speaker: "Ada", intent_label: "raising_risk", hypothesis: "May need evidence.",
    confidence: 0.92, evidence: ["Synthetic caption"], evidence_event_ids: ["event1"],
    analysis_mode: "rules", suggested_user_move: "Ask which evidence would resolve the concern.",
  }],
  analysis_mode: "rules", analysis_status: "ready", analysis_detail: null,
  ...overrides,
});

class Target {
  listeners = new Map();
  addEventListener(type, callback) {
    const list = this.listeners.get(type) || [];
    list.push(callback);
    this.listeners.set(type, list);
  }
  emit(type, event = {}) {
    for (const callback of this.listeners.get(type) || []) callback(event);
  }
}

class Element extends Target {
  value = "";
  textContent = "";
  disabled = false;
  dataset = {};
  children = [];
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 200;
  html = "";
  set innerHTML(html) {
    this.html = html;
    this.children = [...html.matchAll(/data-event-id="([^"]*)"/g)].map((match, index) => ({
      dataset: { eventId: match[1] }, offsetTop: index * 50, offsetHeight: 50,
    }));
    this.scrollHeight = this.children.length * 50;
  }
  get innerHTML() { return this.html; }
  replaceChildren() { this.innerHTML = ""; }
}

function harness(search = "", fetchImpl) {
  const elements = {};
  const calls = [];
  const sockets = [];
  const timers = new Map();
  let timerId = 0;
  const window = new Target();
  window.location = new URL(`https://observer.test/${search}`);
  window.setTimeout = (callback, delay) => {
    const id = ++timerId;
    timers.set(id, { callback, delay });
    return id;
  };
  window.clearTimeout = (id) => timers.delete(id);
  // Any browser-storage access fails the test, including settings reads.
  for (const name of ["localStorage", "sessionStorage", "indexedDB"]) {
    Object.defineProperty(window, name, { get() { throw new Error("Storage forbidden"); } });
  }
  const document = { querySelector: (selector) => elements[selector.slice(1)] ||= new Element() };
  const fetch = async (url, options) => {
    calls.push({ url, ...options });
    return fetchImpl ? fetchImpl(url, options) : response(options.method === "DELETE"
      ? { deleted: true } : snapshot(url.split("/").at(-1)));
  };
  class WebSocket extends Target {
    constructor(url) { super(); this.url = url; this.closed = false; sockets.push(this); }
    close() { this.closed = true; }
    message(body) { this.emit("message", { data: JSON.stringify(body) }); }
  }
  mountDashboard({ window, document, fetch, WebSocket });
  return {
    elements, calls, sockets, timers, window,
    async submit(id = "alpha", token = "") {
      elements.sessionInput.value = id;
      elements.tokenInput.value = token;
      elements.sessionForm.emit("submit", { preventDefault() {} });
      await flush();
    },
    async tick(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `Expected a ${delay}ms timer`);
      timers.delete(entry[0]);
      entry[1].callback();
      await flush();
    },
    end() { elements.clearButton.emit("click"); },
  };
}

function assertEmpty(h) {
  for (const id of ["transcriptList", "insightsList"]) assert.equal(h.elements[id].innerHTML, "");
  for (const id of ["lineCount", "participantCount", "insightCount"]) assert.equal(h.elements[id].textContent, "0");
  assert.equal(h.elements.modelMode.textContent, "Not connected");
  assert.equal(h.elements.analysisStatus.textContent, "No active analysis");
}

test("page load is inert; form explicitly POSTs with memory-only HTTP and WS credentials", async () => {
  const h = harness();
  assert.equal(h.calls.length, 0);
  assert.equal(h.sockets.length, 0);
  await h.submit("alpha", "a+b &/?token");
  assert.equal(h.calls[0].method, "POST");
  assert.equal(h.calls[0].headers.Authorization, "Bearer a+b &/?token");
  assert.equal(h.calls[0].cache, "no-store");
  assert.equal(new URL(h.sockets[0].url).protocol, "wss:");
  assert.equal(new URL(h.sockets[0].url).searchParams.get("token"), "a+b &/?token");
  assert.equal(h.window.location.search, "");
  await h.submit("alpha", "a+b &/?token");
  assert.deepEqual(h.calls.map((call) => call.method), ["POST", "POST"]);
  assert.equal(h.elements.lineCount.textContent, "1");
  assert.equal(h.sockets[0].closed, true);
});

test("known URL session uses GET; unknown and ended URL sessions never create or reconnect", async () => {
  const known = harness("?session=alpha");
  await flush();
  assert.equal(known.calls[0].method, "GET");
  assert.equal(known.sockets.length, 1);
  for (const code of [404, 410, 401, 403]) {
    const h = harness("?session=alpha", () => response({}, code));
    await flush();
    assert.deepEqual(h.calls.map((call) => call.method), ["GET"]);
    assert.equal(h.sockets.length, 0);
    assert.equal(h.timers.size, 0);
    assertEmpty(h);
    assert.match(h.elements.statusText.textContent, code === 404 ? /not found/ : code === 410 ? /ended/ : /Access denied/);
  }
});

test("IDs enforce the shared ASCII grammar at both entry points", async () => {
  for (const id of ["", "a b", "a/b", "caf\u00e9", "a".repeat(81), "a\n"]) {
    const h = harness();
    await h.submit(id);
    assert.equal(h.calls.length, 0);
    assert.match(h.elements.statusText.textContent, /Invalid session ID/);
    const url = harness(`?session=${encodeURIComponent(id)}`);
    assert.equal(url.calls.length, 0);
  }
  const h = harness();
  await h.submit("A_0-".repeat(20));
  assert.equal(h.calls.length, 1);
});

test("switching clears immediately and ignores delayed HTTP and every stale socket callback", async () => {
  const pending = deferred();
  const h = harness("", (url) => url.endsWith("/slow") ? pending.promise : response(snapshot(url.split("/").at(-1))));
  await h.submit("alpha");
  const old = h.sockets[0];
  await h.submit("slow");
  assertEmpty(h);
  await h.submit("beta");
  assert.equal(h.calls[1].signal.aborted, true);
  pending.resolve(response(snapshot("slow")));
  old.emit("open");
  old.message(snapshot("alpha", { status: "ended" }));
  old.emit("error");
  old.emit("close", { code: 1008 });
  await flush();
  assert.equal(h.sockets.length, 2);
  assert.match(h.elements.statusText.textContent, /beta/);
  assert.equal(h.elements.lineCount.textContent, "1");
});

test("disconnect retries GET with backoff and cancelled retry callbacks cannot touch another session", async () => {
  let failures = 0;
  const h = harness("", (url, options) => {
    if (options.method === "GET" && failures++ < 2) return response({}, 503);
    return response(snapshot(url.split("/").at(-1)));
  });
  await h.submit();
  const old = h.sockets[0];
  old.emit("close", { code: 1006 });
  assert.match(h.elements.statusText.textContent, /stale/);
  await h.tick(1000);
  await h.tick(2000);
  await h.tick(4000);
  assert.deepEqual(h.calls.map((call) => call.method), ["POST", "GET", "GET", "GET"]);
  h.sockets.at(-1).message(snapshot());
  h.sockets.at(-1).emit("close", { code: 1006 });
  const staleRetry = [...h.timers.values()][0].callback;
  await h.submit("beta");
  staleRetry();
  await flush();
  assert.equal(h.calls.length, 5);
  assert.match(h.elements.statusText.textContent, /beta/);
  assert.ok(h.calls.every((call) => !call.url.includes("heartbeat")));
});

test("terminal snapshot and close codes erase content and stop reconnect", async () => {
  for (const code of [4001, 4004, 1008, "snapshot"]) {
    const h = harness();
    await h.submit("alpha", "secret");
    const socket = h.sockets[0];
    if (code === "snapshot") socket.message(snapshot("alpha", { status: "ended", revision: 0 }));
    else socket.emit("close", { code });
    assertEmpty(h);
    assert.equal(h.elements.tokenInput.value, "");
    assert.equal(h.timers.size, 0);
    assert.equal(h.elements.clearButton.disabled, true);
    socket.message(snapshot());
    socket.emit("close", { code: 1006 });
    assertEmpty(h);
    assert.equal(h.timers.size, 0);
  }
});

test("End clears before DELETE resolves, ignores late messages, and can retry a failed end", async () => {
  const pending = deferred();
  let deletes = 0;
  const h = harness("", (_, options) => options.method === "DELETE"
    ? ++deletes === 1 ? pending.promise : response({ deleted: true }) : response(snapshot()));
  await h.submit("alpha", "secret");
  h.end();
  assertEmpty(h);
  assert.equal(h.sockets[0].closed, true);
  assert.equal(h.calls[1].method, "DELETE");
  assert.equal(h.calls[1].headers.Authorization, "Bearer secret");
  h.sockets[0].message(snapshot());
  pending.resolve(response({}, 503));
  await flush();
  assertEmpty(h);
  assert.match(h.elements.statusText.textContent, /End not confirmed/);
  assert.equal(h.elements.clearButton.disabled, false);
  assert.equal(h.timers.size, 0);
  h.end();
  await flush();
  assert.match(h.elements.statusText.textContent, /Session ended/);
  assert.equal(h.elements.tokenInput.value, "");
  assert.equal(h.timers.size, 0);
});

test("late DELETE cannot clear a newer session; pagehide erases content and cancels pending work", async () => {
  const pending = deferred();
  const h = harness("", (url, options) => options.method === "DELETE" ? pending.promise : response(snapshot(url.split("/").at(-1))));
  await h.submit();
  h.end();
  await h.submit("beta", "secret");
  pending.resolve(response({ deleted: true }));
  await flush();
  assert.equal(h.elements.lineCount.textContent, "1");
  h.window.emit("pagehide");
  assertEmpty(h);
  assert.equal(h.elements.sessionInput.value, "");
  assert.equal(h.elements.tokenInput.value, "");
  assert.equal(h.timers.size, 0);
  h.sockets.at(-1).message(snapshot("beta"));
  assertEmpty(h);

  const slow = deferred();
  const loading = harness("?session=alpha", () => slow.promise);
  loading.window.emit("pagehide");
  assert.equal(loading.calls[0].signal.aborted, true);
  assert.equal(loading.timers.size, 0);
  slow.resolve(response(snapshot()));
  await flush();
  assertEmpty(loading);
  assert.equal(loading.sockets.length, 0);
});

test("HTTP errors and broken JSON fail visibly; ended POST never opens a socket", async () => {
  for (const code of [401, 403, 410, 422, 500]) {
    const h = harness("", () => response({}, code));
    await h.submit();
    assertEmpty(h);
    assert.equal(h.sockets.length, 0);
    assert.equal(h.timers.size, 0);
    assert.match(h.elements.statusText.textContent, /denied|ended|Invalid|HTTP 500/);
  }
  const h = harness();
  await h.submit();
  h.sockets[0].emit("message", { data: "not JSON" });
  assert.match(h.elements.statusText.textContent, /Invalid server response/);
  await h.tick(1000);
  assert.equal(h.calls[1].method, "GET");
});

test("coaching shows grounded evidence and mode without probability; analysis states stay explicit", async () => {
  const h = harness();
  await h.submit();
  assert.equal(h.elements.modelMode.textContent, "Rules demo");
  const html = h.elements.insightsList.innerHTML;
  assert.match(html, /Ask which evidence/);
  assert.match(html, /Hypothesis:/);
  assert.match(html, /Ada:<\/strong> Synthetic caption/);
  assert.doesNotMatch(html, /92%|confidence/);
  const socket = h.sockets[0];
  socket.message(snapshot("alpha", { revision: 3, analysis_mode: "vllm", analysis_status: "pending" }));
  assert.equal(h.elements.modelMode.textContent, "vLLM");
  assert.match(h.elements.analysisStatus.textContent, /pending.*Previous coaching/);
  socket.message(snapshot("alpha", { revision: 2, analysis_status: "ready" }));
  assert.match(h.elements.analysisStatus.textContent, /pending/);
  socket.message(snapshot("alpha", { revision: 4, analysis_status: "unavailable", analysis_detail: "Model timeout" }));
  assert.match(h.elements.analysisStatus.textContent, /unavailable.*stale.*Model timeout/);
  socket.message(snapshot("alpha", { revision: 5, insights: [] }));
  assert.match(h.elements.analysisStatus.textContent, /Insufficient evidence/);
  assert.equal(h.elements.insightsList.innerHTML, "");
});

test("meeting text is escaped and transcript reading position survives append and retention trimming", async () => {
  const h = harness();
  await h.submit();
  const transcript = Array.from({ length: 20 }, (_, i) => ({
    id: `event${i}`, speaker: "<script>speaker</script>", text: '<img src=x onerror="alert(1)">', timestamp: "2026-09-07T12:00:00Z",
  }));
  const list = h.elements.transcriptList;
  h.sockets[0].message(snapshot("alpha", { revision: 2, transcript }));
  assert.match(list.innerHTML, /&lt;img/);
  assert.doesNotMatch(list.innerHTML, /<script>|<img/);
  list.scrollTop = 250;
  h.sockets[0].message(snapshot("alpha", { revision: 3, transcript: [...transcript, { ...transcript[0], id: "last" }] }));
  assert.equal(list.scrollTop, 250);
  h.sockets[0].message(snapshot("alpha", { revision: 4, transcript: transcript.slice(2) }));
  assert.equal(list.scrollTop, 150);
  list.scrollTop = list.scrollHeight - list.clientHeight;
  h.sockets[0].message(snapshot("alpha", { revision: 5, transcript }));
  assert.equal(list.scrollTop, list.scrollHeight);
});

test("silent sockets recheck via GET and cannot renew or recreate expired sessions", async () => {
  const h = harness("", (_, options) => options.method === "GET" ? response({}, 410) : response(snapshot()));
  await h.submit();
  await h.tick(20000);
  assert.equal(h.sockets[0].closed, true);
  await h.tick(1000);
  assert.deepEqual(h.calls.map((call) => call.method), ["POST", "GET"]);
  assertEmpty(h);
  assert.equal(h.timers.size, 0);
});

test("glance shows the top cue, lists the rest, and stays quiet when there are none", async () => {
  const cues = [
    { kind: "unanswered_question", message: "Dan asked a question and you have not spoken since.", priority: 100 },
    { kind: "new_risk", message: "Priya has raised a risk.", priority: 80 },
  ];
  const h = harness("", async (url) => response(snapshot(url.split("/").at(-1), { cues, owner_speaker: "Maria", owner_matched: true })));
  await h.submit("alpha");

  assert.equal(h.elements.glanceText.textContent, "Dan asked a question and you have not spoken since.");
  assert.equal(h.elements.glanceText.dataset.kind, "unanswered_question");
  assert.match(h.elements.cueList.innerHTML, /Priya has raised a risk\./);
  assert.doesNotMatch(h.elements.cueList.innerHTML, /asked a question/);
  assert.equal(h.elements.ownerStatus.textContent, "Tracking you as Maria.");

  h.sockets[0].message(snapshot("alpha", { revision: 2, cues: [], owner_speaker: "Maria", owner_matched: true }));
  await flush();
  assert.equal(h.elements.glanceText.textContent, "Nothing needs your attention.");
  assert.equal(h.elements.glanceText.dataset.kind, "none");
  assert.equal(h.elements.cueList.innerHTML, "");
});

test("an owner name that never matches a caption speaker is reported, not shown as working", async () => {
  const h = harness("", async (url) => response(snapshot(url.split("/").at(-1), { owner_speaker: "Maria", owner_matched: false })));
  await h.submit("alpha");
  assert.match(h.elements.ownerStatus.textContent, /Waiting to hear Maria in captions/);
  assert.match(h.elements.ownerStatus.textContent, /matches your caption label exactly/);
});

test("no owner set explains what the name unlocks", async () => {
  const h = harness();
  await h.submit("alpha");
  assert.match(h.elements.ownerStatus.textContent, /No name set/);
});

test("Start sends the typed name, and reconnects do not resend it", async () => {
  const h = harness("", async (url, options) => {
    if (options.method === "POST") return response(snapshot(url.split("/").at(-1), { owner_speaker: "Maria", owner_matched: true }));
    return response(snapshot(url.split("/").at(-1)));
  });
  h.elements.ownerInput.value = "  Maria  ";
  await h.submit("alpha");
  assert.deepEqual(JSON.parse(h.calls[0].body), { owner_speaker: "Maria" });

  h.sockets[0].emit("close", {});
  await flush();
  await h.tick(1000);
  const reconnect = h.calls.at(-1);
  assert.equal(reconnect.method, "GET");
  assert.equal(reconnect.body, undefined);
});

test("Set name posts to the owner endpoint and applies the returned snapshot", async () => {
  const h = harness("", async (url, options) => {
    if (url.endsWith("/owner")) {
      return response(snapshot("alpha", { revision: 3, owner_speaker: JSON.parse(options.body).owner_speaker, owner_matched: true }));
    }
    return response(snapshot(url.split("/").at(-1)));
  });
  await h.submit("alpha");
  h.elements.ownerInput.value = "Maria";
  h.elements.ownerApply.emit("click");
  await flush();

  const call = h.calls.at(-1);
  assert.ok(call.url.endsWith("/api/sessions/alpha/owner"));
  assert.deepEqual(JSON.parse(call.body), { owner_speaker: "Maria" });
  assert.equal(h.elements.ownerStatus.textContent, "Tracking you as Maria.");
  assert.equal(h.elements.ownerApply.disabled, false);
});

test("clearing the name sends null and the control is disabled without a session", async () => {
  const h = harness("", async (url, options) => {
    if (url.endsWith("/owner")) return response(snapshot("alpha", { revision: 3, owner_speaker: null, owner_matched: false }));
    return response(snapshot(url.split("/").at(-1)));
  });
  assert.equal(h.elements.ownerApply.disabled, true);
  await h.submit("alpha");
  assert.equal(h.elements.ownerApply.disabled, false);

  h.elements.ownerInput.value = "   ";
  h.elements.ownerApply.emit("click");
  await flush();
  assert.deepEqual(JSON.parse(h.calls.at(-1).body), { owner_speaker: null });
  assert.match(h.elements.ownerStatus.textContent, /No name set/);
});

test("ending a session clears the glance area", async () => {
  const cues = [{ kind: "new_risk", message: "Priya has raised a risk.", priority: 80 }];
  const h = harness("", async (url, options) => options.method === "DELETE"
    ? response({ deleted: true })
    : response(snapshot(url.split("/").at(-1), { cues })));
  await h.submit("alpha");
  assert.equal(h.elements.glanceText.textContent, "Priya has raised a risk.");

  h.end();
  await flush();
  assert.equal(h.elements.glanceText.textContent, "Nothing needs your attention.");
  assert.equal(h.elements.cueList.innerHTML, "");
  assert.equal(h.elements.ownerApply.disabled, true);
});
