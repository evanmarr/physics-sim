const MODE_CARDS = [
  {
    mode: "physics",
    icon: "⚙",
    title: "Physics",
    blurb: "Build contraptions on a grid — balls, ramps, cannons, springs, magnets — and press play to watch real rigid-body physics play out.",
  },
  {
    mode: "chemistry",
    icon: "⚗",
    title: "Chemistry",
    blurb: "Browse all 118 elements, spin up a 3D atom model, and mix elements on a bench to see what reactions they actually form.",
  },
  {
    mode: "anatomy",
    icon: "🫀",
    title: "Anatomy",
    blurb: "Explore a layered human body — skin, muscle, skeleton, organs, nervous system — and dig into the brain in detail.",
  },
];

export function renderHome(container, onEnterMode) {
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "home-wrap";

  wrap.innerHTML = `
    <div class="home-hero">
      <h1>Contraption</h1>
      <p class="home-tagline">A hands-on science sandbox — physics, chemistry, and anatomy you can drag, break, mix, and click through.</p>
    </div>
  `;

  const cards = document.createElement("div");
  cards.className = "home-cards";
  for (const c of MODE_CARDS) {
    const card = document.createElement("button");
    card.className = "home-card";
    card.innerHTML = `
      <div class="home-card-icon">${c.icon}</div>
      <div class="home-card-title">${c.title}</div>
      <div class="home-card-blurb">${c.blurb}</div>
    `;
    card.addEventListener("click", () => onEnterMode(c.mode));
    cards.appendChild(card);
  }
  wrap.appendChild(cards);

  const about = document.createElement("div");
  about.className = "home-about";
  about.innerHTML = `
    <h2>About</h2>
    <p>Contraption bundles three interactive science sandboxes into one app: a
    2D physics playground built on Matter.js and D3, a chemistry lab with a
    full periodic table and a rotatable 3D atom viewer built on Three.js, and
    an anatomy explorer for the human body — all sharing one save file and one
    coin economy across challenges in every mode.</p>
    <h2>The maker</h2>
    <p>Contraption was created by <b>Evan Marr</b>, built as a way to make
    abstract science concepts — forces, bonding, body systems — something you
    can directly manipulate and watch respond, rather than just read about.</p>
  `;
  wrap.appendChild(about);

  container.appendChild(wrap);
}
