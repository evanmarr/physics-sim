# Contraption — 2D Physics Sandbox

A browser-based sandbox for building 2D physics contraptions: drag objects onto a
grid, tune their material and physical properties, then press Play to watch a
real rigid-body simulation play out.

Built with [Matter.js](https://brm.io/matter-js/) for the physics (gravity,
collisions, friction, restitution, constraints) and [D3.js](https://d3js.org/)
for the grid, rendering, drag-and-drop, pan/zoom, and property panel.

## Running locally

No build step or dependencies — it's static HTML/JS loaded via ES modules and
CDN scripts. Any static file server works:

```bash
python3 -m http.server 5173
```

Then open http://localhost:5173.

## Controls

- **Drag** an object from the left palette onto the grid to place it.
- **Click** an object to select it and edit its properties in the right panel
  (position, rotation, size, material, fixed/dynamic).
- **Drag the rotate handle** (the dot above a selected board/triangle/cannon)
  to rotate it, or type a value directly.
- **Space** (or the Play button) starts/stops the simulation. Stopping reverts
  to your blueprint — nothing is lost, so you can iterate freely.
- **Delete/Backspace** removes the selected object. **Escape** deselects.
- The **gravity slider** works both before and during a run.

## Objects

- **Ball**, **Board**, **Triangle** — core shapes, each with an adjustable
  material.
- **Ball Bearing** — a fixed pivot point. Drop one inside a dynamic board or
  triangle and, on Play, that object pivots/swings around it like a see-saw
  or pendulum.
- **Cannon** — has a start angle and a launch angle/power. A ball that falls
  into it is consumed and re-fired at the launch angle.
- **Bomb**, **Button** — unlocked from the Shop with coins. Bombs blast
  nearby objects outward on impact; buttons trigger a linked cannon or bomb
  when something presses them.

## Materials

Each material carries real relative density, friction, and restitution:

- **Wood**, **Metal**, **Rubber** (bouncy), **Ice** (slippery) — normal solids.
- **Glass** — solid until struck hard enough, then shatters into shards.
- **Water** — not solid; other objects float or sink in it based on
  Archimedes' principle (their density vs. water's), with drag slowing them
  as they submerge.

## Challenges & economy

Open **Challenges** to load a preset puzzle (e.g. "Triple Bounce" — aim a
cannon so one ball bounces off three rubber boxes). Completing one awards
coins, spendable in the **Shop** to unlock Bombs and Buttons permanently.

Progress (coins, unlocked items, completed challenges, and your current
workspace) autosaves to `localStorage`.
