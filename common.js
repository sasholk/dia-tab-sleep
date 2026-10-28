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


const TRAVEL_PX = 480;
const LANDED_PX = 590;
const WASH_OPACITY = 0.55;
const AURORA_OPACITY = 0.9;
const round2 = (n) => Math.round(n * 100) / 100;

// Where the glow sits during a clean: the top wash travels down with progress and lands as the aurora.
export function glowFrame({ phase, done = 0, total = 1 }) {
  if (phase === "done") return { y: LANDED_PX, washOpacity: 0, auroraOpacity: AURORA_OPACITY, landed: true };
  const progress = phase === "running" ? (done + 1) / (total + 1) : 0;
  return {
    y: Math.round(progress * TRAVEL_PX),
    washOpacity: round2(WASH_OPACITY * (1 - progress)),
    auroraOpacity: round2(AURORA_OPACITY * progress),
    landed: false,
  };
}
