// All 118 elements, with category, standard atomic mass, and (for the
// elements reactions actually care about) common oxidation states.
//
// Electron shell counts (the classic "2, 8, 8, 1"-style Bohr diagram) are
// *derived*, not hand-typed, using the standard Aufbau/Madelung subshell
// fill order summed by principal quantum number. That's correct for the
// large majority of elements. About twenty — mostly transition metals like
// chromium and copper, where a d-subshell "steals" an electron from the
// outer s-subshell — are known real-world exceptions to strict Aufbau
// filling; this model doesn't special-case those; it's a simplified,
// consistent shell model for visualization, not a subshell-exact one.

export const CATEGORY_COLORS = {
  "alkali": "#e2483f",
  "alkaline-earth": "#e8935a",
  "transition": "#e0c04f",
  "post-transition": "#7fc26b",
  "metalloid": "#4fbf9f",
  "nonmetal": "#4f8cff",
  "halogen": "#7f7fe8",
  "noble-gas": "#b878e0",
  "lanthanide": "#e879b8",
  "actinide": "#e85f8a",
};

export const CATEGORY_LABELS = {
  "alkali": "Alkali metal",
  "alkaline-earth": "Alkaline earth metal",
  "transition": "Transition metal",
  "post-transition": "Post-transition metal",
  "metalloid": "Metalloid",
  "nonmetal": "Reactive nonmetal",
  "halogen": "Halogen",
  "noble-gas": "Noble gas",
  "lanthanide": "Lanthanide",
  "actinide": "Actinide",
};

