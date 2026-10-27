import { HOST, pickCandidates } from "./common.js";

const UNUSED_MINUTES = 5;
const ALARM = "sleep-tabs";
const HISTORY_LIMIT = 300;
const FEEDBACK_MS = 5000;
const PROCESS_EXIT_POLL_MS = 100;
const PROCESS_EXIT_TIMEOUT_MS = 1000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// One host process per clean instead of one per request; replies come back in request order.
function openHost() {
  const port = chrome.runtime.connectNative(HOST);
  const pending = [];
  port.onMessage.addListener((msg) => pending.shift()?.resolve(msg));
  port.onDisconnect.addListener(() => {
    const error = new Error(chrome.runtime.lastError?.message ?? "host disconnected");
    pending.splice(0).forEach((p) => p.reject(error));
  });
  return {
    ask: (cmd) => new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
      port.postMessage({ cmd });
    }),
    close: () => port.disconnect(),
  };
}

function badge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
}

const progress = (done, total) => chrome.runtime.sendMessage({ type: "progress", done, total }).catch(() => {});

// Waits until some Dia process from `alive` exits; returns the new pid set and the dead pids.
async function waitForExit(host, alive) {
  for (let t = 0; t < PROCESS_EXIT_TIMEOUT_MS; t += PROCESS_EXIT_POLL_MS) {
    await wait(PROCESS_EXIT_POLL_MS);
    const now = new Set((await host.ask("pids")).pids.map(String));
    const dead = [...alive].filter((p) => !now.has(p));
    if (dead.length) return { now, dead };
  }
  return { now: alive, dead: [] };
}

async function sleepTabs(trigger) {
  badge("…", "#8E8E93");
  const candidates = pickCandidates(await chrome.tabs.query({}));

  const host = candidates.length ? openHost() : null;
  const snap = await host?.ask("snapshot").catch(() => null);
  let alive = snap && new Set(Object.keys(snap.procs));
  const slept = [];
  // One tab at a time, so each exited renderer process is attributed to the tab that owned it.
  // A renderer shared by several tabs of one site is credited to the last of them.
  for (const [i, t] of candidates.entries()) {
    progress(i, candidates.length);
    if (!(await chrome.tabs.discard(t.id).catch(() => null))) continue;
    let mb = null;
    if (snap) {
      const { now, dead } = await waitForExit(host, alive).catch(() => ({ now: alive, dead: [] }));
      mb = dead.reduce((s, p) => s + snap.procs[p], 0);
      alive = now;
    }
    slept.push({ title: t.title, mb });
  }
  host?.close();

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
  if (trigger === "shortcut" || (trigger === "click" && slept.length)) notify(entry);

  badge(String(slept.length), slept.length ? "#34A853" : "#8E8E93");
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), FEEDBACK_MS);
  await chrome.storage.session.set({ lastResult: entry });
  if (trigger === "shortcut") chrome.action.openPopup().catch(() => {});
  return entry;
}

// Idle and unfocus often fire together; a second trigger joins the clean already running.
let running = null;
function sleepTabsOnce(trigger) {
  running ??= sleepTabs(trigger).finally(() => (running = null));
  return running;
}

function notify({ count, failed, freedMB, tabs }) {
  const top = tabs.slice(0, 3).map((t) => `${t.title} — ${t.mb ?? "?"} MB`).join("\n");
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon.png",
    title: count ? `Slept ${count} ${count === 1 ? "tab" : "tabs"}${freedMB != null ? `, freed ${freedMB} MB` : ""}` : "Nothing to sleep",
    message: count ? `${top}${failed ? `\nfailed: ${failed}` : ""}` : "All old tabs are already asleep.",
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== "sleep") return;
  sleepTabsOnce("click").then(reply);
  return true;
});
chrome.commands.onCommand.addListener((cmd) => cmd === "sleep-tabs" && sleepTabsOnce("shortcut"));

// Dia lost focus → sleep after UNUSED_MINUTES unless it comes back.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) chrome.alarms.create(ALARM, { delayInMinutes: UNUSED_MINUTES });
  else chrome.alarms.clear(ALARM);
});
chrome.alarms.onAlarm.addListener((a) => a.name === ALARM && sleepTabsOnce("unfocus"));

chrome.idle.setDetectionInterval(UNUSED_MINUTES * 60);
chrome.idle.onStateChanged.addListener((state) => state !== "active" && sleepTabsOnce("idle"));

// v1–v2 entries measured system free RAM, which swap made meaningless.
chrome.runtime.onInstalled.addListener(async () => {
  const { history = [] } = await chrome.storage.local.get("history");
  await chrome.storage.local.set({ history: history.filter((h) => h.tabs) });
});
