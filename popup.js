const WEEK_MS = 7 * 24 * 3600 * 1000;
const FEEDBACK_MS = 5000;
const HOST = "com.user.dia_mem";
const TRIGGERS = { click: "кнопка", shortcut: "⌥⇧S", unfocus: "Dia неактивна", idle: "простій Mac" };

const $ = (id) => document.getElementById(id);
const mb = (n) => (n == null ? "?" : n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`);
const time = (ts) => new Date(ts).toLocaleString("uk-UA", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const sum = (list, pick) => list.reduce((s, x) => s + (pick(x) ?? 0), 0);

function li(left, right, tooltip = "") {
  const el = document.createElement("li");
  const l = document.createElement("span");
  const r = document.createElement("span");
  l.className = "ellipsis";
  l.textContent = left;
  r.textContent = right;
  el.title = tooltip;
  el.append(l, r);
  return el;
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

async function render() {
  const [{ capacity, availableCapacity }, tabs, { history = [] }] = await Promise.all([
    chrome.system.memory.getInfo(),
    chrome.tabs.query({}),
    chrome.storage.local.get("history"),
  ]);
  const toMB = (bytes) => Math.round(bytes / 2 ** 20);
  const usedMB = toMB(capacity - availableCapacity);
  $("ram").textContent = `${mb(usedMB)} / ${mb(toMB(capacity))}`;
  const sleeping = tabs.filter((t) => t.discarded).length;
  $("tabs").textContent = `Вкладки цього профілю: ${tabs.length - sleeping} активних · ${sleeping} сплять`;

  const week = history.filter((h) => Date.now() - h.at < WEEK_MS);
  $("week").textContent = week.length
    ? `${week.length} чисток · ${sum(week, (h) => h.count)} вкладок · ${mb(sum(week, (h) => h.freedMB))}`
    : "Чисток ще не було";

  $("history").replaceChildren(
    ...history.slice(-30).reverse().map((h) =>
      li(
        `${time(h.at)} · ${TRIGGERS[h.trigger]}`,
        `${h.count} вкл · ${mb(h.freedMB)}`,
        (h.tabs ?? []).map((t) => `${mb(t.mb)}  ${t.title}`).join("\n")
      )
    )
  );

  const live = await liveTopTabs().catch(() => null);
  const top = live ?? week.flatMap((h) => h.tabs ?? []).filter((t) => t.mb != null).sort((a, b) => b.mb - a.mb).slice(0, 3);
  $("topTitle").textContent = live ? "Найважчі вкладки зараз" : "Найважчі з приспаних за 7 днів";
  $("top").replaceChildren(...top.map((t) => li(t.title, mb(t.mb), t.title)));
  if (!top.length) $("top").replaceChildren(li("З'явиться після наступної чистки", ""));

  // `top` takes ~1s, so Dia's total arrives last.
  const snap = await chrome.runtime.sendNativeMessage(HOST, { cmd: "snapshot" }).catch((e) => ({ error: e.message }));
  $("dia").textContent = snap.error ? "помічник недоступний" : mb(snap.total_mb);
  $("dia").title = snap.error ?? "";
  if (snap.error) $("result").textContent = snap.error;
  const pct = (n) => `${(n / toMB(capacity)) * 100}%`;
  $("barDia").style.width = pct(snap?.total_mb ?? 0);
  $("barRest").style.width = pct(usedMB - (snap?.total_mb ?? 0));
}

$("sleep").addEventListener("click", async () => {
  $("sleep").disabled = true;
  $("result").textContent = "Чищу по одній вкладці…";
  showResult(await chrome.runtime.sendMessage({ type: "sleep" }));
  $("sleep").disabled = false;
  render();
});

function showResult({ count, freedMB }) {
  $("result").textContent = count ? `Приспано ${count}, звільнено ${mb(freedMB)}` : "Нічого приспати";
}

// Opened by the shortcut right after a clean → show the result, then close unless hovered.
chrome.storage.session.get("lastResult").then(({ lastResult }) => {
  if (lastResult?.trigger !== "shortcut" || Date.now() - lastResult.at > FEEDBACK_MS) return;
  showResult(lastResult);
  const timer = setTimeout(() => window.close(), FEEDBACK_MS);
  document.body.addEventListener("mouseenter", () => clearTimeout(timer), { once: true });
});

render();
