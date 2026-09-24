import { test, assert } from "./helpers.js";
import * as C from "../src/warCampaign.js";
import { armyCost, normComp, createGame, addArmy, runToEnd, MAPS } from "../src/war.js";

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test("campaign: unitCost matches the engine armyCost", () => {
  for (const [n, arc, cav] of [[100, 0, 0], [80, 0.3, 0.2], [150, 0.7, 0.1]]) assert.ok(Math.abs(C.unitCost(n, arc, cav) - armyCost(n, normComp(arc, cav))) < 1e-9);
});

test("campaign: every scenario builds and its terrains map to real battle maps", () => {
  const ids = MAPS.map((m) => m.id);
  for (const sc of C.SCENARIOS) {
    const s = C.newCampaign(sc.id);
    assert.equal(s.regions.length, 10);
    assert.equal(s.regions[0].owner, 0);
    assert.equal(s.regions.filter((r) => r.owner === 1).length, 9);
    for (const r of s.regions) assert.ok(ids.includes(C.TERRAINS[r.terrain].map));
    // garrisons grow with distance from the start
    assert.ok(s.regions[4].garrison > s.regions[1].garrison);
    assert.ok(s.regions[9].garrison > s.regions[8].garrison * 0.9);
  }
  assert.ok(C.newCampaign("frontier").regions[9].garrison > C.newCampaign("marches").regions[9].garrison);
});

test("campaign: only border regions can be attacked", () => {
  const s = C.newCampaign("marches");
  assert.deepEqual(C.attackableRegions(s).sort(), [1, 2, 3]);
  assert.ok(C.canAttack(s, 1).ok);
  assert.ok(!C.canAttack(s, 9).ok);
  assert.ok(!C.canAttack(s, 0).ok);
});

test("campaign: victory captures the region and losses persist", () => {
  const s = C.newCampaign("marches");
  const before = C.rosterTotal(s);
  const setup = C.battleSetup(s, 1);
  assert.equal(setup.startTotal, before);
  C.applyBattle(s, 1, { won: true, survivors: before * 0.7, startTotal: before, enemyFrac: 0 });
  assert.equal(s.regions[1].owner, 0);
  assert.ok(Math.abs(C.rosterTotal(s) - before * 0.7) <= s.roster.length);
  assert.ok(s.attacked);
  assert.ok(!C.canAttack(s, 2).ok);
  assert.ok(C.attackableRegions(s).includes(4));
});

test("campaign: defeat keeps the region enemy-held, weakens it, and can end the campaign", () => {
  const s = C.newCampaign("marches");
  const g0 = s.regions[2].garrison, t = C.rosterTotal(s);
  C.applyBattle(s, 2, { won: false, survivors: t * 0.3, startTotal: t, enemyFrac: 0.6 });
  assert.equal(s.regions[2].owner, 1);
  assert.ok(s.regions[2].garrison < g0);
  assert.equal(s.status, "active");
  s.gold = 0;
  C.applyBattle(s, 2, { won: false, survivors: 0, startTotal: C.rosterTotal(s), enemyFrac: 1 });
  assert.equal(s.status, "lost");
});

test("campaign: capturing the enemy capital wins", () => {
  const s = C.newCampaign("marches");
  for (const r of s.regions) r.owner = 0;
  s.regions[9].owner = 1;
  C.applyBattle(s, 9, { won: true, survivors: 100, startTotal: 200, enemyFrac: 0 });
  assert.equal(s.status, "won");
  assert.ok(C.summary(s).won);
});

