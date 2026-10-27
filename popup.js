import { HOST, KEEP_RECENT, pickCandidates } from "./common.js";

const WEEK_MS = 7 * 24 * 3600 * 1000;
const FEEDBACK_MS = 5000;
const TRIGGERS = { click: "кнопка", shortcut: "⌥⇧S", unfocus: "Dia неактивна", idle: "простій Mac" };

const $ = (id) => document.getElementById(id);
const mb = (n) => (n == null ? "?" : n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`);
const time = (ts) => new Date(ts).toLocaleString("uk-UA", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const sum = (list, pick) => list.reduce((s, x) => s + (pick(x) ?? 0), 0);
const plural = (n) => (n % 10 === 1 && n % 100 !== 11 ? "вкладку" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "вкладки" : "вкладок");

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

function historyItem(h) {
  const details = el("details");
  details.append(row("summary", `${time(h.at)} · ${TRIGGERS[h.trigger]}`, `${h.count} вкл · ${mb(h.freedMB)}`));
  const list = el("ul");
  list.append(...h.tabs.map((t) => row("li", t.title, mb(t.mb), t.title)));
  details.append(list);
  return details;
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
  $("dia").textContent = snap.error ? "помічник недоступний" : mb(snap.total_mb);
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
  $("tabs").textContent = `Вкладки цього профілю: ${tabs.length - sleeping} активних · ${sleeping} сплять`;

  const n = pickCandidates(tabs).length;
  $("sleep").disabled = !n;
  $("sleep").textContent = n ? `Приспати ${n} ${plural(n)}` : "Усі старі вкладки сплять";
  $("sleep").title = `Не чіпає відкриті, ті що грають звук, і ${KEEP_RECENT} останніх`;

  const week = history.filter((h) => Date.now() - h.at < WEEK_MS);
  $("week").textContent = week.length
    ? `${week.length} чисток · ${sum(week, (h) => h.count)} вкладок · ${mb(sum(week, (h) => h.freedMB))}`
    : "Чисток ще не було";
  $("history").replaceChildren(...history.slice(-30).reverse().map(historyItem));
  if (!history.length) $("history").replaceChildren(el("div", "Порожньо", "muted"));

  const live = await liveTopTabs().catch(() => null);
  const top = live ?? week.flatMap((h) => h.tabs).filter((t) => t.mb).sort((a, b) => b.mb - a.mb).slice(0, 3);
  $("topTitle").textContent = live ? "Найважчі вкладки зараз" : "Найважчі з приспаних за 7 днів";
  $("top").replaceChildren(...top.map((t) => row("li", t.title, mb(t.mb), t.title)));
  if (!top.length) $("top").replaceChildren(el("li", "З'явиться після наступної чистки", "muted"));
}

function showResult({ count, freedMB }) {
  $("result").textContent = count ? `Приспано ${count}, звільнено ${mb(freedMB)}` : "Нічого приспати";
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "progress") $("result").textContent = `Присипляю ${msg.done + 1} з ${msg.total}…`;
});

$("sleep").addEventListener("click", async () => {
  $("sleep").disabled = true;
  $("result").textContent = "Готуюсь…";
  showResult(await chrome.runtime.sendMessage({ type: "sleep" }));
  render();
});

// Opened by the shortcut right after a clean → show the result, then close unless hovered.
chrome.storage.session.get("lastResult").then(({ lastResult }) => {
  if (lastResult?.trigger !== "shortcut" || Date.now() - lastResult.at > FEEDBACK_MS) return;
  showResult(lastResult);
  const timer = setTimeout(() => window.close(), FEEDBACK_MS);
  document.body.addEventListener("mouseenter", () => clearTimeout(timer), { once: true });
});

render();
