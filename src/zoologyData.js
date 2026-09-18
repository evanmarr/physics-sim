// A small, deliberately simple temperate grassland/forest food web — the
// same handful of predator-prey relationships covered in most introductory
// biology curricula, not an exhaustive or obscure dataset. Every "eats"
// relationship here is a standard, well-documented one; nothing here is
// invented for the sake of the demo.
export const ORGANISMS = [
  { id: "sun", name: "Sun", level: 0, eats: [], note: "Not alive, but every food chain traces back to its energy." },
  { id: "grass", name: "Grass", level: 1, eats: [], note: "A producer — makes its own energy from sunlight via photosynthesis." },
  { id: "oak", name: "Oak tree", level: 1, eats: [], note: "A producer — its leaves and acorns feed several primary consumers." },
  { id: "algae", name: "Algae", level: 1, eats: [], note: "A producer — the base of most aquatic food webs." },
  { id: "grasshopper", name: "Grasshopper", level: 2, eats: ["grass"], note: "A primary consumer (herbivore) — eats producers directly." },
  { id: "rabbit", name: "Rabbit", level: 2, eats: ["grass"], note: "A primary consumer — eats producers directly." },
  { id: "mouse", name: "Mouse", level: 2, eats: ["grass", "oak"], note: "A primary consumer — eats grass and acorns." },
  { id: "deer", name: "Deer", level: 2, eats: ["grass", "oak"], note: "A primary consumer — browses on grass, leaves, and acorns." },
  { id: "tadpole", name: "Tadpole", level: 2, eats: ["algae"], note: "A primary consumer — grazes on algae before metamorphosing." },
  { id: "frog", name: "Frog", level: 3, eats: ["grasshopper"], note: "A secondary consumer — eats primary consumers." },
  { id: "fox", name: "Fox", level: 3, eats: ["rabbit", "mouse"], note: "A secondary consumer, and prey for larger predators." },
  { id: "snake", name: "Snake", level: 3, eats: ["mouse", "frog"], note: "A secondary/tertiary consumer depending on what it's eaten." },
  { id: "fish", name: "Fish", level: 3, eats: ["tadpole"], note: "A secondary consumer in the pond food web." },
  { id: "hawk", name: "Hawk", level: 4, eats: ["snake", "rabbit", "mouse"], note: "A tertiary (apex) consumer — nothing here regularly preys on it." },
  { id: "owl", name: "Owl", level: 4, eats: ["mouse", "snake"], note: "A tertiary (apex) consumer, hunting mostly at night." },
  { id: "wolf", name: "Wolf", level: 4, eats: ["deer", "fox", "rabbit"], note: "A tertiary (apex) predator at the top of this web." },
  { id: "decomposer", name: "Fungi & bacteria", level: 0.5, eats: ["grass", "oak", "deer", "wolf", "hawk"], note: "Decomposers break down dead matter from every level, recycling nutrients back to producers — every food web depends on them even though they're rarely drawn in." },
];

export const TROPHIC_LEVELS = [
  { level: 1, name: "Producers", desc: "Plants and algae that make their own energy from sunlight (photosynthesis). Every food chain starts here." },
  { level: 2, name: "Primary consumers", desc: "Herbivores — animals that eat producers directly." },
  { level: 3, name: "Secondary consumers", desc: "Animals that eat primary consumers — often omnivores or smaller predators." },
  { level: 4, name: "Tertiary / apex consumers", desc: "Top predators, rarely preyed on by anything else in the web." },
];