test("campaign: recruiting spends gold and respects limits", () => {
  const s = C.newCampaign("marches");
  const g = s.gold;
  const r = C.recruit(s, { armyId: null, n: 50, arcPct: 20, cavPct: 10 });
  assert.ok(r.ok);
  assert.equal(s.gold, g - r.cost);
  assert.equal(r.cost, C.recruitCost(50, 20, 10));
  assert.ok(!C.recruit(s, { armyId: null, n: 5, arcPct: 0, cavPct: 0 }).ok);
  s.gold = 1;
  assert.ok(!C.recruit(s, { armyId: null, n: 100, arcPct: 0, cavPct: 0 }).ok);
  s.gold = 5000;
  const first = s.roster[0], n0 = first.n;
  assert.ok(C.recruit(s, { armyId: first.id, n: 40, arcPct: 0, cavPct: 100 }).ok);
  assert.equal(first.n, n0 + 40);
  while (s.roster.length < C.MAX_ROSTER) C.recruit(s, { armyId: null, n: 10, arcPct: 0, cavPct: 0 });
  assert.ok(!C.recruit(s, { armyId: null, n: 10, arcPct: 0, cavPct: 0 }).ok);
});

test("campaign: fortify costs gold and caps out", () => {
  const s = C.newCampaign("marches"); s.gold = 1000;
  const f0 = s.regions[0].fort;
  assert.ok(C.fortify(s, 0).ok);
  assert.equal(s.regions[0].fort, f0 + 1);
  assert.ok(!C.fortify(s, 5).ok);
  while (C.fortify(s, 0).ok);
  assert.equal(s.regions[0].fort, 2);
});

test("campaign: end turn pays income, levies, advances turn, deterministically", () => {
  const a = C.newCampaign("rivers"), b = C.newCampaign("rivers");
  const g = a.gold, inc = C.income(a);
  C.endTurn(a); C.endTurn(b);
  assert.ok(a.gold >= g + inc - 1);
  assert.equal(a.turn, 2);
  assert.deepEqual(a.regions, b.regions);
  assert.ok(a.lastReport.length > 0);
});

test("campaign: a strong enemy can take an undefended region; capital loss ends the game", () => {
  const s = C.newCampaign("frontier");
  s.roster = []; s.gold = 999;
  s.regions[0].garrison = 1; s.regions[0].fort = 0;
  for (const r of s.regions) if (r.owner === 1) r.garrison = 900;
  for (let i = 0; i < 6 && s.status === "active"; i++) C.endTurn(s);
  assert.equal(s.status, "lost");
});

test("campaign: supply distance grows through conquered land and lowers morale", () => {
  const s = C.newCampaign("rivers");
  assert.equal(C.supplyDistance(s, 1), 1);
  s.regions[1].owner = 0;
  assert.equal(C.supplyDistance(s, 4), 2);
  assert.equal(C.moralePenalty(s, 4), 4);
  assert.ok(C.battleSetup(s, 4).armies[0].morale <= 96);
});

test("campaign: save / load / clear round-trips and rejects junk", () => {
  const st = mem();
  assert.equal(C.loadCampaign(st), null);
  const s = C.newCampaign("marches"); C.endTurn(s);
  assert.ok(C.saveCampaign(s, st));
  assert.deepEqual(C.loadCampaign(st).regions, s.regions);
  st.setItem(C.CAMPAIGN_KEY, "{oops");
  assert.equal(C.loadCampaign(st), null);
  st.setItem(C.CAMPAIGN_KEY, JSON.stringify({ v: 1, regions: [] }));
  assert.equal(C.loadCampaign(st), null);
  C.saveCampaign(s, st); C.clearCampaign(st);
  assert.equal(C.loadCampaign(st), null);
});

test("campaign: a campaign battle plays out on the real engine", () => {
  const s = C.newCampaign("marches");
  const setup = C.battleSetup(s, 1);
  const g = createGame({ map: setup.map, difficulty: setup.difficulty, seed: setup.seed, aiDeploy: false });
  g.budget[1] = setup.enemyBudget;
  assert.ok(g.aiTeams.length === 1);
  for (const a of setup.armies) addArmy(g, 0, 150, 200 + a.id * 120, a.n, normComp(a.arc, a.cav));
  runToEnd(g);
  assert.equal(g.phase, "over");
});
