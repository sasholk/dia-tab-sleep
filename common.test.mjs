import assert from "node:assert/strict";
import { glowFrame, pickCandidates } from "./common.js";

const tab = (id, lastAccessed, extra = {}) => ({ id, lastAccessed, active: false, audible: false, discarded: false, ...extra });
const tabs = [
  tab(1, 100, { active: true }),
  tab(2, 1, { audible: true }),
  tab(3, 999, { discarded: true }), // asleep: neither a candidate nor one of the kept recent
  ...[4, 5, 6, 7, 8, 9, 10].map((id) => tab(id, id)),
];
// Recent 5 among awake tabs: 1, 10, 9, 8, 7 → candidates are the older awake ones, minus audible.
assert.deepEqual(pickCandidates(tabs).map((t) => t.id), [4, 5, 6]);
console.log("ok");

// Glow: the top wash travels down with progress, turns into the aurora, and lands at the bottom.
assert.deepEqual(glowFrame({ phase: "idle" }), { y: 0, washOpacity: 0.55, auroraOpacity: 0, landed: false });
assert.deepEqual(glowFrame({ phase: "running", done: 4, total: 9 }), { y: 240, washOpacity: 0.28, auroraOpacity: 0.45, landed: false });
assert.deepEqual(glowFrame({ phase: "done" }), { y: 590, washOpacity: 0, auroraOpacity: 0.9, landed: true });
console.log("glow ok");