// [number, symbol, name, category, mass, period, group(0 if n/a e.g. lanth/act)]
const RAW = [
  [1, "H", "Hydrogen", "nonmetal", 1.008, 1, 1],
  [2, "He", "Helium", "noble-gas", 4.003, 1, 18],
  [3, "Li", "Lithium", "alkali", 6.94, 2, 1],
  [4, "Be", "Beryllium", "alkaline-earth", 9.012, 2, 2],
  [5, "B", "Boron", "metalloid", 10.81, 2, 13],
  [6, "C", "Carbon", "nonmetal", 12.011, 2, 14],
  [7, "N", "Nitrogen", "nonmetal", 14.007, 2, 15],
  [8, "O", "Oxygen", "nonmetal", 15.999, 2, 16],
  [9, "F", "Fluorine", "halogen", 18.998, 2, 17],
  [10, "Ne", "Neon", "noble-gas", 20.180, 2, 18],
  [11, "Na", "Sodium", "alkali", 22.990, 3, 1],
  [12, "Mg", "Magnesium", "alkaline-earth", 24.305, 3, 2],
  [13, "Al", "Aluminum", "post-transition", 26.982, 3, 13],
  [14, "Si", "Silicon", "metalloid", 28.085, 3, 14],
  [15, "P", "Phosphorus", "nonmetal", 30.974, 3, 15],
  [16, "S", "Sulfur", "nonmetal", 32.06, 3, 16],
  [17, "Cl", "Chlorine", "halogen", 35.45, 3, 17],
  [18, "Ar", "Argon", "noble-gas", 39.948, 3, 18],
  [19, "K", "Potassium", "alkali", 39.098, 4, 1],
  [20, "Ca", "Calcium", "alkaline-earth", 40.078, 4, 2],
  [21, "Sc", "Scandium", "transition", 44.956, 4, 3],
  [22, "Ti", "Titanium", "transition", 47.867, 4, 4],
  [23, "V", "Vanadium", "transition", 50.942, 4, 5],
  [24, "Cr", "Chromium", "transition", 51.996, 4, 6],
  [25, "Mn", "Manganese", "transition", 54.938, 4, 7],
  [26, "Fe", "Iron", "transition", 55.845, 4, 8],
  [27, "Co", "Cobalt", "transition", 58.933, 4, 9],
  [28, "Ni", "Nickel", "transition", 58.693, 4, 10],
  [29, "Cu", "Copper", "transition", 63.546, 4, 11],
  [30, "Zn", "Zinc", "transition", 65.38, 4, 12],
  [31, "Ga", "Gallium", "post-transition", 69.723, 4, 13],
  [32, "Ge", "Germanium", "metalloid", 72.630, 4, 14],
  [33, "As", "Arsenic", "metalloid", 74.922, 4, 15],
  [34, "Se", "Selenium", "nonmetal", 78.971, 4, 16],
  [35, "Br", "Bromine", "halogen", 79.904, 4, 17],
  [36, "Kr", "Krypton", "noble-gas", 83.798, 4, 18],
  [37, "Rb", "Rubidium", "alkali", 85.468, 5, 1],
  [38, "Sr", "Strontium", "alkaline-earth", 87.62, 5, 2],
  [39, "Y", "Yttrium", "transition", 88.906, 5, 3],
  [40, "Zr", "Zirconium", "transition", 91.224, 5, 4],
  [41, "Nb", "Niobium", "transition", 92.906, 5, 5],
  [42, "Mo", "Molybdenum", "transition", 95.95, 5, 6],
  [43, "Tc", "Technetium", "transition", 98, 5, 7],
  [44, "Ru", "Ruthenium", "transition", 101.07, 5, 8],
  [45, "Rh", "Rhodium", "transition", 102.906, 5, 9],
  [46, "Pd", "Palladium", "transition", 106.42, 5, 10],
  [47, "Ag", "Silver", "transition", 107.868, 5, 11],
  [48, "Cd", "Cadmium", "transition", 112.414, 5, 12],
  [49, "In", "Indium", "post-transition", 114.818, 5, 13],
  [50, "Sn", "Tin", "post-transition", 118.710, 5, 14],
  [51, "Sb", "Antimony", "metalloid", 121.760, 5, 15],
  [52, "Te", "Tellurium", "metalloid", 127.60, 5, 16],
  [53, "I", "Iodine", "halogen", 126.904, 5, 17],
  [54, "Xe", "Xenon", "noble-gas", 131.293, 5, 18],
  [55, "Cs", "Cesium", "alkali", 132.905, 6, 1],
  [56, "Ba", "Barium", "alkaline-earth", 137.327, 6, 2],
  [57, "La", "Lanthanum", "lanthanide", 138.905, 6, 0],
  [58, "Ce", "Cerium", "lanthanide", 140.116, 6, 0],
  [59, "Pr", "Praseodymium", "lanthanide", 140.908, 6, 0],
  [60, "Nd", "Neodymium", "lanthanide", 144.242, 6, 0],
  [61, "Pm", "Promethium", "lanthanide", 145, 6, 0],
  [62, "Sm", "Samarium", "lanthanide", 150.36, 6, 0],
  [63, "Eu", "Europium", "lanthanide", 151.964, 6, 0],
  [64, "Gd", "Gadolinium", "lanthanide", 157.25, 6, 0],
  [65, "Tb", "Terbium", "lanthanide", 158.925, 6, 0],
  [66, "Dy", "Dysprosium", "lanthanide", 162.500, 6, 0],
  [67, "Ho", "Holmium", "lanthanide", 164.930, 6, 0],
  [68, "Er", "Erbium", "lanthanide", 167.259, 6, 0],
  [69, "Tm", "Thulium", "lanthanide", 168.934, 6, 0],
  [70, "Yb", "Ytterbium", "lanthanide", 173.045, 6, 0],
  [71, "Lu", "Lutetium", "lanthanide", 174.967, 6, 0],
  [72, "Hf", "Hafnium", "transition", 178.49, 6, 4],
  [73, "Ta", "Tantalum", "transition", 180.948, 6, 5],
  [74, "W", "Tungsten", "transition", 183.84, 6, 6],
  [75, "Re", "Rhenium", "transition", 186.207, 6, 7],
  [76, "Os", "Osmium", "transition", 190.23, 6, 8],
  [77, "Ir", "Iridium", "transition", 192.217, 6, 9],
  [78, "Pt", "Platinum", "transition", 195.084, 6, 10],
  [79, "Au", "Gold", "transition", 196.967, 6, 11],
  [80, "Hg", "Mercury", "transition", 200.592, 6, 12],
  [81, "Tl", "Thallium", "post-transition", 204.38, 6, 13],
  [82, "Pb", "Lead", "post-transition", 207.2, 6, 14],
  [83, "Bi", "Bismuth", "post-transition", 208.980, 6, 15],
  [84, "Po", "Polonium", "post-transition", 209, 6, 16],
  [85, "At", "Astatine", "halogen", 210, 6, 17],
  [86, "Rn", "Radon", "noble-gas", 222, 6, 18],
  [87, "Fr", "Francium", "alkali", 223, 7, 1],
  [88, "Ra", "Radium", "alkaline-earth", 226, 7, 2],
  [89, "Ac", "Actinium", "actinide", 227, 7, 0],
  [90, "Th", "Thorium", "actinide", 232.038, 7, 0],
  [91, "Pa", "Protactinium", "actinide", 231.036, 7, 0],
  [92, "U", "Uranium", "actinide", 238.029, 7, 0],
  [93, "Np", "Neptunium", "actinide", 237, 7, 0],
  [94, "Pu", "Plutonium", "actinide", 244, 7, 0],
  [95, "Am", "Americium", "actinide", 243, 7, 0],
  [96, "Cm", "Curium", "actinide", 247, 7, 0],
  [97, "Bk", "Berkelium", "actinide", 247, 7, 0],
  [98, "Cf", "Californium", "actinide", 251, 7, 0],
  [99, "Es", "Einsteinium", "actinide", 252, 7, 0],
  [100, "Fm", "Fermium", "actinide", 257, 7, 0],
  [101, "Md", "Mendelevium", "actinide", 258, 7, 0],
  [102, "No", "Nobelium", "actinide", 259, 7, 0],
  [103, "Lr", "Lawrencium", "actinide", 262, 7, 0],
  [104, "Rf", "Rutherfordium", "transition", 267, 7, 4],
  [105, "Db", "Dubnium", "transition", 268, 7, 5],
  [106, "Sg", "Seaborgium", "transition", 271, 7, 6],
  [107, "Bh", "Bohrium", "transition", 272, 7, 7],
  [108, "Hs", "Hassium", "transition", 270, 7, 8],
  [109, "Mt", "Meitnerium", "transition", 276, 7, 9],
  [110, "Ds", "Darmstadtium", "transition", 281, 7, 10],
  [111, "Rg", "Roentgenium", "transition", 280, 7, 11],
  [112, "Cn", "Copernicium", "transition", 285, 7, 12],
  [113, "Nh", "Nihonium", "post-transition", 284, 7, 13],
  [114, "Fl", "Flerovium", "post-transition", 289, 7, 14],
  [115, "Mc", "Moscovium", "post-transition", 288, 7, 15],
  [116, "Lv", "Livermorium", "post-transition", 293, 7, 16],
  [117, "Ts", "Tennessine", "halogen", 294, 7, 17],
  [118, "Og", "Oganesson", "noble-gas", 294, 7, 18],
];

