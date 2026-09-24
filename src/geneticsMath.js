// Pure, DOM-free genetics logic for the Genetics Lab (Punnett squares,
// Wright-Fisher population genetics, Hardy-Weinberg, and the Breeder game).
// Everything here is deterministic given an RNG, so it is unit-tested.

export const GENETICS_BLURB = "Cross parents on Punnett squares, watch alleles drift and get selected in populations, and breed critters to reason your way to a target genotype.";

// ---------- RNG ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function newSeed() { return (Math.random() * 4294967296) >>> 0; }

// ---------- fractions ----------
export function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; }
export function fraction(n, d) { const g = gcd(n, d); return { n: n / g, d: d / g }; }
export function fmtFraction(f) { return f.n === 0 ? "0" : f.d === 1 ? String(f.n) : `${f.n}/${f.d}`; }
export function fmtPercent(f) { const v = (100 * f.n) / f.d; return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + "%"; }
export function ratioString(counts) {
  const nz = counts.filter((c) => c > 0);
  if (!nz.length) return "";
  const g = nz.reduce((a, b) => gcd(a, b));
  return counts.map((c) => c / g).join(" : ");
}

// ---------- chi-square ----------
function gammaLn(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
// Regularized upper incomplete gamma Q(a, x)
export function gammaQ(a, x) {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-14) break; }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gammaLn(a));
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammaLn(a)) * h;
}
export function chiSquarePValue(chi2, df) { return df <= 0 ? 1 : gammaQ(df / 2, chi2 / 2); }
export function chiSquare(observed, expected) {
  let chi2 = 0;
  for (let i = 0; i < observed.length; i++) if (expected[i] > 0) chi2 += (observed[i] - expected[i]) ** 2 / expected[i];
  const df = observed.length - 1;
  const p = chiSquarePValue(chi2, df);
  return { chi2, df, p, smallExpected: expected.some((e) => e < 5) };
}
export function explainChiSquare(res) {
  if (res.df < 1) return "Only one outcome is possible, so there is nothing to test.";
  const c = res.chi2.toFixed(2), p = res.p < 0.001 ? "< 0.001" : res.p.toFixed(3);
  let s = `Chi-square = ${c} with ${res.df} degree${res.df === 1 ? "" : "s"} of freedom, p = ${p}. `;
  s += res.p >= 0.05
    ? "That is a normal amount of scatter: results this far from the prediction happen by chance more than 1 time in 20, so the data fit the expected ratio. "
    : "Results this far from the prediction would happen by chance less than 1 time in 20, so the data do NOT fit the expected ratio (that also happens by luck about 5% of the time, even when the ratio is right). ";
  if (res.smallExpected) s += "Caution: some expected counts are below 5, so chi-square is unreliable here; try more offspring.";
  return s;
}

// ---------- Punnett squares ----------
// A locus genotype is a 2-token array, e.g. ["R","r"]. A parent is an array
// of locus genotypes (1 for monohybrid, 2 for dihybrid).
const SUP = { N: "ᴺ", c: "ᶜ" };
const plain = (t) => t;
const xTok = (t) => (t === "Y" ? "Y" : "X" + (SUP[t.slice(1)] || t.slice(1)));

export const PATTERNS = [
  {
    id: "complete", label: "Complete dominance", dihybrid: true,
    blurb: "One allele (dominant) fully masks the other (recessive). Heterozygotes look identical to dominant homozygotes. Example: Mendel's pea seed shape and colour.",
    loci: [
      { name: "Seed shape", order: ["R", "r"], tok: plain, pheno: (g) => (g.includes("R") ? "Round" : "Wrinkled") },
      { name: "Seed colour", order: ["Y", "y"], tok: plain, pheno: (g) => (g.includes("Y") ? "Yellow" : "Green") },
    ],
  },
  {
    id: "incomplete", label: "Incomplete dominance", dihybrid: true,
    blurb: "Heterozygotes are an intermediate blend. Example: snapdragon flowers, where red x white gives pink, and pink x pink gives 1 red : 2 pink : 1 white.",
    loci: [
      { name: "Snapdragon flower colour", order: ["R", "W"], tok: plain, pheno: (g) => (g[0] === g[1] ? (g[0] === "R" ? "Red" : "White") : "Pink") },
      { name: "Second gene (illustrative)", order: ["L", "S"], tok: plain, pheno: (g) => (g[0] === g[1] ? (g[0] === "L" ? "Long petals" : "Short petals") : "Medium petals") },
    ],
  },
  {
    id: "codominance", label: "Codominance", dihybrid: true,
    blurb: "Both alleles are fully expressed in heterozygotes. Examples: roan cattle (red and white hairs side by side) and the human MN blood group.",
    loci: [
      { name: "Cattle coat", order: ["R", "W"], tok: plain, pheno: (g) => (g[0] === g[1] ? (g[0] === "R" ? "Red" : "White") : "Roan (red + white)") },
      { name: "MN blood group", order: ["M", "N"], tok: plain, pheno: (g) => (g[0] === g[1] ? g[0] + " type" : "MN type") },
    ],
  },
  {
    id: "xlinked", label: "X-linked recessive", dihybrid: false,
    blurb: "The gene sits on the X chromosome. Females (XX) carry two copies; males (XY) have one, so a single recessive allele shows. Examples: red-green colour blindness and hemophilia A.",
    loci: [
      {
        name: "Red-green colour vision", order: ["XN", "Xc", "Y"], tok: xTok,
        pheno: (g) => {
          if (g.includes("Y")) return g.includes("Xc") ? "Colour-blind male" : "Normal-vision male";
          const c = g.filter((t) => t === "Xc").length;
          return c === 0 ? "Normal-vision female" : c === 1 ? "Carrier female (normal vision)" : "Colour-blind female";
        },
      },
    ],
  },
];
export function getPattern(id) { return PATTERNS.find((p) => p.id === id) || PATTERNS[0]; }

