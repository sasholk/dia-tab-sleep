const KEEP_RECENT = 5;
const UNUSED_MINUTES = 5;
const ALARM = "sleep-tabs";
const HISTORY_LIMIT = 300;
const SETTLE_MS = 3000;
const FEEDBACK_MS = 5000;

const freeBytes = async () => (await chrome.system.memory.getInfo()).availableCapacity;

function badge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
}

async function sleepTabs(trigger) {
  badge("…", "#8E8E93");
  const tabs = await chrome.tabs.query({});
  const recent = new Set(
    tabs.toSorted((a, b) => b.lastAccessed - a.lastAccessed).slice(0, KEEP_RECENT).map((t) => t.id)
  );
  const candidates = tabs.filter((t) => !t.active && !t.audible && !t.discarded && !recent.has(t.id));

  const before = await freeBytes();
  const results = await Promise.allSettled(candidates.map((t) => chrome.tabs.discard(t.id)));
  const slept = candidates.filter((_, i) => results[i].status === "fulfilled" && results[i].value);
  // Freed memory is the change in system free RAM, so it's approximate and can be noisy.
  if (slept.length) await new Promise((r) => setTimeout(r, SETTLE_MS));
  const freedMB = slept.length ? Math.max(0, Math.round(((await freeBytes()) - before) / 2 ** 20)) : 0;

  const entry = { at: Date.now(), trigger, count: slept.length, failed: candidates.length - slept.length, freedMB, titles: slept.map((t) => t.title) };
  if (slept.length) {
    const { history = [] } = await chrome.storage.local.get("history");
    await chrome.storage.local.set({ history: [...history, entry].slice(-HISTORY_LIMIT) });
  }
  if (slept.length || trigger === "shortcut") notify(entry);

  badge(String(slept.length), slept.length ? "#34A853" : "#8E8E93");
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), FEEDBACK_MS);
  await chrome.storage.session.set({ lastResult: entry });
  if (trigger === "shortcut") chrome.action.openPopup().catch(() => {});
  return entry;
}

function notify({ count, failed, freedMB }) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon.png",
    title: count ? `Приспано вкладок: ${count}` : "Нічого приспати",
    message: count ? `Звільнено ~${freedMB} MB${failed ? ` · не вдалося: ${failed}` : ""}` : "Усі старі вкладки вже сплять.",
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== "sleep") return;
  sleepTabs("click").then(reply);
  return true;
});
chrome.commands.onCommand.addListener((cmd) => cmd === "sleep-tabs" && sleepTabs("shortcut"));

// Dia lost focus → sleep after UNUSED_MINUTES unless it comes back.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) chrome.alarms.create(ALARM, { delayInMinutes: UNUSED_MINUTES });
  else chrome.alarms.clear(ALARM);
});
chrome.alarms.onAlarm.addListener((a) => a.name === ALARM && sleepTabs("unfocus"));

chrome.idle.setDetectionInterval(UNUSED_MINUTES * 60);
chrome.idle.onStateChanged.addListener((state) => state !== "active" && sleepTabs("idle"));
