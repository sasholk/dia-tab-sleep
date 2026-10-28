import { HOST, KEEP_RECENT, glowFrame, pickCandidates } from "./common.js";

const WEEK_MS = 7 * 24 * 3600 * 1000;
const FEEDBACK_MS = 5000;
const LAND_DELAY_MS = 300;
const TRIGGERS = { click: "button", shortcut: "shortcut", unfocus: "Dia unfocused", idle: "Mac idle" };
const PROFILE_CACHE = "profile";
const MARK_STYLES = [{ height: 18, opacity: 1 }, { height: 16, opacity: 0.7 }, { height: 14, opacity: 0.45 }];

const $ = (id) => document.getElementById(id);
const mb = (n) => (n == null ? "?" : n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`);
const time = (ts) => new Date(ts).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const sum = (list, pick) => list.reduce((s, x) => s + (pick(x) ?? 0), 0);
const tabsWord = (n) => (n === 1 ? "tab" : "tabs");

function el(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function row(tag, left, right, tooltip = "") {
  const node = el(tag);
  node.title = tooltip;
  node.append(el("span", left, "ellipsis"), el("span", right));
  return node;
}

function topItem(t, i) {
  const item = row("li", t.title, mb(t.mb), t.title);
  const mark = el("span", "", "mark");
  mark.style.height = `${MARK_STYLES[i].height}px`;
  mark.style.opacity = MARK_STYLES[i].opacity;
  item.firstChild.style.flexGrow = 1;
  item.prepend(mark);
  return item;
}

function kindItem([label, mbValue, color = "var(--dia-rest)"]) {
  const item = row("li", label, mb(mbValue));
  const dot = el("span", "", "dot");
  dot.style.background = color;
  item.prepend(dot);
  item.children[1].style.flexGrow = 1;
  return item;
}

function historyItem(h) {
  const details = el("details");
  details.append(row("summary", `${time(h.at)} · ${TRIGGERS[h.trigger]}`, `${h.count} ${tabsWord(h.count)} · ${mb(h.freedMB)}`));
  const list = el("ul");
  list.append(...h.tabs.map((t) => row("li", t.title, mb(t.mb), t.title)));
  details.append(list);
  return details;
}

function applyGlow({ y, washOpacity, auroraOpacity, landed }) {
  $("glow").style.transform = `translateY(${y}px)`;
  $("glow").classList.toggle("landed", landed);
  $("wash").style.setProperty("--wash", washOpacity);
  $("aurora").style.opacity = auroraOpacity;
}

function applyProfile(profile, { detected = false } = {}) {
  if (profile?.color) document.documentElement.style.setProperty("--profile", profile.color);
  else document.documentElement.style.removeProperty("--profile");
  $("profileName").textContent = profile?.name ?? "Dia";
  $("chip").disabled = detected;
  $("chip").setAttribute("aria-label", profile ? `Dia profile: ${profile.name}${detected ? "" : ", change"}` : "Pick Dia profile");
  for (const s of $("swatches").children) s.setAttribute("aria-pressed", String(s.dataset.dir === profile?.dir));
  try {
    if (profile) localStorage.setItem(PROFILE_CACHE, JSON.stringify(profile));
  } catch {}
}

function togglePicker(open) {
  $("picker").hidden = !open;
  $("chip").setAttribute("aria-expanded", String(open));
}

function buildPicker(profiles) {
  $("swatches").replaceChildren(
    ...profiles.map((profile) => {
      const swatch = el("button", "", "swatch");
      const dot = el("span", "", "dot");
      dot.style.background = profile.color ?? "var(--rest)";
      swatch.dataset.dir = profile.dir;
      swatch.setAttribute("aria-label", `Use ${profile.name} profile color`);
      swatch.append(dot, el("span", profile.name, "ellipsis"));
      swatch.addEventListener("click", () => {
        chrome.storage.local.set({ profileDir: profile.dir });
        applyProfile(profile);
        togglePicker(false);
        $("chip").focus();
      });
      return swatch;
    })
  );
}

// The extension can't ask Dia which profile it runs in. It writes a fresh marker to its storage and
// the host finds the profile folder holding it; a one-time pick is the fallback.
async function loadProfile() {
  const marker = crypto.randomUUID();
  await chrome.storage.local.set({ marker });
  const [res, { profileDir, profile: legacyName }] = await Promise.all([
    chrome.runtime.sendNativeMessage(HOST, { cmd: "profiles", id: chrome.runtime.id, marker }).catch(() => null),
    chrome.storage.local.get(["profileDir", "profile"]),
  ]);
  if (!res?.profiles?.length) return;
  const byDir = (dir) => res.profiles.find((p) => p.dir === dir);
  const detected = byDir(res.current);
  const profile = detected ?? byDir(profileDir) ?? res.profiles.find((p) => p.name === legacyName) ?? (res.profiles.length === 1 ? res.profiles[0] : null);
  buildPicker(res.profiles);
  applyProfile(profile, { detected: Boolean(detected) || res.profiles.length === 1 });
  togglePicker(!profile);
}

// The host keys renderers by --renderer-client-id, which is the processId webNavigation reports.
// Tabs sharing a renderer can't be split, so they show as one row.
async function liveTabGroups(tabs, renderers = {}) {
  const groups = new Map();
  await Promise.all(
    tabs.filter((t) => !t.discarded).map(async (tab) => {
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => null);
      const pid = frames?.find((f) => f.frameId === 0)?.processId;
      if (renderers[pid]) groups.set(pid, [...(groups.get(pid) ?? []), tab]);
    })
  );
  return [...groups]
    .map(([pid, [first, ...rest]]) => ({ title: rest.length ? `${first.title} +${rest.length}` : first.title, mb: renderers[pid] }))
    .sort((a, b) => b.mb - a.mb);
}

let topLists = { now: [], slept: [] };
let topMode = "now";

function renderTop() {
  const mode = topLists.now.length ? topMode : "slept";
  $("topToggle").hidden = !topLists.now.length;
  for (const b of $("topToggle").children) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  $("top").replaceChildren(...topLists[mode].map(topItem));
  if (!topLists[mode].length) $("top").replaceChildren(el("li", "Shows up after the next clean", "muted"));
}

// The extension only sees its own profile's tabs, so their renderers are this profile's share of Dia.
async function renderDia(snapshot, tabs, capacityMB, usedMB) {
  const snap = await snapshot;
  $("dia").classList.remove("loading");
  $("dia").textContent = snap.error ? "host unavailable" : mb(snap.total_mb);
  $("dia").title = snap.error ?? "";
  const groups = await liveTabGroups(tabs, snap.renderers);
  const diaMB = snap.total_mb ?? 0;
  const profileMB = sum(groups, (g) => g.mb);
  const pct = (n) => `${(Math.max(0, n) / capacityMB) * 100}%`;
  $("profileMem").textContent = groups.length ? mb(profileMB) : "";
  $("barProfile").style.width = pct(profileMB);
  $("barDia").style.width = pct(diaMB - profileMB);
  $("barRest").style.width = pct(usedMB - diaMB);
  topLists.now = groups.slice(0, 3);
  renderTop();

  const kinds = snap.kinds ?? {};
  const kindMB = (k) => kinds[k]?.mb ?? 0;
  $("breakdown").hidden = !snap.kinds;
  $("kinds").replaceChildren(
    ...[
      ["This profile's tabs", profileMB, "var(--profile)"],
      ["Other profiles' tabs and Dia pages", kindMB("tabs") - profileMB],
      ["Dia app", kindMB("app")],
      [`Extensions · ${kinds.extensions?.count ?? 0}`, kindMB("extensions")],
      ["Graphics", kindMB("gpu")],
      ["Network, storage, audio", kindMB("services")],
    ].map(kindItem)
  );
}

async function render() {
  const [{ capacity, availableCapacity }, tabs, { history = [] }] = await Promise.all([
    chrome.system.memory.getInfo(),
    chrome.tabs.query({}),
    chrome.storage.local.get("history"),
  ]);
  const capacityMB = Math.round(capacity / 2 ** 20);
  const usedMB = Math.round((capacity - availableCapacity) / 2 ** 20);
  $("ram").textContent = `${mb(usedMB)} / ${mb(capacityMB)}`;
  // `top` takes ~1s, so Dia's total and live tabs fill in after the rest.
  const snapshot = chrome.runtime.sendNativeMessage(HOST, { cmd: "snapshot" }).catch((e) => ({ error: e.message }));

  renderDia(snapshot, tabs, capacityMB, usedMB);

  const sleeping = tabs.filter((t) => t.discarded).length;
  $("tabs").textContent = `${tabs.length - sleeping} awake · ${sleeping} asleep`;

  const n = pickCandidates(tabs).length;
  $("sleep").disabled = !n;
  $("sleep").textContent = n ? `Sleep ${n} ${tabsWord(n)}` : "All old tabs are asleep";
  $("sleep").title = `Keeps visible tabs, tabs playing audio and the ${KEEP_RECENT} most recent`;

  const week = history.filter((h) => Date.now() - h.at < WEEK_MS);
  $("weekMeta").textContent = week.length ? `${week.length} cleans · ${sum(week, (h) => h.count)} tabs` : "";
  $("weekFreed").textContent = week.length ? `${mb(sum(week, (h) => h.freedMB))} freed` : "No cleans yet";
  $("history").replaceChildren(...history.slice(-30).reverse().map(historyItem));

  topLists.slept = week.flatMap((h) => h.tabs).filter((t) => t.mb).sort((a, b) => b.mb - a.mb).slice(0, 3);
}

for (const b of $("topToggle").children) {
  b.addEventListener("click", () => {
    topMode = b.dataset.mode;
    renderTop();
  });
}

function showResult({ count, freedMB }) {
  $("result").textContent = count ? `Slept ${count} ${tabsWord(count)}, freed ${mb(freedMB)}` : "Nothing to sleep";
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "progress") return;
  $("result").textContent = `Sleeping ${msg.done + 1} of ${msg.total}…`;
  applyGlow(glowFrame({ phase: "running", done: msg.done, total: msg.total }));
});

$("sleep").addEventListener("click", async () => {
  $("sleep").disabled = true;
  applyGlow(glowFrame({ phase: "idle" }));
  $("result").textContent = "Preparing…";
  const result = await chrome.runtime.sendMessage({ type: "sleep" });
  showResult(result);
  applyGlow(glowFrame({ phase: result.count ? "done" : "idle" }));
  render();
});

// Opened by the shortcut right after a clean → show the result, then close unless hovered.
chrome.storage.session.get("lastResult").then(({ lastResult }) => {
  if (lastResult?.trigger !== "shortcut" || Date.now() - lastResult.at > FEEDBACK_MS) return;
  showResult(lastResult);
  if (lastResult.count) setTimeout(() => applyGlow(glowFrame({ phase: "done" })), LAND_DELAY_MS);
  const timer = setTimeout(() => window.close(), FEEDBACK_MS);
  document.body.addEventListener("mouseenter", () => clearTimeout(timer), { once: true });
});

$("chip").addEventListener("click", () => togglePicker($("picker").hidden));
try {
  $("profileName").textContent = JSON.parse(localStorage.getItem(PROFILE_CACHE))?.name ?? "Dia";
} catch {}
loadProfile();
render();
