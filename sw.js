const KEEP_RECENT = 5;

chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  const recent = new Set(
    tabs.toSorted((a, b) => b.lastAccessed - a.lastAccessed).slice(0, KEEP_RECENT).map((t) => t.id)
  );
  const toSleep = tabs.filter((t) => !t.active && !t.audible && !t.discarded && !recent.has(t.id));
  await Promise.allSettled(toSleep.map((t) => chrome.tabs.discard(t.id)));

  chrome.action.setBadgeText({ text: String(toSleep.length) });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
});
