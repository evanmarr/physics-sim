# Contraption — 2D Physics & Chemistry Sandbox

A browser-based science sandbox with two modes, switchable from the top bar:

- **Physics** — drag objects onto a grid, tune their material and physical
  properties, then press Play to watch a real rigid-body simulation play out.
- **Chemistry** — browse the full periodic table, inspect a rotatable 3D
  model of any element's atom, and mix elements on a bench to see what they'd
  react to form.

Built with [Matter.js](https://brm.io/matter-js/) for the physics (gravity,
collisions, friction, restitution, constraints), [D3.js](https://d3js.org/)
for the grid, rendering, drag-and-drop, pan/zoom, and property panel, and
[Three.js](https://threejs.org/) for the 3D atom viewer.

## Running locally

No build step or dependencies — it's static HTML/JS loaded via ES modules and
CDN scripts. Any static file server works:

```bash
python3 -m http.server 5173
```

Then open http://localhost:5173.

## Physics mode

### Controls

- **Drag** an object from the left palette onto the grid to place it.
- **Click** an object to select it and edit its properties in the right panel
  (position, rotation, size, material, fixed/dynamic) — including an optional
  **"Show the physics"** section with the actual formulas and numbers driving
  the simulation (mass = density × area, friction, restitution, buoyancy,
  launch vectors, force falloff...).
- **Drag the rotate handle** (the dot above a selected board/triangle/cannon)
  to rotate it, or type a value directly.
- **⌘C / ⌘V** copies and pastes the selected object.
- **Space** (or the Play button) starts/stops the simulation. Stopping reverts
  to your blueprint — nothing is lost, so you can iterate freely.
- **Delete/Backspace** removes the selected object. **Escape** deselects.
- The **gravity slider** works both before and during a run.

### Objects

- **Ball**, **Board**, **Triangle** (always equilateral) — core shapes, each
  with an adjustable material.
- **Ball Bearing** — a fixed pivot point. Drop one inside a board or triangle
  and, on Play, that object pivots/swings around it like a see-saw or
  pendulum — regardless of its own Fixed checkbox, since the pivot implies it
  should be free to swing.
- **Peg** — a small fixed bouncer/obstacle, no pivot behavior.
- **Cannon** — has a Rest Angle and a Fire Angle/Power. A ball that falls into
  the dashed catch zone (shown while editing) is consumed and re-fired.
- **Fan** — blows a continuous, adjustable-strength wind force out of its
  face over a settable range.
- **Spring Pad** — gives anything that touches it a one-shot launch along its
  own "up" direction at a set power.
- **Bomb**, **Button**, **Magnet** — unlocked from the Shop with coins. Bombs
  blast nearby objects outward on impact; buttons trigger a linked cannon or
  bomb when something presses them; magnets continuously attract (or, at
  negative power, repel) metal objects within range.

### Materials

Each material carries real relative density, friction, and restitution:

- **Wood**, **Metal**, **Rubber** (bouncy), **Ice** (slippery) — normal solids.
- **Glass** — solid until struck hard enough, then shatters into fading
  debris with a flash/ring burst effect.
- **Water** — not solid; other objects float or sink in it based on
  Archimedes' principle (their density vs. water's), with drag slowing them
  as they submerge.

### Challenges & economy

Open **Challenges** to load a preset puzzle. Each one is tagged with the
physics concept it teaches — elastic collisions, impact force, continuous
force vs. weight, buoyancy, torque — and is verified solvable (and not
trivially solved by its own defaults) by direct simulation, not just by eye.
Completing one awards coins, spendable in the **Shop**.

Progress (coins, unlocked items, completed challenges, and your current
workspace) autosaves to `localStorage`, and is shared with Chemistry mode.

## Chemistry mode

- **Periodic table** — all 118 elements, color-coded by category. Click a
  tile to inspect it; double-click (or use "Add to mixing bench") to add it
  to the bench.
- **Atom viewer** — a rotatable, zoomable 3D model (drag to orbit, scroll to
  zoom) of the selected element: a nucleus of protons and neutrons, with one
  animated electron ring per shell. Shell electron counts are derived from
  the standard Aufbau fill order summed by principal shell — correct for the
  large majority of elements, though (as in any simplified shell model) a
  couple dozen known transition-metal/lanthanide exceptions aren't
  special-cased.
- **Mixing bench** — add two elements (or one element + water, via the
  dedicated button) and hit React. A curated set of ~25 well-known, named
  reactions is checked first; anything else falls through to a general
  bonding-rule engine (metal + nonmetal → predicted ionic compound, nonmetal
  + nonmetal → covalent, metal + metal → alloy, noble gas → inert) so every
  pairing gets a real, chemically-reasoned answer, not just the famous ones.
- **Chemistry Challenges** — from the mixing bench panel, each tagged with
  its own concept (covalent vs. ionic bonding, reactivity trends, metallic
  bonding, inertness of noble gases) and paid out from the same coin economy
  as Physics mode.
