const KEEP_RECENT = 5;
const UNUSED_MINUTES = 5;
const ALARM = "sleep-tabs";

async function sleepTabs() {
  const tabs = await chrome.tabs.query({});
  const recent = new Set(
    tabs.toSorted((a, b) => b.lastAccessed - a.lastAccessed).slice(0, KEEP_RECENT).map((t) => t.id)
  );
  const toSleep = tabs.filter((t) => !t.active && !t.audible && !t.discarded && !recent.has(t.id));
  await Promise.allSettled(toSleep.map((t) => chrome.tabs.discard(t.id)));
  return toSleep.length;
}

chrome.action.onClicked.addListener(async () => {
  chrome.action.setBadgeText({ text: String(await sleepTabs()) });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
});

// Dia lost focus → sleep after UNUSED_MINUTES unless it comes back.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) chrome.alarms.create(ALARM, { delayInMinutes: UNUSED_MINUTES });
  else chrome.alarms.clear(ALARM);
});
chrome.alarms.onAlarm.addListener((a) => a.name === ALARM && sleepTabs());

chrome.idle.setDetectionInterval(UNUSED_MINUTES * 60);
chrome.idle.onStateChanged.addListener((state) => state !== "active" && sleepTabs());