// Standard Aufbau/Madelung subshell fill order: [principal shell n, capacity]
const AUFBAU_ORDER = [
  [1, 2], [2, 2], [2, 6], [3, 2], [3, 6], [4, 2], [3, 10], [4, 6], [5, 2],
  [4, 10], [5, 6], [6, 2], [4, 14], [5, 10], [6, 6], [7, 2], [5, 14], [6, 10], [7, 6],
];

function shellsFor(z) {
  const shells = [0, 0, 0, 0, 0, 0, 0];
  let remaining = z;
  for (const [n, cap] of AUFBAU_ORDER) {
    if (remaining <= 0) break;
    const fill = Math.min(cap, remaining);
    shells[n - 1] += fill;
    remaining -= fill;
  }
  while (shells.length && shells[shells.length - 1] === 0) shells.pop();
  return shells;
}

// Common oxidation states, curated for the elements reactions actually
// involve. Falls back to a group-based guess for anything not listed.
const OXIDATION_STATES = {
  H: [1, -1], Li: [1], Na: [1], K: [1], Rb: [1], Cs: [1], Fr: [1],
  Be: [2], Mg: [2], Ca: [2], Sr: [2], Ba: [2], Ra: [2],
  B: [3], Al: [3], Ga: [3], In: [3], Tl: [3, 1],
  C: [4, -4, 2], Si: [4, -4], Ge: [4], Sn: [4, 2], Pb: [2, 4],
  N: [-3, 3, 5], P: [-3, 3, 5], As: [-3, 3, 5], Sb: [3, 5], Bi: [3],
  O: [-2], S: [-2, 4, 6], Se: [-2, 4, 6], Te: [-2, 4, 6],
  F: [-1], Cl: [-1, 1, 5, 7], Br: [-1, 1, 5], I: [-1, 1, 5, 7], At: [-1],
  He: [0], Ne: [0], Ar: [0], Kr: [0], Xe: [0], Rn: [0], Og: [0],
  Sc: [3], Ti: [4, 3], V: [5, 4, 3, 2], Cr: [3, 6, 2], Mn: [2, 4, 7],
  Fe: [2, 3], Co: [2, 3], Ni: [2], Cu: [2, 1], Zn: [2],
  Y: [3], Zr: [4], Nb: [5], Mo: [6, 4], Tc: [7], Ru: [3, 4], Rh: [3], Pd: [2, 4],
  Ag: [1], Cd: [2], Hf: [4], Ta: [5], W: [6, 4], Re: [4, 7], Os: [4], Ir: [3, 4],
  Pt: [2, 4], Au: [3, 1], Hg: [2, 1], Po: [2, 4],
};

