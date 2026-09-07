/* global importScripts, chrome, MeetingObserver */
importScripts("core.js");

const { DEFAULTS, validateSettings, CaptureController } = MeetingObserver;
let accessToken = "";
const controller = new CaptureController({
  fetchFn: (...args) => fetch(...args),
  onChange: (state) => {
    chrome.runtime.sendMessage({ type: "observer:state", state }).catch(() => {});
    if (controller.lastBroadcastTab != null) {
      chrome.tabs.sendMessage(controller.lastBroadcastTab, { type: "observer:state", state }).catch(() => {});
    }
    if (state.tabId != null && state.tabId !== controller.lastBroadcastTab) {
      chrome.tabs.sendMessage(state.tabId, { type: "observer:state", state }).catch(() => {});
    }
    controller.lastBroadcastTab = state.tabId;
  }
});

// Worker restarts discard capture state. Resuming always requires a user start.
const ready = (async () => {
  const stored = await chrome.storage.local.get(DEFAULTS);
  try { controller.config = validateSettings({ ...stored, captureEnabled: false }); }
  catch { controller.config = { ...DEFAULTS }; }
  await chrome.storage.local.remove("accessToken");
  await chrome.storage.local.set({ ...controller.config, captureEnabled: false });
  if (chrome.storage.session) accessToken = (await chrome.storage.session.get({ accessToken: "" })).accessToken;
})();

let commands = Promise.resolve();
async function configure(message) {
  const config = validateSettings(message.settings);
  controller.stop();
  controller.config = { ...config, captureEnabled: false };
  accessToken = String(message.accessToken || "").trim();
  if (chrome.storage.session) await chrome.storage.session.set({ accessToken });
  await chrome.storage.local.set({ ...config, captureEnabled: false });
  if (config.captureEnabled) {
    const tab = await chrome.tabs.get(message.tabId);
    if (!isMeet(tab.url)) throw new Error("Select an active Google Meet call before starting.");
    const probe = await chrome.tabs.sendMessage(tab.id, { type: "observer:probe" });
    if (!probe?.meetingPresent) throw new Error("Join the Google Meet call before starting.");
    return controller.start(config, accessToken, tab.id);
  }
  controller.publish();
  return controller.snapshot();
}

function isMeet(url) {
  return /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:[/?#]|$)/.test(url || "");
}
function tabState(tabId) {
  const state = controller.snapshot();
  return { ...state, captureEnabled: state.captureEnabled && state.tabId === tabId,
    status: state.tabId != null && state.tabId !== tabId ? "Paused (another tab is capturing)" : state.status };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || !["observer:get", "observer:configure", "observer:pulse", "observer:event"].includes(message.type)) return;
  const popup = !sender.tab && sender.url === chrome.runtime.getURL("popup.html");
  const content = sender.tab && sender.frameId === 0 && isMeet(sender.url);
  if (!popup && !content) return;
  (async () => {
    await ready;
    if (message.type === "observer:configure" && popup) {
      const next = commands.then(() => configure(message));
      commands = next.catch(() => {});
      return { state: await next };
    }
    if (message.type === "observer:get" && popup) return { state: controller.snapshot(), accessToken };
    if (message.type === "observer:pulse" && content) {
      controller.present(sender.tab.id, message.meetingPresent === true);
      void controller.tick();
      return { state: tabState(sender.tab.id) };
    }
    if (message.type === "observer:event" && content) {
      const result = controller.enqueue(message.event, sender.tab.id, message.epoch);
      void controller.tick();
      return { result, state: tabState(sender.tab.id) };
    }
    return { error: "Unsupported request" };
  })().then(respond, (error) => respond({ error: error.message || "Unable to connect.", state: controller.snapshot() }));
  return true;
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === controller.tabId) controller.stop("Meeting tab closed. Capture paused.");
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (tabId === controller.tabId && change.url && !isMeet(change.url)) {
    controller.stop("Meeting tab navigated. Capture paused.");
  }
});
