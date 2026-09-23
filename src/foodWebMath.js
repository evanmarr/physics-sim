// Pure food-web analysis (no DOM) so it can be unit-tested. Links point from
// predator to prey. "sun" (energy) and "decomposer" (recycling) are drawn in
// the web but are not prey/predator relationships, so the ecology maths
// below ignores them.
const NON_FOOD = new Set(["sun", "decomposer"]);

export function feedingLinks(organisms, selectedIds) {
  const sel = new Set(selectedIds);
  const links = [];
  for (const o of organisms) {
    if (!sel.has(o.id)) continue;
    for (const preyId of o.eats) if (sel.has(preyId)) links.push({ source: o.id, target: preyId, kind: preyId === "sun" ? "energy" : o.id === "decomposer" ? "decay" : "food" });
  }
  return links;
}

const foodOnly = (links) => links.filter((l) => l.kind === "food");

export function preyOf(organisms, id) { return organisms.find((o) => o.id === id)?.eats.filter((e) => !NON_FOOD.has(e)) ?? []; }
export function predatorsOf(organisms, id) { return organisms.filter((o) => o.id !== "decomposer" && o.eats.includes(id)).map((o) => o.id); }

// Longest chain of eaten-by links among the selected organisms, counted in organisms.
export function longestChain(organisms, selectedIds) {
  const links = foodOnly(feedingLinks(organisms, selectedIds));
  const preyMap = new Map();
  for (const l of links) { if (!preyMap.has(l.source)) preyMap.set(l.source, []); preyMap.get(l.source).push(l.target); }
  const memo = new Map();
  const depth = (id, seen) => {
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return 1; // cycle guard
    seen.add(id);
    const best = 1 + Math.max(0, ...(preyMap.get(id) || []).map((p) => depth(p, seen)));
    seen.delete(id);
    memo.set(id, best);
    return best;
  };
  let longest = 0;
  for (const id of selectedIds) longest = Math.max(longest, depth(id, new Set()));
  return longest;
}

// Organism with the most feeding links (eats + eaten-by) — a simple "how
// connected is it" measure, not a formal keystone-species calculation.
export function mostConnected(organisms, selectedIds) {
  const count = new Map();
  for (const l of foodOnly(feedingLinks(organisms, selectedIds))) {
    count.set(l.source, (count.get(l.source) || 0) + 1);
    count.set(l.target, (count.get(l.target) || 0) + 1);
  }
  let best = null;
  for (const [id, n] of count) if (!best || n > best.links) best = { id, links: n };
  return best;
}

// What happens if `removedId` vanishes: consumers left with NO food among the
// remaining organisms "starve" (and the loss cascades upward); consumers that
// lose only some prey are "stressed".
export function removalEffect(organisms, selectedIds, removedId) {
  const byId = new Map(organisms.map((o) => [o.id, o]));
  const web = new Set(selectedIds);
  const gone = new Set([removedId]);
  const starved = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of web) {
      if (gone.has(id) || NON_FOOD.has(id)) continue;
      const before = byId.get(id).eats.filter((e) => web.has(e) && !NON_FOOD.has(e));
      if (!before.length) continue; // producers, or consumers with no prey in this web to begin with
      if (before.every((e) => gone.has(e))) { gone.add(id); starved.push(id); changed = true; }
    }
  }
  const stressed = [];
  for (const id of web) {
    if (gone.has(id) || NON_FOOD.has(id)) continue;
    const before = byId.get(id).eats.filter((e) => web.has(e) && !NON_FOOD.has(e));
    const lost = before.filter((e) => gone.has(e));
    if (lost.length && lost.length < before.length) stressed.push({ id, lost });
  }
  // Release: prey that lose a predator may boom — only when ALL its
  // predators in this web are gone (otherwise still held in check).
  const boom = [];
  for (const id of web) {
    if (gone.has(id) || NON_FOOD.has(id)) continue;
    const preds = predatorsOf(organisms, id).filter((p) => web.has(p));
    if (preds.length && preds.every((p) => gone.has(p))) boom.push(id);
  }
  return { starved, stressed, boom };
}