const GROUP_DEFAULT_OXIDATION = { 1: 1, 2: 2, 13: 3, 14: 4, 15: -3, 16: -2, 17: -1, 18: 0 };

export const ELEMENTS = RAW.map(([number, symbol, name, category, mass, period, group]) => {
  const shells = shellsFor(number);
  return {
    number, symbol, name, category, mass, period, group,
    shells,
    valence: shells[shells.length - 1] ?? 0,
    oxidationStates: OXIDATION_STATES[symbol] ?? (GROUP_DEFAULT_OXIDATION[group] != null ? [GROUP_DEFAULT_OXIDATION[group]] : [0]),
  };
});

export const ELEMENTS_BY_SYMBOL = Object.fromEntries(ELEMENTS.map((e) => [e.symbol, e]));

export function elementBySymbol(sym) {
  return ELEMENTS_BY_SYMBOL[sym];
}

const METAL_CATEGORIES = new Set(["alkali", "alkaline-earth", "transition", "post-transition", "lanthanide", "actinide"]);
export function isMetal(el) {
  return METAL_CATEGORIES.has(el.category);
}
export function isNonmetal(el) {
  return el.category === "nonmetal" || el.category === "halogen";
}
export function isNoble(el) {
  return el.category === "noble-gas";
}

const DIATOMIC = new Set(["H", "N", "O", "F", "Cl", "Br", "I"]);

