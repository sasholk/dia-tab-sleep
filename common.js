export const KEEP_RECENT = 5;
export const HOST = "com.user.dia_mem";

// Every awake tab except the visible ones, ones playing audio, and the KEEP_RECENT most recently used.
export function pickCandidates(tabs) {
  const awake = tabs.filter((t) => !t.discarded);
  const recent = new Set(
    awake.toSorted((a, b) => b.lastAccessed - a.lastAccessed).slice(0, KEEP_RECENT).map((t) => t.id)
  );
  return awake.filter((t) => !t.active && !t.audible && !recent.has(t.id));
}
