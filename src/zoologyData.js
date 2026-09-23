// A small, deliberately simple temperate grassland/forest food web — the
// same handful of predator-prey relationships covered in most introductory
// biology curricula, not an exhaustive or obscure dataset. Every "eats"
// relationship here is a standard, well-documented one; nothing here is
// invented for the sake of the demo.
export const ORGANISMS = [
  { id: "sun", fact: "Plants capture only about 1\u20132% of the sunlight that reaches them, and that sliver powers nearly every food chain on Earth.", name: "Sun", level: 0, eats: [], note: "Not alive, but every food chain traces back to its energy." },
  { id: "grass", fact: "Grasses grow from the base of the leaf, not the tip, so grazing rarely kills them \u2014 which is why lawns and prairies survive being eaten.", name: "Grass", level: 1, eats: ["sun"], note: "A producer — makes its own energy from sunlight via photosynthesis." },
  { id: "oak", fact: "In a heavy 'mast' year one oak can drop tens of thousands of acorns, feeding mice, deer and more.", name: "Oak tree", level: 1, eats: ["sun"], note: "A producer — its leaves and acorns feed several primary consumers." },
  { id: "algae", fact: "Algae and other phytoplankton make roughly half of the oxygen we breathe.", name: "Algae", level: 1, eats: ["sun"], note: "A producer — the base of most aquatic food webs." },
  { id: "grasshopper", fact: "A grasshopper can jump about 20 times its own body length.", name: "Grasshopper", level: 2, eats: ["grass"], note: "A primary consumer (herbivore) — eats producers directly." },
  { id: "rabbit", fact: "A rabbit's teeth never stop growing; chewing tough plants wears them down.", name: "Rabbit", level: 2, eats: ["grass"], note: "A primary consumer — eats producers directly." },
  { id: "mouse", fact: "Mice breed fast \u2014 one female can raise several litters a year, which is why predators can depend on them.", name: "Mouse", level: 2, eats: ["grass", "oak"], note: "A primary consumer — eats grass and acorns." },
  { id: "deer", fact: "Deer are ruminants: a four-chambered stomach lets them digest tough plant fibre.", name: "Deer", level: 2, eats: ["grass", "oak"], note: "A primary consumer — browses on grass, leaves, and acorns." },
  { id: "tadpole", fact: "Tadpoles start as algae-grazers; many gain a more carnivorous gut as they become frogs.", name: "Tadpole", level: 2, eats: ["algae"], note: "A primary consumer — grazes on algae before metamorphosing." },
  { id: "frog", fact: "Frogs breathe partly through their skin, which is why they're sensitive indicators of pollution.", name: "Frog", level: 3, eats: ["grasshopper"], note: "A secondary consumer — eats primary consumers." },
  { id: "fox", fact: "Red foxes may use Earth's magnetic field to aim their pounce on mice hidden under snow.", name: "Fox", level: 3, eats: ["rabbit", "mouse"], note: "A secondary consumer, and prey for larger predators." },
  { id: "snake", fact: "A snake's loosely joined jaws stretch so it can swallow prey whole.", name: "Snake", level: 3, eats: ["mouse", "frog"], note: "A secondary/tertiary consumer depending on what it's eaten." },
  { id: "fish", fact: "Many pond fish change diet as they grow, moving from plankton to insects to tadpoles.", name: "Fish", level: 3, eats: ["tadpole"], note: "A secondary consumer in the pond food web." },
  { id: "hawk", fact: "A hawk's eyesight is several times sharper than a human's.", name: "Hawk", level: 4, eats: ["snake", "rabbit", "mouse"], note: "A tertiary (apex) consumer — nothing here regularly preys on it." },
  { id: "owl", fact: "An owl's ears sit at different heights on its head, helping it pinpoint prey by sound in the dark.", name: "Owl", level: 4, eats: ["mouse", "snake"], note: "A tertiary (apex) consumer, hunting mostly at night." },
  { id: "wolf", fact: "Wolves returned to Yellowstone in 1995 and changed how elk grazed \u2014 a famous 'trophic cascade', though scientists still debate its size.", name: "Wolf", level: 4, eats: ["deer", "fox", "rabbit"], note: "A tertiary (apex) predator at the top of this web." },
  { id: "decomposer", fact: "Without decomposers, dead matter would pile up and nutrients would never return to the soil.", name: "Fungi & bacteria", level: 0.5, eats: ["grass", "oak", "deer", "wolf", "hawk"], note: "Decomposers break down dead matter from every level, recycling nutrients back to producers — every food web depends on them even though they're rarely drawn in." },
];

export const TROPHIC_LEVELS = [
  { level: 1, name: "Producers", desc: "Plants and algae that make their own energy from sunlight (photosynthesis). Every food chain starts here." },
  { level: 2, name: "Primary consumers", desc: "Herbivores — animals that eat producers directly." },
  { level: 3, name: "Secondary consumers", desc: "Animals that eat primary consumers — often omnivores or smaller predators." },
  { level: 4, name: "Tertiary / apex consumers", desc: "Top predators, rarely preyed on by anything else in the web." },
];

export const LEVEL_STYLE = {
  0: { name: "Energy source", color: "#f5b942" },
  0.5: { name: "Decomposer", color: "#a0785a" },
  1: { name: "Producer", color: "#4caf6a" },
  2: { name: "Primary consumer", color: "#9ccc4d" },
  3: { name: "Secondary consumer", color: "#f0913a" },
  4: { name: "Apex consumer", color: "#e05555" },
};

export const WEB_PRESETS = [
  { id: "grassland", label: "Grassland", ids: ["grass", "grasshopper", "rabbit", "mouse", "frog", "fox", "snake", "hawk", "owl"] },
  { id: "pond", label: "Pond", ids: ["algae", "tadpole", "fish", "frog", "snake", "hawk"] },
  { id: "forest", label: "Forest", ids: ["grass", "oak", "mouse", "rabbit", "deer", "fox", "wolf", "owl"] },
  { id: "all", label: "Everything", ids: ORGANISMS.map((o) => o.id) },
];