// A curated table of well-known reactions/compounds, keyed by the two
// elements' symbols sorted alphabetically and joined with "-". This is the
// "greatest hits" set — accurate, named, specific. Anything not in here
// falls through to the general bonding-rule engine below, which covers the
// rest of the periodic table with a simplified but broadly-applicable
// prediction instead of a hand-verified one.
const REACTION_TABLE = {
  "H-O": { formula: "H₂O", name: "Water", type: "covalent", energy: "exothermic", ratio: { H: 2, O: 1 }, structure: "H—O—H", note: "Two hydrogens share electrons with one oxygen. The reaction that powers hydrogen fuel cells (in reverse) and rocket engines (forward, explosively)." },
  "H-Cl": { formula: "HCl", name: "Hydrogen chloride", type: "covalent", energy: "exothermic", ratio: { H: 1, Cl: 1 }, structure: "H—Cl", note: "Dissolves in water to form hydrochloric acid — the acid in your stomach." },
  "Cl-Na": { formula: "NaCl", name: "Table salt", type: "ionic", energy: "exothermic", ratio: { Na: 1, Cl: 1 }, structure: "Na⁺ Cl⁻", note: "Sodium gives up its outer electron, chlorine takes it — a violent reaction between a soft explosive metal and a toxic gas that somehow makes the salt on your fries." },
  "C-O": { formula: "CO₂", name: "Carbon dioxide", type: "covalent", energy: "exothermic", ratio: { C: 1, O: 2 }, structure: "O═C═O", note: "What you exhale, and what plants breathe in. Also what burning carbon-based fuel produces." },
  "H-N": { formula: "NH₃", name: "Ammonia", type: "covalent", energy: "exothermic", ratio: { N: 1, H: 3 }, structure: "H—N(—H)—H", note: "Made industrially by the millions of tons via the Haber process to feed the world's crops as fertilizer." },
  "C-H": { formula: "CH₄", name: "Methane", type: "covalent", energy: "exothermic", ratio: { C: 1, H: 4 }, structure: "H—C(—H)(—H)—H", note: "The simplest hydrocarbon — natural gas is mostly this. A potent greenhouse gas." },
  "Fe-O": { formula: "Fe₂O₃", name: "Rust", type: "ionic", energy: "exothermic", ratio: { Fe: 2, O: 3 }, structure: "Fe—O—Fe (bridged oxide lattice)", note: "Iron slowly gives up electrons to oxygen over time — the same basic chemistry as a much faster combustion, just gentler." },
  "Mg-O": { formula: "MgO", name: "Magnesium oxide", type: "ionic", energy: "exothermic", ratio: { Mg: 1, O: 1 }, structure: "Mg²⁺ O²⁻", note: "Magnesium burns in air with a blinding white light — this is the ash left behind." },
  "Al-O": { formula: "Al₂O₃", name: "Aluminum oxide", type: "ionic", energy: "exothermic", ratio: { Al: 2, O: 3 }, structure: "Al—O—Al (bridged oxide lattice)", note: "Forms an invisible, tough coating on aluminum almost instantly in air, which is why aluminum doesn't rust away like iron." },
  "Ca-O": { formula: "CaO", name: "Quicklime", type: "ionic", energy: "exothermic", ratio: { Ca: 1, O: 1 }, structure: "Ca²⁺ O²⁻", note: "Used in cement and mortar for thousands of years." },
  "Cl-K": { formula: "KCl", name: "Potassium chloride", type: "ionic", energy: "exothermic", ratio: { K: 1, Cl: 1 }, structure: "K⁺ Cl⁻", note: "A common salt substitute and fertilizer ingredient." },
  "Ag-Cl": { formula: "AgCl", name: "Silver chloride", type: "ionic", energy: "exothermic", ratio: { Ag: 1, Cl: 1 }, structure: "Ag⁺ Cl⁻", note: "Almost insoluble in water — instantly precipitates as a white solid, a classic chemistry-class demonstration." },
  "Cu-O": { formula: "CuO", name: "Copper oxide", type: "ionic", energy: "exothermic", ratio: { Cu: 1, O: 1 }, structure: "Cu²⁺ O²⁻", note: "The black coating that forms on copper when it's heated in air." },
  "O-Zn": { formula: "ZnO", name: "Zinc oxide", type: "ionic", energy: "exothermic", ratio: { Zn: 1, O: 1 }, structure: "Zn²⁺ O²⁻", note: "The white paste in sunscreen and diaper cream." },
  "O-S": { formula: "SO₂", name: "Sulfur dioxide", type: "covalent", energy: "exothermic", ratio: { S: 1, O: 2 }, structure: "O═S═O", note: "The sharp smell of a just-struck match. A major contributor to acid rain when it comes from burning coal." },
  "H-S": { formula: "H₂S", name: "Hydrogen sulfide", type: "covalent", energy: "exothermic", ratio: { H: 2, S: 1 }, structure: "H—S—H", note: "The rotten-egg smell — toxic in enough quantity, but your nose is extraordinarily sensitive to trace amounts." },
  "Br-Na": { formula: "NaBr", name: "Sodium bromide", type: "ionic", energy: "exothermic", ratio: { Na: 1, Br: 1 }, structure: "Na⁺ Br⁻", note: "Once used as a sedative; today mostly a photography and industrial chemical." },
  "I-K": { formula: "KI", name: "Potassium iodide", type: "ionic", energy: "exothermic", ratio: { K: 1, I: 1 }, structure: "K⁺ I⁻", note: "Added to table salt to prevent iodine-deficiency disorders — this is why salt is 'iodized.'" },
  "N-O": { formula: "NO₂", name: "Nitrogen dioxide", type: "covalent", energy: "endothermic", ratio: { N: 1, O: 2 }, structure: "O═N—O", note: "The reddish-brown haze over polluted cities — forms from nitrogen and oxygen at the high temperatures inside engines." },
  "H-Na": { formula: "NaH", name: "Sodium hydride", type: "ionic", energy: "exothermic", ratio: { Na: 1, H: 1 }, structure: "Na⁺ H⁻", note: "Unusually, hydrogen is the negative ion here — sodium is even more eager to lose an electron than hydrogen is." },
  "Ca-F": { formula: "CaF₂", name: "Fluorite", type: "ionic", energy: "exothermic", ratio: { Ca: 1, F: 2 }, structure: "F⁻ Ca²⁺ F⁻", note: "Found naturally as a mineral, and the main industrial source of fluorine." },
  "F-H": { formula: "HF", name: "Hydrofluoric acid", type: "covalent", energy: "exothermic", ratio: { H: 1, F: 1 }, structure: "H—F", note: "One of the few things that dissolves glass — handled with extreme care." },
};

// A handful of three-element curated compounds, checked when the bench has
// exactly three distinct elements filled in.
const REACTION_TABLE_3 = {
  "H-Na-O": { formula: "NaOH", name: "Sodium hydroxide (lye)", type: "ionic", energy: "exothermic", ratio: { Na: 1, O: 1, H: 1 }, structure: "Na⁺ [O—H]⁻", note: "The same product sodium makes when dropped in water, built here directly from its three elements. Extremely caustic — it's the active ingredient in drain cleaner." },
  "C-H-O": { formula: "C₆H₁₂O₆ (simplified)", name: "A sugar (glucose-family carbohydrate)", type: "covalent", energy: "n/a", ratio: { C: 1, H: 2, O: 1 }, structure: "—C(—H)(—OH)—, repeating", note: "Carbon, hydrogen, and oxygen in this kind of ratio are the building blocks of carbohydrates — the sugars and starches that store energy in food and fuel your cells." },
};

