/* global chrome, MeetingObserver */
(function (root) {
  "use strict";

  // Wires the popup to the background worker's message contract:
  // observer:get -> { state, accessToken }, observer:configure -> { state } | { error },
  // and observer:state broadcasts whenever capture state changes.
  function mountPopup({ chrome, document, validateSettings }) {
    const els = Object.fromEntries([
      "settingsForm", "backendUrl", "sessionId", "ownerSpeaker", "accessToken", "captureEnabled", "save", "status",
    ].map((id) => [id, document.querySelector(`#${id}`)]));
    let applying = false;

    function describe(state) {
      if (!state?.captureEnabled && (state?.status || "Paused") === "Paused") {
        return "Paused. Check Capture captions, then Apply to start.";
      }
      const parts = [state?.status || "Paused"];
      if (state?.captureEnabled) parts.push(`capturing ${state.sessionId}`);
      if (state?.queued) parts.push(`${state.queued} queued`);
      if (state?.dropped) parts.push(`${state.dropped} dropped`);
      return parts.join(" · ");
    }

    function explain(message) {
      if (/receiving end does not exist/i.test(String(message))) {
        return "Reload the Google Meet tab after installing or updating the extension, then retry.";
      }
      return String(message || "Capture could not be started.");
    }

    function renderState(state) {
      if (!state) return;
      els.status.textContent = describe(state);
      // Never fight the user's pointer over the toggle; text fields are only
      // populated on load and after an explicit Apply.
      if (document.activeElement !== els.captureEnabled) {
        els.captureEnabled.checked = state.captureEnabled === true;
      }
      els.save.textContent = els.captureEnabled.checked ? "Start capture" : "Save paused";
    }

    function loadFields(state, token) {
      if (typeof state?.backendUrl === "string" && state.backendUrl) els.backendUrl.value = state.backendUrl;
      if (typeof state?.sessionId === "string" && state.sessionId) els.sessionId.value = state.sessionId;
      if (typeof state?.ownerSpeaker === "string") els.ownerSpeaker.value = state.ownerSpeaker;
      els.captureEnabled.checked = state?.captureEnabled === true;
      if (typeof token === "string") els.accessToken.value = token;
      renderState(state);
    }

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "observer:state") renderState(message.state);
    });

    async function initialize() {
      try {
        const reply = await chrome.runtime.sendMessage({ type: "observer:get" });
        if (reply?.error) { els.status.textContent = explain(reply.error); return; }
        loadFields(reply?.state, reply?.accessToken);
      } catch {
        els.status.textContent = "Extension is starting. Close and reopen this panel.";
      }
    }

    async function activeTabId() {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab?.id ?? null;
      } catch {
        return null;
      }
    }

    els.settingsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (applying) return;
      let settings;
      try {
        settings = validateSettings({
          backendUrl: els.backendUrl.value.trim(),
          sessionId: els.sessionId.value.trim(),
          ownerSpeaker: els.ownerSpeaker.value,
          captureEnabled: els.captureEnabled.checked === true,
        });
      } catch (error) {
        els.status.textContent = error.message;
        return;
      }
      let tabId = null;
      if (settings.captureEnabled) {
        tabId = await activeTabId();
        if (tabId == null) {
          els.status.textContent = "Open the Google Meet call tab, then start capture from there.";
          return;
        }
      }
      applying = true;
      els.save.disabled = true;
      els.status.textContent = "Applying settings…";
      try {
        const reply = await chrome.runtime.sendMessage({
          type: "observer:configure", settings,
          accessToken: els.accessToken.value.trim(), tabId,
        });
        if (reply?.error) els.status.textContent = explain(reply.error);
        else if (reply?.state) loadFields(reply.state, null);
        else els.status.textContent = "No response from the extension. Retry.";
      } catch (error) {
        els.status.textContent = explain(error?.message);
      } finally {
        applying = false;
        els.save.disabled = false;
      }
    });
    els.captureEnabled.addEventListener("change", () => {
      els.save.textContent = els.captureEnabled.checked ? "Start capture" : "Save paused";
    });

    void initialize();
  }

  const api = { mountPopup };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MeetingObserverPopup = api;
})(globalThis);

if (typeof chrome !== "undefined" && typeof document !== "undefined") {
  MeetingObserverPopup.mountPopup({
    chrome, document, validateSettings: MeetingObserver.validateSettings,
  });
}
