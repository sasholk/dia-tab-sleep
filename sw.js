const KEEP_RECENT = 5;
const UNUSED_MINUTES = 5;
const ALARM = "sleep-tabs";
const HISTORY_LIMIT = 300;
const FEEDBACK_MS = 5000;
const PROCESS_EXIT_POLL_MS = 150;
const PROCESS_EXIT_TIMEOUT_MS = 1200;
const HOST = "com.user.dia_mem";

const host = (cmd) => chrome.runtime.sendNativeMessage(HOST, { cmd });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function badge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
}

// Waits until some Dia process from `alive` exits; returns the new pid set and the dead pids.
async function waitForExit(alive) {
  for (let t = 0; t < PROCESS_EXIT_TIMEOUT_MS; t += PROCESS_EXIT_POLL_MS) {
    await wait(PROCESS_EXIT_POLL_MS);
    const now = new Set((await host("pids")).pids.map(String));
    const dead = [...alive].filter((p) => !now.has(p));
    if (dead.length) return { now, dead };
  }
  return { now: alive, dead: [] };
}

async function sleepTabs(trigger) {
  badge("…", "#8E8E93");
  const tabs = await chrome.tabs.query({});
  const recent = new Set(
    tabs.toSorted((a, b) => b.lastAccessed - a.lastAccessed).slice(0, KEEP_RECENT).map((t) => t.id)
  );
  const candidates = tabs.filter((t) => !t.active && !t.audible && !t.discarded && !recent.has(t.id));

  const snap = await host("snapshot").catch(() => null);
  let alive = snap && new Set(Object.keys(snap.procs));
  const slept = [];
  // One tab at a time, so each exited renderer process is attributed to the tab that owned it.
  // A renderer shared by several tabs of one site is credited to the last of them.
  for (const t of candidates) {
    if (!(await chrome.tabs.discard(t.id).catch(() => null))) continue;
    let mb = null;
    if (snap) {
      const { now, dead } = await waitForExit(alive);
      mb = dead.reduce((s, p) => s + snap.procs[p], 0);
      alive = now;
    }
    slept.push({ title: t.title, mb });
  }

  const entry = {
    at: Date.now(),
    trigger,
    count: slept.length,
    failed: candidates.length - slept.length,
    freedMB: snap ? slept.reduce((s, t) => s + t.mb, 0) : null,
    tabs: slept.toSorted((a, b) => b.mb - a.mb),
  };
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

function notify({ count, failed, freedMB, tabs }) {
  const top = tabs.slice(0, 3).map((t) => `${t.title} — ${t.mb} MB`).join("\n");
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon.png",
    title: count ? `Приспано ${count}${freedMB != null ? `, звільнено ${freedMB} MB` : ""}` : "Нічого приспати",
    message: count ? `${top}${failed ? `\nне вдалося: ${failed}` : ""}` : "Усі старі вкладки вже сплять.",
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
