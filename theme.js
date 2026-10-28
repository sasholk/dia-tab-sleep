// Paints the cached profile color before first render; popup.js refreshes it from Dia.
try {
  const color = JSON.parse(localStorage.getItem("profile"))?.color;
  if (color) document.documentElement.style.setProperty("--profile", color);
} catch {}
