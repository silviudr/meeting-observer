chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    backendUrl: "http://localhost:8010",
    sessionId: "demo",
    captureEnabled: true
  });
});