// Genotype choices for a locus. For X-linked, parent1 = mother, parent2 = father.
export function genotypeChoices(patternId, locusIdx, role) {
  const L = getPattern(patternId).loci[locusIdx];
  if (patternId === "xlinked") {
    return role === "parent1" ? [["XN", "XN"], ["XN", "Xc"], ["Xc", "Xc"]] : [["XN", "Y"], ["Xc", "Y"]];
  }
  const [a, b] = L.order;
  return [[a, a], [a, b], [b, b]];
}
export function genotypeLabel(patternId, locusIdx, g) {
  const L = getPattern(patternId).loci[locusIdx];
  return g.map(L.tok).join("");
}
export function normalizeGenotype(order, g) {
  return [...g].sort((x, y) => order.indexOf(x) - order.indexOf(y));
}
export function gametes(parent) {
  let out = [[]];
  for (const g of parent) {
    const next = [];
    for (const o of out) for (const t of g) next.push([...o, t]);
    out = next;
  }
  return out;
}
export function punnett(patternId, parent1, parent2) {
  const pat0 = getPattern(patternId);
  const pat = { ...pat0, loci: pat0.loci.slice(0, parent1.length) };
  const rows = gametes(parent1), cols = gametes(parent2);
  const total = rows.length * cols.length;
  const cells = rows.map((r) => cols.map((c) => {
    const loci = pat.loci.map((L, i) => normalizeGenotype(L.order, [r[i], c[i]]));
    return {
      loci,
      key: loci.map((g) => g.join("|")).join(" "),
      display: loci.map((g, i) => g.map(pat.loci[i].tok).join("")).join(" "),
      pheno: loci.map((g, i) => pat.loci[i].pheno(g)).join(", "),
    };
  }));
  const sortKey = (loci) => loci.map((g, i) => g.map((t) => pat.loci[i].order.indexOf(t)).join("")).join("-");
  const gm = new Map();
  for (const row of cells) for (const c of row) {
    if (!gm.has(c.key)) gm.set(c.key, { key: c.key, display: c.display, pheno: c.pheno, count: 0, sort: sortKey(c.loci) });
    gm.get(c.key).count++;
  }
  const genotypes = [...gm.values()].sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
  const pm = new Map();
  for (const g of genotypes) {
    if (!pm.has(g.pheno)) pm.set(g.pheno, { label: g.pheno, count: 0 });
    pm.get(g.pheno).count += g.count;
  }
  const phenotypes = [...pm.values()];
  for (const x of [...genotypes, ...phenotypes]) x.prob = fraction(x.count, total);
  return {
    rows, cols, cells, total, genotypes, phenotypes,
    genoRatio: ratioString(genotypes.map((g) => g.count)),
    phenoRatio: ratioString(phenotypes.map((p) => p.count)),
  };
}
export function simulateOffspring(result, n, rng) {
  const flat = result.cells.flat();
  const geno = new Map(result.genotypes.map((g) => [g.key, 0]));
  const pheno = new Map(result.phenotypes.map((p) => [p.label, 0]));
  for (let i = 0; i < n; i++) {
    const c = flat[Math.floor(rng() * flat.length)];
    geno.set(c.key, geno.get(c.key) + 1);
    pheno.set(c.pheno, pheno.get(c.pheno) + 1);
  }
  const observed = result.phenotypes.map((p) => pheno.get(p.label));
  const expected = result.phenotypes.map((p) => (n * p.prob.n) / p.prob.d);
  return { n, geno, pheno, observed, expected, chi: chiSquare(observed, expected) };
}
// Test cross (complete dominance): unknown dominant-phenotype individual x
// homozygous recessive. Returns, for each possible unknown genotype, the
// fraction of offspring showing the all-recessive phenotype.
export function testCrossTable(nLoci) {
  const pat = getPattern("complete");
  const opts = (i) => genotypeChoices("complete", i, "parent1").slice(0, 2); // homozygous dominant, heterozygous
  const tester = pat.loci.slice(0, nLoci).map((L) => [L.order[1], L.order[1]]);
  const out = [];
  const combos = nLoci === 1 ? opts(0).map((a) => [a]) : opts(0).flatMap((a) => opts(1).map((b) => [a, b]));
  for (const unknown of combos) {
    const r = punnett("complete", unknown, tester);
    const rec = r.phenotypes.find((p) => p.label === pat.loci.slice(0, nLoci).map((L) => L.pheno([L.order[1], L.order[1]])).join(", "));
    out.push({ unknown, recessiveFraction: rec ? rec.prob : fraction(0, 1), result: r });
  }
  return out;
}

