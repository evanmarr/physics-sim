# Continuum

A browser-based sandbox spanning six real, simulated domains — physics,
chemistry, astronomy, history, cybersecurity, and a gallery of D3 force
simulations — all reachable from one top bar and one home screen.

Built with [Matter.js](https://brm.io/matter-js/) for the physics sandbox
(gravity, collisions, friction, restitution, constraints), [D3.js](https://d3js.org/)
for rendering/drag/pan/zoom and the Particle Physics demos, and
[Three.js](https://threejs.org/) for the 3D atom viewer and the Astronomy
solar system. No build step — static HTML/JS loaded via ES modules and CDN
scripts. Light theme by default, with a dark toggle in the top-right corner.

## Running locally

```bash
python3 -m http.server 5173
```

Then open http://localhost:5173.

## Home

The landing screen — click the Continuum logo from any mode to return to it.
One card per section, each with a small live-rendered thumbnail representing
what that section actually looks like.

## Physics mode

Drag objects from the left palette onto the grid; click one to edit its
position, rotation, size, material, and fixed/dynamic state in the right
panel. A separate **Physics** panel shows the real formulas and numbers
driving the simulation for whatever's selected (mass, friction, restitution,
launch vectors, force falloff...). Press **Space** or **Play** to run the
simulation — stopping reverts to your blueprint, nothing is lost.

**Objects:** Ball, Board, Triangle, Ball Bearing (pivot point), Peg, Fan
(continuous wind), Cannon (catch-and-refire), Spring Pad (one-shot launch),
Bomb, Button, Magnet, Rope, Wire (button↔bomb/cannon link, can't be
collided with), Lens & Light Source & Mirror (real ray-traced Light Mode),
Track (a ball bearing that shuttles back and forth), and Motor (spins at a
set RPM). Materials (Wood, Metal, Rubber, Ice, Glass, Water) carry real
relative density, friction, and restitution.

Open **Challenges** for preset puzzles, each tagged with the concept it
teaches and verified solvable by direct simulation. Completing one earns
coins spendable in the Shop.

## Chemistry mode

Browse the full 118-element periodic table, inspect a rotatable 3D atom
model, and combine elements on a mixing bench (each slot has its own
temperature, so results can render as solid/liquid/gas). Combinations are
exact — the right elements in the wrong ratio tells you the ratio it
actually needs. 101 two-element and 20 three-element reactions are curated
with real stoichiometry and structure; anything else falls through to a
general bonding-rule engine. Reacting animates the atoms flying together
and bonding, automatically.

## Astronomy mode

Real Keplerian orbital mechanics — every planet, dwarf planet, and major
moon's position and axial spin is computed live from actual orbital
elements for whatever date/time is set, not a canned animation. Scrub the
±50-year slider or set an exact date, and play back time at anything from
1 second/sec (real time) to 1 year/sec using the speed buttons — **Space**
pauses/resumes. Includes a "find the next solar eclipse" challenge using
real new-moon/node geometry.

## History mode

A horizontal timeline per subject — 15 categories (Nobel Prizes, Physics,
Chemistry, Astronomy, Inventions, Zoology, Mathematics, Medicine,
Technology, Earth Science, Computer Science, Geography & Exploration,
Engineering, Psychology, Economics), 185 entries total. Click a tick to
read about it; History Challenges send you hunting for a specific one from
just a hint.

## Cybersecurity mode

A searchable, filterable reference of 48 well-documented malware strains,
hackers, hacker groups, and breaches — free-text search plus category
toggles instead of a timeline, since "find the one called X" matters more
here than "when." Cybersecurity Challenges work the same way as History's.

## Particle Physics mode

Eight real D3 force-simulation demos (Disjoint Graph, Force Lattice,
Pointer Field, Radial Tree, Gravity Wells, Swarm Box, Magnetic Charges,
Flocking), embedded as-is and switchable from their own sub-nav under the
main top bar. Drag anything you see.
