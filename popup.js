const WEEK_MS = 7 * 24 * 3600 * 1000;
const TRIGGERS = { click: "кнопка", shortcut: "⌥⇧S", unfocus: "Dia неактивна", idle: "простій Mac" };

const $ = (id) => document.getElementById(id);
const gb = (bytes) => `${(bytes / 2 ** 30).toFixed(1)} GB`;
const mb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`);
const time = (ts) => new Date(ts).toLocaleString("uk-UA", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const sum = (list, key) => list.reduce((s, h) => s + h[key], 0);

async function render() {
  const [{ capacity, availableCapacity }, tabs, { history = [] }] = await Promise.all([
    chrome.system.memory.getInfo(),
    chrome.tabs.query({}),
    chrome.storage.local.get("history"),
  ]);

  const used = capacity - availableCapacity;
  $("ram").textContent = `${gb(used)} / ${gb(capacity)}`;
  $("bar").style.width = `${(used / capacity) * 100}%`;
  const sleeping = tabs.filter((t) => t.discarded).length;
  $("tabs").textContent = `Вкладки цього профілю: ${tabs.length - sleeping} активних · ${sleeping} сплять`;

  const week = history.filter((h) => Date.now() - h.at < WEEK_MS);
  $("week").textContent = week.length
    ? `${week.length} чисток · ${sum(week, "count")} вкладок · ~${mb(sum(week, "freedMB"))}`
    : "Чисток ще не було";

  $("history").replaceChildren(
    ...history.slice(-30).reverse().map((h) => {
      const li = document.createElement("li");
      li.title = h.titles.join("\n");
      li.innerHTML = `<span>${time(h.at)} · <span class="muted">${TRIGGERS[h.trigger]}</span></span><span>${h.count} вкл · ~${mb(h.freedMB)}</span>`;
      return li;
    })
  );
}

$("sleep").addEventListener("click", async () => {
  $("sleep").disabled = true;
  $("result").textContent = "Чищу…";
  const { count, freedMB } = await chrome.runtime.sendMessage({ type: "sleep" });
  $("result").textContent = count ? `Приспано ${count}, звільнено ~${mb(freedMB)}` : "Нічого приспати";
  $("sleep").disabled = false;
  render();
});

render();
