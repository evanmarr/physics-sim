import { elementBySymbol, isMetal, isNoble } from "./chemistryData.js";

function distinctIs(lastResult, ...symbols) {
  if (!lastResult) return false;
  const want = [...symbols].sort().join("-");
  return lastResult.distinct.slice().sort().join("-") === want;
}

export const CHEMISTRY_CHALLENGES = [
  {
    id: "make_water",
    name: "Make Water",
    concept: "Covalent bonding & stoichiometry",
    description: "Mix hydrogen and oxygen in the exact 2:1 ratio real water needs — not just any amount of each.",
    reward: 30,
    check: (lastResult) => distinctIs(lastResult, "H", "O") && lastResult.result.matched === true,
  },
  {
    id: "make_salt",
    name: "Make Table Salt",
    concept: "Ionic bonding & stoichiometry",
    description: "Combine a soft, explosive alkali metal with a toxic yellow-green gas, one-to-one, to make something you'd happily put on fries.",
    reward: 30,
    check: (lastResult) => distinctIs(lastResult, "Na", "Cl") && lastResult.result.matched === true,
  },
  {
    id: "alkali_water",
    name: "Drop a Metal in Water",
    concept: "Reactivity trends down a group",
    description: "Add Water to the bench, then react it with any alkali metal (Li, Na, K, Rb, Cs, or Fr).",
    reward: 35,
    check: (lastResult) => {
      if (!lastResult || !lastResult.hasWater || lastResult.distinct.length !== 1) return false;
      const el = elementBySymbol(lastResult.distinct[0]);
      return !!el && el.category === "alkali" && lastResult.result.matched === true;
    },
  },
  {
    id: "find_inert",
    name: "Prove a Noble Gas is Inert",
    concept: "Full electron shells = no reactivity",
    description: "React any noble gas (helium, neon, argon...) with anything else and confirm you get \"No reaction.\"",
    reward: 25,
    check: (lastResult) => {
      if (!lastResult || lastResult.hasWater || lastResult.distinct.length !== 2) return false;
      const [a, b] = lastResult.distinct.map(elementBySymbol);
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
      if (!lastResult || lastResult.hasWater || lastResult.distinct.length !== 2) return false;
      const [a, b] = lastResult.distinct.map(elementBySymbol);
      return isMetal(a) && isMetal(b) && lastResult.result.type === "metallic";
    },
  },
  {
    id: "make_co2",
    name: "Make a Greenhouse Gas",
    concept: "Combustion products & stoichiometry",
    description: "Combine carbon and oxygen, one carbon to two oxygen, to form the gas most responsible for climate change.",
    reward: 30,
    check: (lastResult) => distinctIs(lastResult, "C", "O") && lastResult.result.matched === true,
  },
];
