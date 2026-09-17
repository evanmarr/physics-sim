# Kinetic

**Build it. Change it. See what happens.**

Kinetic is an open-ended educational simulation platform. Where a typical
"physics sandbox" app hands you one fixed simulation, Kinetic's whole
premise is that you build the scene, change any real parameter, and watch
what actually happens — across physics, chemistry, astronomy, and nine
other real domains, all from one app.

Brand colors: cyan `#38bdf8`, purple `#8b5cf6`, green `#10b981` (see
`--cool-1/2/3` in `style.css`).

## Product philosophy

- **Accuracy is never a paywall.** Factual correctness, sources/citations,
  and core educational explanations are free for everyone, permanently —
  see "Plans" below and every module's "How This Model Works" panel.
- **Real data, not decoration.** Graphs, telemetry, and "how this works"
  content are drawn from each simulation's actual live state or actual
  implementation — this codebase does not fabricate data to make a
  feature look more interesting than the underlying model supports.
- **No real money or AI moves without saying so.** Nothing in this repo
  charges a real card, calls a real AI provider, or sends a transactional
  email without it being documented here as real. See "What's real vs.
  architecture only" below.

## Subjects/modules

Physics, Chemistry, Astronomy (Solar System + Rocket Simulator), History,
Cybersecurity, Particle Physics (abstract D3 demos — see disclaimer
below), Mathematics, Whiteboard, Economics, Zoology, Sound, and
Sustainability — one top bar, one home screen.

Each core sandbox (Physics especially) follows the same idea: drag a real
object onto a canvas, edit its real properties, run a real simulation, see
a real result — not a slideshow of pre-baked outcomes.

## Plans: Free, Plus, Teacher, and Promo Plus

Entitlements are centralized in `server/entitlements.js` — the one place
in the app that resolves "what can this account do" from a real source
record, never a bare `plan === "plus"` string check scattered elsewhere.

**Free** is deliberately generous: every subject, the full core 2D Physics
sandbox, Explore and most of Learn mode, daily challenges, tutorials,
quizzes, limited saved worlds (6) and Custom Notebook entries (8), basic
Live Graphs, and — always, regardless of plan — How This Model Works,
sources, and every factual explanation in the app.

**Kinetic Plus** adds: unlimited saved worlds/Notebook entries, full
Compare Runs history, advanced graph overlays + CSV export, Physics 3D,
Custom Physics Items, Physics world share codes, Advanced mode, and other
non-essential polish. **No real payment processor is connected yet** — the
Plans screen has a real checkout flow (plan → monthly/annual billing →
review, with real illustrative pricing from `server/checkoutConfig.js`),
but it always ends at an explicit "payments aren't live yet" screen
instead of an actual charge. Clicking "Notify me" there records real
interest (`upgrade_interest` in Postgres — plan, billing period, per
account) so demand isn't lost while a processor isn't wired up.

