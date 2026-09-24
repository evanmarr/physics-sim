import { test, assert } from "./helpers.js";
import * as G from "../src/geneticsMath.js";

const Aa = ["R", "r"];
test("monohybrid Aa x Aa gives 1:2:1 genotypes and 3:1 phenotypes", () => {
  const r = G.punnett("complete", [Aa], [Aa]);
  assert.equal(r.genoRatio, "1 : 2 : 1");
  assert.equal(r.phenoRatio, "3 : 1");
  assert.equal(G.fmtFraction(r.phenotypes[0].prob), "3/4");
  assert.equal(G.fmtPercent(r.phenotypes[1].prob), "25%");
});
test("dihybrid AaBb x AaBb gives 9:3:3:1 and 1:2:1:2:4:2:1:2:1", () => {
  const b = [Aa, ["Y", "y"]];
  const r = G.punnett("complete", b, b);
  assert.equal(r.total, 16);
  assert.equal(r.phenoRatio, "9 : 3 : 3 : 1");
  assert.equal(r.genoRatio, "1 : 2 : 1 : 2 : 4 : 2 : 1 : 2 : 1");
});
test("incomplete dominance Rr x Rr gives 1 red : 2 pink : 1 white", () => {
  const r = G.punnett("incomplete", [["R", "W"]], [["R", "W"]]);
  assert.equal(r.phenoRatio, "1 : 2 : 1");
  assert.deepEqual(r.phenotypes.map((p) => p.label), ["Red", "Pink", "White"]);
});
test("codominance gives roan heterozygotes", () => {
  const r = G.punnett("codominance", [["R", "R"]], [["W", "W"]]);
  assert.equal(r.phenotypes.length, 1);
  assert.match(r.phenotypes[0].label, /Roan/);
});
test("X-linked: carrier mother x normal father gives half of sons colour-blind", () => {
  const r = G.punnett("xlinked", [["XN", "Xc"]], [["XN", "Y"]]);
  const get = (l) => r.phenotypes.find((p) => p.label === l).prob;
  assert.equal(G.fmtFraction(get("Colour-blind male")), "1/4");
  assert.equal(G.fmtFraction(get("Normal-vision male")), "1/4");
  assert.equal(G.fmtFraction(get("Carrier female (normal vision)")), "1/4");
  assert.equal(G.fmtFraction(get("Normal-vision female")), "1/4");
});
test("X-linked: colour-blind father never passes it to sons", () => {
  const r = G.punnett("xlinked", [["XN", "XN"]], [["Xc", "Y"]]);
  assert.equal(r.phenotypes.some((p) => p.label === "Colour-blind male"), false);
});
test("chi-square p-values match textbook critical values", () => {
  assert.ok(Math.abs(G.chiSquarePValue(3.841, 1) - 0.05) < 0.001);
  assert.ok(Math.abs(G.chiSquarePValue(5.991, 2) - 0.05) < 0.001);
  assert.ok(Math.abs(G.chiSquarePValue(7.815, 3) - 0.05) < 0.001);
});
test("simulateOffspring is seed-reproducible and counts sum to n", () => {
  const r = G.punnett("complete", [Aa], [Aa]);
  const a = G.simulateOffspring(r, 200, G.mulberry32(5));
  const b = G.simulateOffspring(r, 200, G.mulberry32(5));
  assert.deepEqual(a.observed, b.observed);
  assert.equal(a.observed.reduce((x, y) => x + y), 200);
  assert.equal(a.expected[0], 150);
});
test("test cross: heterozygote shows 1/2 recessive, homozygote 0", () => {
  const t = G.testCrossTable(1);
  assert.equal(G.fmtFraction(t[0].recessiveFraction), "0");
  assert.equal(G.fmtFraction(t[1].recessiveFraction), "1/2");
  assert.equal(G.testCrossTable(2).length, 4);
});
test("Hardy-Weinberg expectations sum to 1 and test fits/fails", () => {
  const e = G.hweExpected(0.6);
  assert.ok(Math.abs(e.AA - 0.36) < 1e-12 && Math.abs(e.Aa - 0.48) < 1e-12 && Math.abs(e.aa - 0.16) < 1e-12);
  assert.equal(G.hweTest(36, 48, 16).fits, true);
  assert.equal(G.hweTest(50, 0, 50).fits, false);
});
test("Wright-Fisher is seed-reproducible, and small N drifts more than large N", () => {
  const base = { p0: 0.5, gens: 100, reps: 20, seed: 42 };
  const a = G.runWrightFisher({ ...base, N: 20 });
  assert.deepEqual(a, G.runWrightFisher({ ...base, N: 20 }));
  const spread = (lines) => { const f = lines.map((l) => l[l.length - 1]); const m = f.reduce((x, y) => x + y) / f.length; return f.reduce((s, x) => s + (x - m) ** 2, 0) / f.length; };
  assert.ok(spread(a) > spread(G.runWrightFisher({ ...base, N: 1000 })));
});
test("deterministic step: selection raises A, mutation/migration pull toward targets", () => {
  assert.ok(G.deterministicStep(0.5, { s: 0.1, h: 0.5 }) > 0.5);
  assert.ok(G.deterministicStep(0.5, { s: -0.1, h: 0.5 }) < 0.5);
  assert.ok(G.deterministicStep(1, { mu: 0.01 }) < 1);
  assert.ok(Math.abs(G.deterministicStep(0.2, { m: 0.5, pm: 0.8 }) - 0.5) < 1e-12);
  assert.equal(G.deterministicStep(0.3, {}), 0.3);
});
test("expected heterozygosity decays by 1/(2N) per generation", () => {
  assert.ok(Math.abs(G.expectedHeterozygosity(0.5, 50, 1) - 0.5 * 0.99) < 1e-12);
});
test("breeder: pure lines breed true, cross of opposites is all heterozygous", () => {
  const rng = G.mulberry32(1);
  const kids = G.breedLitter(G.makeGenotype("BBEETTSS"), G.makeGenotype("bbeettss"), rng, 10);
  assert.ok(kids.every((k) => G.genotypeString(k) === "BbEeTtSs"));
  assert.equal(G.describe(kids[0]), "blue, pointy, curly, spotted");
  assert.equal(G.genotypeString(G.makeGenotype("bBEeTtSs")), "BbEeTtSs");
});
test("breeder: Bb x Bb produces about 3:1 blue:orange", () => {
  const rng = G.mulberry32(9);
  let blue = 0; const n = 4000;
  for (let i = 0; i < n; i++) if (G.phenotypeOf(G.breed(G.makeGenotype("BbEEttss"), G.makeGenotype("BbEEttss"), rng)).color === "blue") blue++;
  assert.ok(Math.abs(blue / n - 0.75) < 0.03);
});
test("goals and stable sanitising", () => {
  assert.ok(G.goalMet(G.GOALS[0], G.makeGenotype("BbeeTtSs")));
  assert.equal(G.goalMet(G.GOALS[2], G.makeGenotype("BbEETTSS")), false);
  assert.ok(G.goalMet(G.GOALS[4], G.makeGenotype("BbEeTtSs")));
  const s = G.starterStable();
  assert.equal(G.sanitizeStable(JSON.stringify(s)).creatures.length, 4);
  assert.equal(G.sanitizeStable("garbage").creatures.length, 4);
  assert.ok(G.GENETICS_BLURB.length > 10);
});