// ---------- Wright-Fisher ----------
function binomial(n, p, rng) {
  if (p <= 0) return 0;
  if (p >= 1) return n;
  let k = 0;
  for (let i = 0; i < n; i++) if (rng() < p) k++;
  return k;
}
// One generation of deterministic forces (selection -> mutation -> migration).
// s: fitness advantage of AA over aa; Aa has 1 + h*s. mu: symmetric mutation
// rate per allele per generation. m: fraction of migrants from a source
// population with allele frequency pm.
export function deterministicStep(p, { s = 0, h = 0.5, mu = 0, m = 0, pm = 0.5 } = {}) {
  const q = 1 - p;
  const wAA = 1 + s, wAa = 1 + h * s, waa = 1;
  const wbar = p * p * wAA + 2 * p * q * wAa + q * q * waa;
  let x = (p * p * wAA + p * q * wAa) / wbar;
  x = x * (1 - mu) + (1 - x) * mu;
  x = (1 - m) * x + m * pm;
  return Math.min(1, Math.max(0, x));
}
export function wrightFisherStep(p, N, params, rng) {
  const x = deterministicStep(p, params);
  return binomial(2 * N, x, rng) / (2 * N);
}
export function runWrightFisher({ N, p0, gens, reps, seed, s = 0, h = 0.5, mu = 0, m = 0, pm = 0.5 }) {
  const rng = mulberry32(seed);
  const lines = [];
  for (let r = 0; r < reps; r++) {
    const traj = [p0];
    let p = p0;
    for (let t = 0; t < gens; t++) { p = wrightFisherStep(p, N, { s, h, mu, m, pm }, rng); traj.push(p); }
    lines.push(traj);
  }
  return lines;
}
export function summarizeLines(lines) {
  const finals = lines.map((l) => l[l.length - 1]);
  return {
    fixed: finals.filter((p) => p >= 1).length,
    lost: finals.filter((p) => p <= 0).length,
    segregating: finals.filter((p) => p > 0 && p < 1).length,
    meanFinal: finals.reduce((a, b) => a + b, 0) / finals.length,
  };
}
// Expected heterozygosity decay from drift alone: H_t = H_0 (1 - 1/(2N))^t
export function expectedHeterozygosity(H0, N, t) { return H0 * Math.pow(1 - 1 / (2 * N), t); }

// ---------- Hardy-Weinberg ----------
export function hweExpected(p) { const q = 1 - p; return { AA: p * p, Aa: 2 * p * q, aa: q * q }; }
export function hweTest(nAA, nAa, naa) {
  const n = nAA + nAa + naa;
  if (n <= 0) return null;
  const p = (2 * nAA + nAa) / (2 * n);
  const e = hweExpected(p);
  const expected = [e.AA * n, e.Aa * n, e.aa * n];
  const observed = [nAA, nAa, naa];
  let chi2 = 0;
  for (let i = 0; i < 3; i++) if (expected[i] > 0) chi2 += (observed[i] - expected[i]) ** 2 / expected[i];
  // 3 classes - 1 - 1 estimated parameter = 1 degree of freedom
  const p_value = chiSquarePValue(chi2, 1);
  return { n, p, q: 1 - p, expected, observed, chi2, df: 1, pValue: p_value, fits: p_value >= 0.05, smallExpected: expected.some((x) => x < 5) };
}

