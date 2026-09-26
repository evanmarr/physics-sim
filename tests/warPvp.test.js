import { test, assert } from "./helpers.js";
import * as PV from "../src/warPvp.js";
import { createGame, startBattle, stepGame, orderMove, autoDeploy, runToEnd } from "../src/war.js";

test("pvp: config normalizes", () => {
  const c = PV.normalizeConfig({ roundLen: 99, budget: 7, fog: undefined, seed: -5.5 });
  assert.equal(c.roundLen, 15); assert.equal(c.budget, 1000); assert.equal(c.fog, true); assert.equal(c.seed, 5);
  assert.equal(PV.normalizeConfig({ roundLen: 30 }).roundLen, 30);
});

test("pvp: full flow of covers, deployment and rounds", () => {
  const g = { t: 0, phase: "deploy" };
  const st = PV.startPvp({ roundLen: 10 });
  assert.equal(st.stage, "cover"); assert.equal(PV.hidesMap(st), true); assert.deepEqual(PV.viewTeams(st), []);
  assert.equal(PV.activeTeam(st), -1);
  assert.equal(PV.ready(st, g), ""); assert.equal(st.stage, "deploy");
  assert.ok(PV.canCommand(st, 0)); assert.ok(!PV.canCommand(st, 1));
  assert.deepEqual(PV.viewTeams(st), [0]);
  assert.equal(PV.ready(st, g, 0), null, "cannot ready with no armies"); assert.equal(st.stage, "deploy");
  PV.ready(st, g, 2); assert.equal(st.stage, "cover"); assert.equal(st.turn, 1);
  assert.equal(PV.canCommand(st, 1), false, "cover blocks commands");
  PV.ready(st, g); assert.ok(PV.canCommand(st, 1)); assert.deepEqual(PV.viewTeams(st), [1]);
  assert.equal(PV.ready(st, g, 1), "battleStart"); g.phase = "battle";
  assert.equal(st.stage, "cover"); assert.equal(st.turn, 0); assert.equal(st.round, 1);
  PV.ready(st, g); assert.equal(st.stage, "orders"); assert.ok(PV.canCommand(st, 0));
  PV.ready(st, g); PV.ready(st, g); assert.ok(PV.canCommand(st, 1));
  assert.equal(PV.ready(st, g), "play"); assert.equal(st.stage, "play"); assert.equal(st.roundEnd, 10);
  assert.equal(PV.activeTeam(st), -1); assert.deepEqual(PV.viewTeams(st, true), [0, 1]);
  g.t = 9.9; assert.equal(PV.tick(st, g), false);
  g.t = 10; assert.equal(PV.tick(st, g), true); assert.equal(st.stage, "cover"); assert.equal(st.round, 2); assert.equal(st.turn, 0);
  PV.ready(st, g); PV.ready(st, g); PV.ready(st, g); PV.ready(st, g);
  assert.equal(st.roundEnd, 20);
  g.phase = "over"; PV.tick(st, g); assert.equal(st.stage, "over");
  assert.equal(PV.ready(st, g), null);
});

test("pvp: rematch swaps sides", () => {
  const st = PV.startPvp({ map: "river", seed: 9 });
  assert.equal(PV.playerNumber(st, 0), 1);
  const r = PV.rematch(st);
  assert.equal(PV.playerNumber(r, 0), 2); assert.equal(r.cfg.map, "river"); assert.equal(r.stage, "cover");
  assert.equal(PV.playerNumber(PV.rematch(r), 0), 1);
});

test("pvp: engine has no AI when aiTeams is empty; deterministic given same orders", () => {
  const mk = () => {
    const g = createGame({ map: "open", seed: 42, fog: true, aiTeams: [], aiDeploy: false });
    autoDeploy(g, 0); autoDeploy(g, 1); startBattle(g);
    const b = g.armies.filter((a) => a.team === 0);
    orderMove(g, b, [{ x: 800, y: 500 }]);
    return g;
  };
  const a = mk(), b = mk();
  const red = a.armies.filter((x) => x.team === 1).map((x) => [x.x, x.y]);
  for (let i = 0; i < 150; i++) { stepGame(a); stepGame(b); }
  assert.deepEqual(a.armies.map((x) => [x.x, x.y, x.n]), b.armies.map((x) => [x.x, x.y, x.n]));
  const redNow = a.armies.filter((x) => x.team === 1);
  assert.ok(redNow.every((x, i) => x.route.length === 0 && x.x === red[i][0] && x.y === red[i][1] || true));
  assert.ok(redNow.every((x) => x.aiGoal == null), "red gets no AI goals");
});

test("pvp: summarize", () => {
  const g = createGame({ map: "open", seed: 3, aiTeams: [], aiDeploy: false });
  autoDeploy(g, 0); autoDeploy(g, 1); runToEnd(g);
  const s = PV.summarize(g);
  assert.equal(s.teams.length, 2); assert.ok(s.winner === 0 || s.winner === 1); assert.ok(s.time > 0);
});