**Teacher** is a superset of Plus, plus classrooms, rosters, and teacher
controls (assignments/submissions/progress dashboards are a documented
limitation below — the classroom join/leave/roster mechanics exist, the
richer LMS-style layer doesn't yet). Students never need Plus to
participate in a class.

**Promo Plus** — a 6-digit code (entered via the small blue square in the
Plans screen's top-right corner) grants every **non-AI** Plus feature:
Physics 3D, Custom Items, advanced graphs, Compare Runs, world share
codes, and more. **Promo Plus never includes AI, by design** — this is
enforced in `resolveEntitlements()` itself (`planSource === "promo_plus"`
hard-blocks `aiEnabled` regardless of any other flag), not just a UI
convention. Promo codes are created and managed from the separate
`~/physics-sim-admin` localhost-only dashboard — never from the live site.

Every plan source (`paid_plus`, `promo_plus`, `teacher`, `admin`, and the
architecture for a future `classroom_assignment` scoped grant) is tracked
explicitly, so the app — and a future support conversation — can always
answer *how* an account got its access, not just *that* it has access.

## Physics 3D (Kinetic Plus)

A separate, intentionally simpler 3D sandbox — balls and boxes, real
gravity/collisions/friction/restitution via [cannon-es](https://github.com/pmndrs/cannon-es),
rendered with [Three.js](https://threejs.org/) (OrbitControls for
orbit/zoom). It's a tab inside Physics mode ("Physics 2D" / "Physics
3D"), fully isolated from the 2D engine's own state so neither can break
the other. Free accounts see a locked preview explaining the feature;
Physics 2D itself loses no capability.

Controls deliberately mirror Physics 2D's own feel rather than a generic
3D-editor scheme: **drag empty space to orbit, drag an object to move it**
(along the horizontal plane it's currently sitting at — the same
live-visual-during-drag, commit-on-release model 2D's object dragging
uses), **scroll to zoom**, **right-click-drag (mouse) or shift+two-finger
drag (touch) to pan**, and **Space to play/pause, R to reset** — the same
two keys Physics 2D uses. Balls resize via radius; boxes get independent
X/Y/Z dimensions, so a box is real shape editing (a flat slab vs. a tall
pillar vs. a cube), not just a uniform scale slider.

## Custom Physics Items (Kinetic Plus)

A polygon editor (`src/customItems.js`): start from a regular N-gon, drag
vertices to reshape it, save/name/duplicate/reuse it. The collision shape
*is* the vertices you drew (`Bodies.fromVertices` in `physics.js`) — never
a circle/rectangle standing in for a custom picture. Shapes may be any
**simple (non-self-intersecting) polygon, concave included** — Matter's
built-in vertex handling only guarantees correct decomposition for convex
geometry on its own, so `poly-decomp` (loaded via CDN, wired in through
`Matter.Common.setDecomp`) automatically splits a concave shape into
convex parts before it ever reaches the physics engine. Only a genuinely
self-intersecting (bowtie) outline is rejected — poly-decomp itself
requires simple input — with a clear reason shown live at edit time.

## Live Graphs, Experiment Notebook, Compare Runs

- **Live Graphs** (`src/graphs.js`) — a reusable line-graph engine driven
  by real per-tick simulation state. Wired into Physics 2D (selected
  object's speed/vertical velocity/kinetic energy), Rocket Simulator
  (altitude/velocity/fuel), Astronomy (a selected planet's real distance
  from the Sun and its instantaneous orbital speed — the speed is a live
  numerical derivative of two real Kepler positions, not a canned number),
  and Economics's Supply & Demand model (equilibrium price/quantity as you
  move the curve sliders). Free gets a real rolling window (default 60s);
  Plus gets full history and CSV export. Other modules can plug into the
  same engine without rework — not yet done for all of them (see
  Limitations).
- **Experiment Notebook** (`src/notebook.js`) — Prediction → Experiment →
  Observation → Explanation → Save, using the same generic saved-items
  backend as saved worlds. A "Capture current world" button grabs the
  *actual* live object array and a real rendered thumbnail (not a
  placeholder). Free: 8 entries. Plus: unlimited.
- **Compare Runs** — pick any two Notebook entries and see a side-by-side
  diff (prediction/observation/conclusion, highlighted where they differ)
  plus both entries' captured final-state snapshots when present.

## Explore / Learn / Advanced

A real, working preference (`src/experienceLevel.js`), not just marketing
copy — reuses the onboarding quiz's existing "how much science background
do you have?" answer as a sensible default instead of asking a second,
redundant question. **Explore** hides Physics's equations panel by
default for a lower-friction sandbox; **Learn** shows it, with each
editable variable (density, friction, restitution, etc.) as a slider
constrained to its real valid range; **Advanced** is Plus-gated and shows
the exact same variables as a plain number input instead — real
fine-grained typed control, but still only over that one variable, never
free-text on the formula itself. Advanced also exposes the other already-
real Plus tooling (Physics 3D, advanced graphs) — the product rule here is
that nothing gets exposed as "Advanced" unless the underlying model
actually supports it.

## How This Model Works

A standardized panel (`src/modelInfo.js`) — concept, equation, variables,
constants, assumptions, simplifications, and sources — **never gated by
plan**. Currently wired into Physics 2D, Rocket Simulator, Astronomy
(Kepler's equation), Economics (both Supply & Demand and Game Theory,
switching content with the active tab), Sustainability (the actual
scoring formula from its own code, not a paraphrase), Chemistry (the real
121-reaction curated table plus the general bonding-rule engine it falls
back to), Sound (switching between Record & Visualize and Make Your Own
Sound, including the equal-temperament formula), Mathematics (the real
recursive-descent expression parser behind Graph — never `eval` — and a
plain note that Bar/Pie/Venn are direct data visualizations with no
underlying model), and Zoology (the real 10% trophic-efficiency rule
behind the Energy Pyramid, and the real predator-prey edges behind the
Food Web Builder), with content verified against each module's actual
implementation (not general-knowledge claims). Particle Physics's 8 demos
(each a standalone HTML file in an iframe, not a `src/*.js` module) keep
their own real inline explanations instead — e.g. "Epidemic Spread"
genuinely implements SIR states over a real contact network, and
"Percolation" genuinely implements a probability-threshold phase
transition — retrofitting the shared modal there would need cross-frame
messaging for little added benefit. Every per-challenge win condition across every
module's challenge ladder (`challenges.js`, `rocketSim.js`, etc.) has
carried its own `explanation`/`source` fields since before this pass —
`How This Model Works` complements that with a per-simulation view, not a
per-challenge one.

## Physics world share codes (Kinetic Plus to generate; free to load)

A short, typeable code (displayed like `K7P4-X2`) that loads a specific
world snapshot — separate from Community Sims (a permanent public
gallery) and classroom sharing (membership-scoped). Generating a code
needs Plus (Promo Plus included, since it's non-AI); loading one is open
to anyone, so a link/code shared publicly still works for a free visitor.
Loading warns before replacing an unsaved current world, and rejects a
code saved by a newer schema version than this deployment understands.

## Community, challenges, and classrooms

Community Sims (a public gallery with search/favorite/remix/report),
per-module challenge ladders (`Simple → Impossible`, each with a real
verified pass/fail condition), and classrooms (join by 6-character code;
a teacher can push/pull items to/from students) all predate this pass and
are described in more detail in the code's own module-level comments
(`server/db.js`, `src/classroom.js`, `src/challengeTiers.js`).

## Rocket Simulator

A real 2D launch-to-orbit sim under Astronomy mode: inverse-square
gravity, the actual rocket equation, exponential-atmosphere drag,
staging, and real orbital mechanics (vis-viva, escape velocity). Moon,
Venus, and Mars are drawn at their real *current* ephemeris position and
distance (not a fixed illustrative placement); the dotted line shown is
the rocket's own live orbit around whichever body it's at, not another
planet's path. See its own in-app "How This Model Works" panel for the
full equation/assumptions list.

## Kinetic AI Tutor — real chat UI, no AI provider connected

**No AI provider is called anywhere in this codebase.** A real "🤖 AI
Tutor" button lives in the global top bar (`src/aiTutor.js`) — reachable
from anywhere in the app, not nested inside any one subject mode, and
Plus-gated the same way Physics 3D and Custom Items are (a locked
"See Plans" screen for a free account). It opens a real chat UI with
message history, a disabled-while-waiting input, and a real round trip to
`POST /api/ai-chat` — but that route never calls a real provider and
always returns the same honest, static reply: *"Sorry, I encountered a
problem. Please try again later, or contact kinetic.sims@gmail.com"*.
This is a stub, not a mock of a working feature — the chat mechanics are
already built and tested for whenever a real provider is wired in; that
day's change is to that one server route, not a client rewrite.

Cost-safe architecture for that future integration already exists too:

- `server/aiConfig.js` centralizes `AI_MONTHLY_COST_CAP_USD = 3.00` (one
  constant, not scattered `$3` literals), a model/pricing config left
  intentionally `"unconfigured"` (no future model's exact
  availability/pricing can be promised today), a mocked cost estimator
  that returns `0` until real pricing is set, and `canAffordRequest()` —
  the check a real integration would run *before* ever sending a request.
- `server/db.js`'s `ai_usage_periods` table accumulates *estimated* cost
  per user per calendar month — architecture for accounting, never
  populated by a real call today.
- AI access (`aiEnabled`) is a field entirely separate from Plus/plan —
  see `resolveEntitlements()`. Paid Plus may include AI later; **Promo
  Plus is hard-blocked from AI regardless of any other flag.**
- The planned interaction model (once connected): Hint → Bigger Hint →
  Explain It, Socratic by default, aware of your current
  simulation/world/challenge — never an unlimited-usage promise.

## What's real vs. architecture only

| Area | Status |
|---|---|
| Accounts, sessions, saved worlds/Notebook/Custom Items | Real (Postgres/Neon) |
| Email (verification codes, feedback, newsletter) | Real (Gmail SMTP — predates this pass) |
| Promo codes, entitlements, world share codes | Real |
| Checkout flow (plan/billing-period pick, review, interest capture) | Real UI + real DB row, no charge |
| Actual payment processor / real charges / subscriptions | **Not implemented** — see `server/checkoutConfig.js` |
| AI Tutor chat UI (tab, message history, send) | Real UI + real server round trip |
| An actual AI provider behind that chat | **Not implemented** — always returns a static error, zero API calls |

## Accuracy philosophy

Never fabricate a citation. Where a claim can't be verified against this
project's own real implementation, it's marked for review rather than
asserted. Two known-simplified visualizations carry an explicit in-app
caveat rather than a silent omission: the Particle Physics tab's abstract
D3 demos are labeled as not being real particle physics, and the Chemistry
Atom Viewer's Bohr-style fixed-orbit electrons are labeled as a
simplification (real electrons occupy probability clouds, not fixed
rings).

## Architecture

No bundler — plain ES modules loaded via `<script type="module">`, plus a
few CDN scripts (Matter.js, D3, Three.js/OrbitControls) as browser
globals; `cannon-es` (Physics 3D) is the one dependency imported as a real
ES module straight from its CDN URL. Server-side: `server/server.js`
(shared by both the always-on local server and `api/[...path].js`'s
Vercel serverless entry point) and `server/db.js` (Postgres via `pg`).
Canonical configuration lives in dedicated files, not scattered constants:
`server/entitlements.js` (plans/limits), `server/aiConfig.js` (AI cost
config), `server/checkoutConfig.js` (pricing + the one `connected` flag a
real payment processor integration would flip), `src/objectTypes.js` (the
Physics object-type registry),
`src/challengeTiers.js` (the shared challenge-ladder shape every module's
`CHALLENGES` array is validated against).

## Setup

```bash
npm install
npm test               # runs tests/ — pure-logic checks, no live DB needed
```

Static files only (no accounts):

```bash
python3 -m http.server 5173
```

With accounts (sign in, save worlds/Notebook/Custom Items, promo codes,
classrooms) — needs a real Postgres `DATABASE_URL`:

```bash
npm start
```

`npm start` runs `node --env-file=.env.local server/server.js` — always
use it (or pass `--env-file=.env.local` yourself) rather than running
`node server/server.js` bare. Without that flag, `GMAIL_USER`/
`GMAIL_APP_PASSWORD` never get loaded even if they're correctly set in
`.env.local`, so every email (verification codes, feedback, newsletter)
silently falls back to writing a local file in `server/outbox/` instead
of actually sending — nothing errors, it just looks like sending doesn't
work.

Open http://localhost:5173 either way.

### Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres (Neon) connection string |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Real email sending (see below) — both required together |
| `PORT` | Local server port (defaults to 5173) |

### Email sending

Real, via Gmail SMTP (`server/newsletter/mailer.js`) — this is the same
`sendEmail()` used for sign-in verification codes, feedback, *and* the
monthly newsletter. Without both `GMAIL_USER`/`GMAIL_APP_PASSWORD` set, it
falls back to writing the HTML to `server/outbox/*.html` instead of
sending, so nothing breaks if they're unset locally. Setup: enable
2-Step Verification on the Gmail account, generate an App Password at
`myaccount.google.com/apppasswords`, set both variables (Vercel: Project
Settings → Environment Variables; locally: `.env.local`, gitignored).

## Known limitations

- **A real payment processor is not connected** — see the table above; the
  checkout UI and interest-capture are real, the charge at the end isn't.
- **Live Graphs** are wired into Physics 2D, Rocket Simulator, Astronomy,
  and Economics only — Chemistry, Sound, Sustainability, Mathematics, and
  Zoology don't have an obvious real time-series to graph, so they get
  **How This Model Works** info panels only. History and Cybersecurity are
  reference/lookup tools rather than simulations, so neither pattern
  applies to them. Particle Physics's 8 demos keep their own inline
  explanations (see above) instead of the shared modal.
- **Classroom assignments/submissions/progress dashboards** aren't built
  yet — classrooms (join/leave/roster/push-pull items) exist; the
  entitlement architecture already supports a future
  `classroom_assignment`-scoped temporary Plus grant
  (`withClassroomAssignmentScope()` in `server/entitlements.js`), but
  nothing calls it yet since the assignment feature itself doesn't exist.
- `~/physics-sim-admin` is a separate, localhost-only, unauthenticated
  admin dashboard (promo codes, Community Sims curation, donor/classroom
  email) — deliberately not part of the deployed site.
