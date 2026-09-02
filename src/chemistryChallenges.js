import { elementBySymbol, isMetal, isNoble } from "./chemistryData.js";

function pairIs(lastResult, x, y) {
  if (!lastResult) return false;
  return [lastResult.a, lastResult.b].sort().join("-") === [x, y].sort().join("-");
}

export const CHEMISTRY_CHALLENGES = [
  {
    id: "make_water",
    name: "Make Water",
    concept: "Covalent bonding",
    description: "Mix the two elements that make up the molecule covering 70% of Earth's surface.",
    reward: 30,
    check: (lastResult) => pairIs(lastResult, "H", "O"),
  },
  {
    id: "make_salt",
    name: "Make Table Salt",
    concept: "Ionic bonding",
    description: "Combine a soft, explosive alkali metal with a toxic yellow-green gas to make something you'd happily put on fries.",
    reward: 30,
    check: (lastResult) => pairIs(lastResult, "Na", "Cl"),
  },
  {
    id: "alkali_water",
    name: "Drop a Metal in Water",
    concept: "Reactivity trends down a group",
    description: "Add Water to the bench, then react it with any alkali metal (Li, Na, K, Rb, Cs, or Fr).",
    reward: 35,
    check: (lastResult) => {
      if (!lastResult) return false;
      const other = lastResult.a === "H2O" ? lastResult.b : (lastResult.b === "H2O" ? lastResult.a : null);
      if (!other) return false;
      const el = elementBySymbol(other);
      return !!el && el.category === "alkali";
    },
  },
  {
    id: "find_inert",
    name: "Prove a Noble Gas is Inert",
    concept: "Full electron shells = no reactivity",
    description: "React any noble gas (helium, neon, argon...) with anything else and confirm you get \"No reaction.\"",
    reward: 25,
    check: (lastResult) => {
      if (!lastResult || lastResult.a === "H2O" || lastResult.b === "H2O") return false;
      const a = elementBySymbol(lastResult.a), b = elementBySymbol(lastResult.b);
      return (isNoble(a) || isNoble(b)) && lastResult.result.type === "none";
    },
  },
  {
    id: "make_alloy",
    name: "Mix Two Metals",
    concept: "Metallic bonding vs. ionic bonding",
    description: "Combine any two metals and see why they form an alloy — a mixture — rather than a new ionic compound.",
    reward: 25,
    check: (lastResult) => {
      if (!lastResult || lastResult.a === "H2O" || lastResult.b === "H2O") return false;
      const a = elementBySymbol(lastResult.a), b = elementBySymbol(lastResult.b);
      return isMetal(a) && isMetal(b) && lastResult.result.type === "metallic";
    },
  },
  {
    id: "make_co2",
    name: "Make a Greenhouse Gas",
    concept: "Combustion products",
    description: "Combine carbon and oxygen to form the gas most responsible for climate change.",
    reward: 30,
    check: (lastResult) => pairIs(lastResult, "C", "O"),
  },
];