function reactionKey(...symbols) {
  return [...symbols].sort().join("-");
}

function gcdOf(...nums) {
  const gcd2 = (a, b) => (b === 0 ? a : gcd2(b, a % b));
  return nums.reduce((a, b) => gcd2(a, b));
}

// Reduce a {symbol: count} map to its simplest whole-number ratio.
function reduceRatio(counts) {
  const g = gcdOf(...Object.values(counts));
  const out = {};
  for (const [sym, n] of Object.entries(counts)) out[sym] = n / g;
  return out;
}

// Both sides are reduced before comparing — a stored/predicted ratio isn't
// guaranteed to already be in lowest terms (a single-element ratio like
// {H: 2} for diatomic H₂ has its own GCD of 2, so left as-is it would never
// equal the always-reduced-to-GCD-1 count the player brought).
function ratiosEqual(a, b) {
  const ra = reduceRatio(a), rb = reduceRatio(b);
  const ak = Object.keys(ra).sort(), bk = Object.keys(rb).sort();
  if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
  return ak.every((k) => ra[k] === rb[k]);
}

function formatRatio(counts) {
  return Object.entries(counts).map(([sym, n]) => (n === 1 ? sym : `${n} ${sym}`)).join(" : ");
}

// Standard "-ide" naming roots (Oxygen -> Oxide, Sulfur -> Sulfide, etc.) —
// English element names don't strip to "-ide" by a single uniform rule, so
// this is a lookup for the nonmetals/halogens that can appear here.
const IONIC_ROOT = {
  H: "Hydride", C: "Carbide", N: "Nitride", O: "Oxide", P: "Phosphide", S: "Sulfide", Se: "Selenide",
  F: "Fluoride", Cl: "Chloride", Br: "Bromide", I: "Iodide", At: "Astatide", Ts: "Tenesside",
};
function ionicRoot(nonmetal) {
  return IONIC_ROOT[nonmetal.symbol] ?? `${nonmetal.name}ide`;
}

// Elements meeting water get their own special-cased drama, since "metal +
// water" is one of the more famous demo reactions and doesn't fit the
// generic element+element table above.
const METAL_WATER_REACTIVITY = {
  Li: "vigorous", Na: "vigorous", K: "violent", Rb: "violent", Cs: "extremely violent", Fr: "extremely violent",
  Ca: "moderate", Sr: "moderate", Ba: "vigorous", Mg: "very slow (needs steam)", Al: "slow (protective oxide layer)",
  Zn: "very slow", Fe: "very slow (rusts instead)",
};

export function predictWaterReaction(el) {
  const reactivity = METAL_WATER_REACTIVITY[el.symbol];
  if (!reactivity) return null;
  return {
    formula: `2${el.symbol} + 2H₂O → 2${el.symbol}OH + H₂↑`,
    name: `${el.name} hydroxide + hydrogen gas`,
    type: "ionic",
    energy: "exothermic",
    note: `${el.name} reacts with water — reactivity: ${reactivity}. It displaces hydrogen gas and forms an alkaline hydroxide solution. Alkali metals react more violently as you go down the group — the outer electron is held more loosely the farther it sits from the nucleus.`,
  };
}