// ---------- Breeder ----------
export const STABLE_KEY = "kinetic-genetics-stable-v1";
export const STABLE_MAX = 20;
export const LITTER_SIZE = 4;
export const SEQUENCE_USES = 6;
export const TRAITS = [
  { id: "color", label: "Fur colour", dom: "B", rec: "b", domName: "blue", recName: "orange" },
  { id: "ears", label: "Ears", dom: "E", rec: "e", domName: "pointy", recName: "floppy" },
  { id: "tail", label: "Tail", dom: "T", rec: "t", domName: "curly", recName: "straight" },
  { id: "spots", label: "Spots", dom: "S", rec: "s", domName: "spotted", recName: "plain" },
];
export function normTrait(t, g) {
  const a = [...g].sort((x, y) => (x === t.dom ? -1 : y === t.dom ? 1 : 0));
  return a.join("");
}
export function makeGenotype(str) { // e.g. "BbEEttSs"
  const g = {};
  TRAITS.forEach((t, i) => { g[t.id] = normTrait(t, str.slice(2 * i, 2 * i + 2)); });
  return g;
}
export function genotypeString(g) { return TRAITS.map((t) => g[t.id]).join(""); }
export function phenotypeOf(g) {
  const ph = {};
  for (const t of TRAITS) ph[t.id] = g[t.id].includes(t.dom) ? t.domName : t.recName;
  return ph;
}
export function describe(g) { const p = phenotypeOf(g); return TRAITS.map((t) => p[t.id]).join(", "); }
export function breed(g1, g2, rng) {
  const child = {};
  for (const t of TRAITS) child[t.id] = normTrait(t, [g1[t.id][rng() < 0.5 ? 0 : 1], g2[t.id][rng() < 0.5 ? 0 : 1]]);
  return child;
}
export function breedLitter(g1, g2, rng, n = LITTER_SIZE) {
  return Array.from({ length: n }, () => breed(g1, g2, rng));
}
export function starterStable() {
  return {
    v: 1, nextId: 5, seqLeft: SEQUENCE_USES, goalsDone: [], bred: 0,
    creatures: ["BBEETTSS", "bbeettss", "BBeeTTss", "bbEEttSS"].map((s, i) => ({ id: i + 1, g: makeGenotype(s), seq: false, name: ["Azure", "Rusty", "Bluebell", "Ember"][i] })),
  };
}
export const GOALS = [
  { id: "g1", text: "Produce a blue, floppy-eared, spotted creature.", want: { color: "blue", ears: "floppy", spots: "spotted" }, hint: "Floppy ears are recessive, so the ear parent's genes must be ee. Blue is dominant, so a blue parent might carry a hidden orange allele. Test-cross a blue creature with an orange one: any orange kit proves it is Bb." },
  { id: "g2", text: "Produce an orange, pointy-eared, curly-tailed creature.", want: { color: "orange", ears: "pointy", tail: "curly" }, hint: "Orange needs bb, so both parents must carry b. Cross two creatures that show or hide it." },
  { id: "g3", text: "Produce a true-breeding blue, curly-tailed line (BBTT).", want: { color: "blue", tail: "curly" }, pure: ["color", "tail"], hint: "Phenotype cannot tell BB from Bb. Breed the creature with an orange one (a test cross): if no orange kits appear, it is probably homozygous. Sequencing confirms." },
  { id: "g4", text: "Produce a creature showing all four recessive traits.", want: { color: "orange", ears: "floppy", tail: "straight", spots: "plain" }, hint: "You own an all-recessive creature already, but it has to be bred, not just owned. Cross it with itself (or another all-recessive one): recessive traits always breed true." },
  { id: "g5", text: "Produce a creature heterozygous for all four genes (BbEeTtSs).", want: {}, allHet: true, hint: "Cross the all-dominant pure line with the all-recessive pure line. Every offspring gets one of each allele." },
];
export function goalMet(goal, g) {
  const ph = phenotypeOf(g);
  for (const k of Object.keys(goal.want)) if (ph[k] !== goal.want[k]) return false;
  if (goal.pure && !goal.pure.every((k) => g[k][0] === g[k][1])) return false;
  if (goal.allHet && !TRAITS.every((t) => g[t.id][0] !== g[t.id][1])) return false;
  return true;
}
export function sanitizeStable(raw) {
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!o || o.v !== 1 || !Array.isArray(o.creatures)) return starterStable();
    const okG = (g) => g && TRAITS.every((t) => typeof g[t.id] === "string" && g[t.id].length === 2 && [...g[t.id]].every((c) => c === t.dom || c === t.rec));
    const creatures = o.creatures.filter((c) => c && okG(c.g)).slice(0, STABLE_MAX).map((c) => ({ id: c.id | 0, g: makeGenotype(genotypeString(c.g)), seq: !!c.seq, born: !!c.born, name: String(c.name || "Critter").slice(0, 20) }));
    if (!creatures.length) return starterStable();
    return {
      v: 1, creatures,
      nextId: Math.max(o.nextId | 0, ...creatures.map((c) => c.id + 1)),
      seqLeft: Math.min(SEQUENCE_USES, Math.max(0, o.seqLeft | 0)),
      goalsDone: (Array.isArray(o.goalsDone) ? o.goalsDone : []).filter((id) => GOALS.some((g) => g.id === id)),
      bred: Math.max(0, o.bred | 0),
    };
  } catch { return starterStable(); }
}
