# Continuum

A browser-based sandbox spanning seven real, simulated domains — physics,
chemistry, astronomy, history, cybersecurity, mathematics, and a gallery of
D3 force simulations — all reachable from one top bar and one home screen.

Built with [Matter.js](https://brm.io/matter-js/) for the physics sandbox
(gravity, collisions, friction, restitution, constraints), [D3.js](https://d3js.org/)
for rendering/drag/pan/zoom, the Mathematics charts, and the Particle Physics
demos, and [Three.js](https://threejs.org/) for the 3D atom viewer and the
Astronomy solar system. No build step — static HTML/JS loaded via ES modules
and CDN scripts. Light theme by default, with a dark toggle in the top-right
corner.

## Running locally

Static files only (no accounts, no saving worlds/charts):

```bash
python3 -m http.server 5173
```

With accounts and saving (sign in, save up to 6 Physics worlds and 6
Mathematics items to your account) — requires only Node.js, no `npm install`:

```bash
node server/server.js
```

Either way, open http://localhost:5173.

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

## Mathematics mode

A graphing calculator plus three data-chart types, one visualization at a
time:

- **Graph** — type any `y = f(x)` expression (implicit multiplication,
  standard functions/constants, correct operator precedence — a real
  expression parser, not `eval`). Drag to pan, scroll to zoom, hover to read
  exact (x, y) values.
- **Bar Chart** / **Pie Chart** — a shared labeled-value editor (up to 10
  points) driving either visualization.
- **Venn Diagram** — 2-set or 3-set, with editable labels and region counts.
  The circles are a fixed schematic layout, not proportional-area — an
  exact proportional Venn diagram doesn't exist in general for 3+ sets, so
  showing true counts per region is the accurate choice.

## Accounts

Sign in (top-right) to save up to 6 Physics worlds and 6 Mathematics items
to your account — a "My Worlds" / "My Saved Items" button appears in each
mode once you're signed in. Requires running `node server/server.js`
(see "Running locally") — the static-only server can't do accounts, since
passwords need real server-side hashing.

Security notes: passwords are hashed with Node's built-in `crypto.scrypt`
(a memory-hard KDF, salted per user) — never stored or logged in plain
text; sessions are random 256-bit tokens in an httpOnly, `SameSite=Strict`
cookie; failed logins are rate-limited per email; login failures return a
generic error so an attacker can't tell whether an email is registered.
Account data lives in `server/data.json`, which is gitignored and never
committed.

## Monthly newsletter

Anyone who checks "send me occasional updates" at signup gets added to
`mailingList` in `server/data.json`. Each issue has a Scientist, an
Equation, and a Fact of the Day (drawn in rotation from
`server/newsletter/content.json` — add more entries any time), plus a
Science News section you write yourself in `server/newsletter/news.txt`
before the 1st, and an Advertisements section that stays hidden while
`server/newsletter/ads.txt` is empty.

**Sending is not wired up yet, by design** — you asked to hold off on
picking an email provider, so `server/newsletter/mailer.js` is currently a
stub: running the send script writes exactly the HTML that would have been
emailed into `server/outbox/*.html` (open one in a browser to see it) and
touches no real inbox. When you're ready to actually send:

1. Decide how mail goes out — either a Gmail account with an
   [App Password](https://myaccount.google.com/apppasswords) (needs
   2-Step Verification on), or an API-based sender like
   [Resend](https://resend.com), SendGrid, Mailgun, or Postmark (usually
   better deliverability for automated/bulk mail, and no SMTP code needed
   — just an API key and a `fetch` call).
2. Tell me which one, and I'll fill in the body of `sendEmail()` in
   `server/newsletter/mailer.js` to actually call it. Nothing else in the
   pipeline (content, rendering, scheduling, unsubscribe) needs to change.

**Test it now** (safe — writes local files only, sends nothing):

```bash
node server/newsletter/send.js
```

**Automate it** for the 1st of every month once real sending is wired up.
Run `crontab -e` and add (using this machine's actual `node` path — check
with `which node`, since cron's minimal environment won't find one on your
shell's `$PATH`):

```
0 9 1 * * cd /Users/taylormarr/physics-sandbox && /Users/taylormarr/.nvm/versions/node/v24.19.0/bin/node server/newsletter/send.js >> server/newsletter-log.txt 2>&1
```

That runs it at 9am on the 1st of each month. Cron only fires while the
Mac is on and awake — if this laptop is often asleep or shut on the 1st,
a `launchd` job (macOS's native scheduler, which can wake the machine for
a scheduled job under Energy Saver settings) is more reliable than cron
for exactly that reason; ask if you want that set up instead.
