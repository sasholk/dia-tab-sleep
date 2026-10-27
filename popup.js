import { HOST, KEEP_RECENT, PROFILES, glowFrame, pickCandidates } from "./common.js";

const WEEK_MS = 7 * 24 * 3600 * 1000;
const FEEDBACK_MS = 5000;
const LAND_DELAY_MS = 300;
const TRIGGERS = { click: "button", shortcut: "shortcut", unfocus: "Dia unfocused", idle: "Mac idle" };
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

// The extension can't tell which Dia profile it runs in, so the user picks it once.
function applyProfile(name) {
  const known = Object.hasOwn(PROFILES, name ?? "");
  document.documentElement.style.setProperty("--profile", PROFILES[known ? name : "sasholk"]);
  $("profileName").textContent = known ? name : "Pick profile";
  $("chip").setAttribute("aria-label", known ? `Dia profile: ${name}, change` : "Pick Dia profile");
  for (const s of $("swatches").children) s.setAttribute("aria-pressed", String(s.dataset.profile === name));
  togglePicker(!known);
}

function togglePicker(open) {
  $("picker").hidden = !open;
  $("chip").setAttribute("aria-expanded", String(open));
}

function buildPicker() {
  $("swatches").replaceChildren(
    ...Object.entries(PROFILES).map(([name, color]) => {
      const swatch = el("button", "", "swatch");
      const dot = el("span", "", "dot");
      dot.style.background = color;
      swatch.dataset.profile = name;
      swatch.setAttribute("aria-label", `Use ${name} profile color`);
      swatch.append(dot, el("span", name));
      swatch.addEventListener("click", () => {
        chrome.storage.local.set({ profile: name });
        applyProfile(name);
        $("chip").focus();
      });
      return swatch;
    })
  );
  $("chip").addEventListener("click", () => togglePicker($("picker").hidden));
}

// Live per-tab memory needs chrome.processes (dev-channel only in most Chromium builds).
async function liveTopTabs() {
  if (!chrome.processes) return null;
  const procs = await new Promise((r) => chrome.processes.getProcessInfo([], true, r));
  return Object.values(procs)
    .flatMap((p) => p.tasks.filter((t) => t.tabId != null).map((t) => ({ title: t.title, mb: Math.round(p.privateMemory / 2 ** 20) })))
    .sort((a, b) => b.mb - a.mb)
    .slice(0, 3);
}

async function renderDia(capacityMB, usedMB) {
  const snap = await chrome.runtime.sendNativeMessage(HOST, { cmd: "snapshot" }).catch((e) => ({ error: e.message }));
  $("dia").classList.remove("loading");
  $("dia").textContent = snap.error ? "host unavailable" : mb(snap.total_mb);
  $("dia").title = snap.error ?? "";
  const diaMB = snap.total_mb ?? 0;
  $("barDia").style.width = `${(diaMB / capacityMB) * 100}%`;
  $("barRest").style.width = `${(Math.max(0, usedMB - diaMB) / capacityMB) * 100}%`;
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
  // `top` takes ~1s, so Dia's total fills in after the rest.
  renderDia(capacityMB, usedMB);

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

  const live = await liveTopTabs().catch(() => null);
  const top = live ?? week.flatMap((h) => h.tabs).filter((t) => t.mb).sort((a, b) => b.mb - a.mb).slice(0, 3);
  $("topTitle").textContent = live ? "Heaviest tabs now" : "Heaviest slept · 7 days";
  $("top").replaceChildren(...top.map(topItem));
  if (!top.length) $("top").replaceChildren(el("li", "Shows up after the next clean", "muted"));
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

buildPicker();
chrome.storage.local.get("profile").then(({ profile }) => applyProfile(profile));
render();
