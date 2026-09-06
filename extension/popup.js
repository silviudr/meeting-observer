const defaults = {
  backendUrl: "http://localhost:8010",
  sessionId: "demo",
  captureEnabled: true
};

const form = document.querySelector("#settingsForm");
const backendUrl = document.querySelector("#backendUrl");
const sessionId = document.querySelector("#sessionId");
const captureEnabled = document.querySelector("#captureEnabled");
const status = document.querySelector("#status");

chrome.storage.local.get(defaults, (stored) => {
  backendUrl.value = stored.backendUrl;
  sessionId.value = stored.sessionId;
  captureEnabled.checked = stored.captureEnabled;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  chrome.storage.local.set(
    {
      backendUrl: backendUrl.value.trim() || defaults.backendUrl,
      sessionId: sessionId.value.trim() || defaults.sessionId,
      captureEnabled: captureEnabled.checked
    },
    () => {
      status.textContent = "Saved";
      window.setTimeout(() => {
        status.textContent = "";
      }, 1400);
    }
  );
});