// The general fallback: no curated entry, so predict from first principles
// using electronegativity-style category rules. This is what gives "lots of
// combinations" coverage — simplified, but a genuine chemical-bonding
// prediction, not a placeholder. Every branch carries a `ratio` so the
// mixing bench can check the player brought the right proportions, not just
// the right elements.
export function predictReaction(elA, elB) {
  if (elA.symbol === elB.symbol) {
    if (DIATOMIC.has(elA.symbol)) {
      return { formula: `${elA.symbol}₂`, name: `Diatomic ${elA.name.toLowerCase()}`, type: "covalent", energy: "n/a", ratio: { [elA.symbol]: 2 },
        note: `${elA.name} doesn't bond to other elements here — but it does bond to itself, forming the stable two-atom molecule that's actually how you'd find pure ${elA.name.toLowerCase()} in nature.` };
    }
    return { formula: null, name: "No reaction", type: "none", energy: "n/a", ratio: null,
      note: `Two atoms of the same element sitting together don't react with each other — nothing here favors either one gaining or losing an electron.` };
  }

  const key = reactionKey(elA.symbol, elB.symbol);
  if (REACTION_TABLE[key]) return { ...REACTION_TABLE[key] };

  if (isNoble(elA) || isNoble(elB)) {
    const noble = isNoble(elA) ? elA : elB;
    return { formula: null, name: "No reaction", type: "none", energy: "n/a", ratio: null,
      note: `${noble.name}'s outer electron shell is already full, so it has essentially no tendency to gain, lose, or share electrons. Noble gases are famous for being chemically almost inert.` };
  }

  const aMetal = isMetal(elA), bMetal = isMetal(elB);

  if (aMetal && bMetal) {
    return { formula: null, name: "Alloy (mixture, not a compound)", type: "metallic", energy: "n/a", ratio: null,
      note: `Two metals don't trade electrons with each other the way a metal and a nonmetal do — their atoms just pack together, sharing a "sea" of loose electrons. That's an alloy, a physical mixture at the atomic scale, not a new chemical compound.` };
  }

  if (!aMetal && !bMetal) {
    // covalent: two nonmetal-ish elements share electrons. With no curated
    // formula for this specific pair, assume the simplest case (1:1).
    const [x, y] = [elA, elB].sort((p, q) => p.number - q.number);
    return { formula: `${x.symbol}—${y.symbol}`, name: `${x.name}–${y.name} compound (covalent)`, type: "covalent", energy: "exothermic", ratio: { [x.symbol]: 1, [y.symbol]: 1 },
      note: `Neither ${x.name} nor ${y.name} is eager to fully give up an electron, so instead they share a pair between them — a covalent bond. This app doesn't have a verified formula for this specific pair, so it's assuming the simplest 1:1 case.` };
  }

  // metal + nonmetal: ionic, predict a plausible formula via charge balance
  const metal = aMetal ? elA : elB;
  const nonmetal = aMetal ? elB : elA;
  const mCharge = metal.oxidationStates.find((c) => c > 0) ?? Math.abs(metal.oxidationStates[0]) ?? 1;
  const nCharge = nonmetal.oxidationStates.find((c) => c < 0) ?? -1;
  const g = gcdOf(mCharge, Math.abs(nCharge)) || 1;
  const mCount = Math.abs(nCharge) / g;
  const nCount = mCharge / g;
  const sub = (n) => (n === 1 ? "" : String(n).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[+d]).join(""));
  const formula = `${metal.symbol}${sub(mCount)}${nonmetal.symbol}${sub(nCount)}`;
  return { formula, name: `${metal.name} ${ionicRoot(nonmetal)} (ionic)`, type: "ionic", energy: "exothermic", ratio: { [metal.symbol]: mCount, [nonmetal.symbol]: nCount },
    note: `${metal.name} loses electron(s) to become a positive ion (+${mCharge}); ${nonmetal.name} picks them up to become a negative ion (${nCharge}). They stick together in a ratio that balances the total charge to zero — a predicted formula, not a verified one, for a pair this specific this app doesn't have on file.` };
}

// ---- Melting/boiling points (Kelvin) and phase-at-temperature ----
// Curated for the commonly-explored elements; anything else falls back to a
// category-typical estimate. These are approximate, standard-pressure
// values — enough to teach "solid/liquid/gas at this temperature," not a
// reference table.
const MELT_BOIL = {
  H: [14, 20], He: [1, 4], Li: [454, 1615], Be: [1560, 2742], B: [2349, 4200], C: [3823, 4098],
  N: [63, 77], O: [54, 90], F: [53, 85], Ne: [24, 27], Na: [371, 1156], Mg: [923, 1363],
  Al: [933, 2792], Si: [1687, 3538], P: [317, 550], S: [388, 718], Cl: [172, 239], Ar: [84, 87],
  K: [337, 1032], Ca: [1115, 1757], Sc: [1814, 3109], Ti: [1941, 3560], V: [2183, 3680],
  Cr: [2180, 2944], Mn: [1519, 2334], Fe: [1811, 3134], Co: [1768, 3200], Ni: [1728, 3186],
  Cu: [1358, 2835], Zn: [693, 1180], Ga: [303, 2673], Ge: [1211, 3106], As: [1090, 887],
  Se: [494, 958], Br: [266, 332], Kr: [116, 120], Rb: [312, 961], Sr: [1050, 1655],
  Y: [1799, 3609], Zr: [2128, 4650], Nb: [2750, 5017], Mo: [2896, 4912], Ru: [2607, 4423],
  Rh: [2237, 3968], Pd: [1828, 3236], Ag: [1235, 2435], Cd: [594, 1040], In: [430, 2345],
  Sn: [505, 2875], Sb: [904, 1860], Te: [723, 1261], I: [387, 457], Xe: [161, 165],
  Cs: [302, 944], Ba: [1000, 2170], W: [3695, 5828], Pt: [2041, 4098], Au: [1337, 3129],
  Hg: [234, 630], Tl: [577, 1746], Pb: [600, 2022], Bi: [545, 1837], Rn: [202, 211],
};
const CATEGORY_MELT_BOIL_DEFAULT = {
  "alkali": [350, 1000], "alkaline-earth": [1000, 1700], "transition": [1800, 3200],
  "post-transition": [600, 2200], "metalloid": [1200, 2800], "nonmetal": [200, 300],
  "halogen": [200, 300], "noble-gas": [100, 120], "lanthanide": [1300, 3000], "actinide": [1400, 3500],
};

export function meltingBoiling(el) {
  return MELT_BOIL[el.symbol] ?? CATEGORY_MELT_BOIL_DEFAULT[el.category] ?? [500, 1500];
}

export function phaseAt(el, tempK) {
  const [mp, bp] = meltingBoiling(el);
  if (tempK < mp) return "solid";
  if (tempK < bp) return "liquid";
  return "gas";
}

export const ROOM_TEMP_K = 298;

// ---- The mixing bench entry point ----
// entries: array of { symbol, tempK } for every filled slot. symbol may be
// "H2O" for the special water pseudo-slot. Returns a result object with an
// added `matched` field: true (a real answer), false (right elements, wrong
// ratio — teaches the player what ratio to try), or undefined (n/a, e.g.
// alloys/inert results where ratio doesn't apply).
export function evaluateMix(entries) {
  const waterCount = entries.filter((e) => e.symbol === "H2O").length;
  const real = entries.filter((e) => e.symbol !== "H2O");
  const counts = {};
  for (const e of real) counts[e.symbol] = (counts[e.symbol] || 0) + 1;
  const distinct = Object.keys(counts);

  if (distinct.length === 0) {
    if (waterCount > 0) return { formula: "H₂O", name: "Just water", type: "none", energy: "n/a", ratio: null, matched: undefined,
      note: "Water on its own, with nothing to react with it." };
    return { formula: null, name: "Empty", type: "none", energy: "n/a", ratio: null, matched: undefined, note: "The bench is empty." };
  }

  // metal + water special case (any count of water counts as "enough")
  if (distinct.length === 1 && waterCount > 0) {
    const el = elementBySymbol(distinct[0]);
    const result = predictWaterReaction(el);
    if (result) return { ...result, matched: true };
    return { formula: null, name: "No visible reaction", type: "none", energy: "n/a", ratio: null, matched: undefined,
      note: `${el.name} doesn't have a notable reaction with water at these temperatures.` };
  }

  if (distinct.length === 1) {
    // A single-element ratio can't be checked by reducing to lowest terms
    // (1 H and 4 H both reduce to "H : 1") — the actual atom count against
    // the required count is what matters here instead.
    const el = elementBySymbol(distinct[0]);
    const result = predictReaction(el, el);
    if (!result.ratio) return { ...result, matched: undefined };
    const needed = result.ratio[el.symbol];
    const have = counts[el.symbol];
    const matched = have >= needed && have % needed === 0;
    return { ...result, matched, note: matched ? result.note : `${result.note} You have ${have} ${el.symbol} — try a multiple of ${needed}.` };
  }

  if (distinct.length === 2) {
    const [elA, elB] = distinct.map(elementBySymbol);
    const result = predictReaction(elA, elB);
    if (!result.ratio) return { ...result, matched: undefined }; // alloy / inert / no-reaction: ratio doesn't matter
    const reduced = reduceRatio(counts);
    const matched = ratiosEqual(reduced, result.ratio);
    return matched
      ? { ...result, matched: true }
      : { ...result, matched: false, note: `You have the right elements for ${result.name.split(" (")[0]}, but the wrong ratio. You brought ${formatRatio(counts)} — it needs ${formatRatio(result.ratio)}.` };
  }

  // 3+ distinct elements: only the small curated table covers this
  const key = reactionKey(...distinct);
  if (REACTION_TABLE_3[key]) {
    const recipe = REACTION_TABLE_3[key];
    const reduced = reduceRatio(counts);
    const matched = ratiosEqual(reduced, recipe.ratio);
    return matched
      ? { ...recipe, matched: true }
      : { ...recipe, matched: false, note: `You have the right elements for ${recipe.name}, but the wrong ratio. You brought ${formatRatio(counts)} — it needs ${formatRatio(recipe.ratio)}.` };
  }
  return { formula: null, name: "No known reaction for this combination", type: "none", energy: "n/a", ratio: null, matched: undefined,
    note: `This app's curated reactions only go up to a few three-element compounds — this particular combination of ${distinct.length} elements isn't one this app can predict.` };
}
