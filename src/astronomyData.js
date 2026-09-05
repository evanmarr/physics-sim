// Real Keplerian orbital mechanics — not an animation loop, an actual
// position calculation for whatever date/time is set. Planet positions use
// the standard J2000.0 mean orbital elements (Standish/JPL "Keplerian
// Elements for Approximate Positions of the Major Planets," valid roughly
// 1800–2050) propagated by solving Kepler's equation. The Moon and Sun use
// Jean Meeus's well-known low-precision series (Astronomical Algorithms) —
// accurate to a fraction of a degree, which is what "when's the next solar
// eclipse" needs: a real astronomical technique (new moon near a lunar
// node), just not JPL-ephemeris precision.

const DEG = Math.PI / 180;

export function dateToJulianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

export function julianDateToDate(jd) {
  return new Date((jd - 2440587.5) * 86400000);
}

function juliancenturies(jd) {
  return (jd - 2451545.0) / 36525;
}

function norm360(deg) {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}
function norm180(deg) {
  let d = norm360(deg);
  if (d > 180) d -= 360;
  return d;
}

// [a, aDot, e, eDot, i, iDot, L, LDot, peri(varpi), periDot, node(Omega), nodeDot]
// a: AU, AU/century. angles: degrees, degrees/century.
// rotationHours: real sidereal rotation period (axial spin), negative for
// retrograde rotation (Venus, Uranus spin backwards relative to their orbit).
export const PLANETS = [
  { name: "Mercury", color: "#b5adad", radiusKm: 2440, rotationHours: 1407.6, elements: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.25032350, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081] },
  { name: "Venus", color: "#e8cda2", radiusKm: 6052, rotationHours: -5832.5, elements: [0.72333566, 0.00000390, 0.00677672, -0.00004107, 3.39467605, -0.00078890, 181.97909950, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418] },
  { name: "Earth", color: "#4f8cff", radiusKm: 6371, rotationHours: 23.93, elements: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0.0, 0.0] },
  { name: "Mars", color: "#c1440e", radiusKm: 3390, rotationHours: 24.62, elements: [1.52371034, 0.00001847, 0.09339410, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343] },
  { name: "Jupiter", color: "#d8aa79", radiusKm: 69911, rotationHours: 9.93, elements: [5.20288700, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106] },
  { name: "Saturn", color: "#e3c98d", radiusKm: 58232, rotationHours: 10.66, elements: [9.53667594, -0.00125060, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794] },
  { name: "Uranus", color: "#9fd9e6", radiusKm: 25362, rotationHours: -17.24, elements: [19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939, 313.23810451, 428.48202785, 170.95427630, 0.40805281, 74.01692503, 0.04240589] },
  { name: "Neptune", color: "#5b7fe0", radiusKm: 24622, rotationHours: 16.11, elements: [30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372, -55.12002969, 218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664] },
];

// Dwarf planets — same orbital-element shape and Kepler propagation as the
// 8 majors, so they're positioned by the same real physics. Unlike the
// majors (which use JPL's standardized high-precision mean-element table),
// these use well-known real values for size/shape (a, e, i) but an
// approximate current phase (mean anomaly at J2000) reconstructed from
// known perihelion-passage dates rather than a precise ephemeris — good
// enough to place them in roughly the right part of their orbit, not to
// the day. Secular drift (aDot/eDot/...) is left at 0: real, but tiny
// enough over human timescales to ignore for this.
export const DWARF_PLANETS = [
  { name: "Ceres", color: "#8c8577", radiusKm: 473, rotationHours: 9.07, elements: [2.7658, 0, 0.0785, 0, 10.587, 0, 249.5, 7825.0, 153.51, 0, 80.393, 0] },
  { name: "Pluto", color: "#d9c8a5", radiusKm: 1188, rotationHours: 153.3, elements: [39.482, 0, 0.2488, 0, 17.16, 0, 239.12, 145.11, 224.13, 0, 110.299, 0] },
  { name: "Eris", color: "#e8e8e8", radiusKm: 1163, rotationHours: 25.9, elements: [67.78, 0, 0.44177, 0, 44.04, 0, 21.33, 64.50, 187.23, 0, 35.95, 0] },
];

// Major moons, rendered as simple circular orbits around their host planet
// using each moon's real orbital period (so they move at the true rate) —
// not a full perturbation model like the planets/Sun/Moon get. A negative
// period marks a retrograde orbit (Triton orbits Neptune backwards, a sign
// it was captured rather than formed in place).
export const MOONS = [
  { name: "Io", host: "Jupiter", periodDays: 1.769, radiusKm: 1821, color: "#e8d27a" },
  { name: "Europa", host: "Jupiter", periodDays: 3.551, radiusKm: 1560, color: "#c9b896" },
  { name: "Ganymede", host: "Jupiter", periodDays: 7.155, radiusKm: 2634, color: "#9a8f7d" },
  { name: "Callisto", host: "Jupiter", periodDays: 16.689, radiusKm: 2410, color: "#6e6558" },
  { name: "Rhea", host: "Saturn", periodDays: 4.518, radiusKm: 764, color: "#b8b0a3" },
  { name: "Titan", host: "Saturn", periodDays: 15.945, radiusKm: 2575, color: "#e0a95c" },
  { name: "Titania", host: "Uranus", periodDays: 8.706, radiusKm: 789, color: "#9fb0b8" },
  { name: "Oberon", host: "Uranus", periodDays: 13.463, radiusKm: 761, color: "#8a99a3" },
  { name: "Triton", host: "Neptune", periodDays: -5.877, radiusKm: 1353, color: "#c9d8e0" },
];

export function moonPhaseAngleRad(moon, jd) {
  return norm360((jd / moon.periodDays) * 360) * DEG;
}

function solveKepler(Mrad, e) {
  let E = Mrad + e * Math.sin(Mrad);
  for (let i = 0; i < 8; i++) {
    const dE = (E - e * Math.sin(E) - Mrad) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  return E;
}

// Heliocentric ecliptic Cartesian position in AU at Julian Date jd.
export function planetPosition(planet, jd) {
  const T = juliancenturies(jd);
  const [a0, aDot, e0, eDot, i0, iDot, L0, LDot, peri0, periDot, node0, nodeDot] = planet.elements;
  const a = a0 + aDot * T;
  const e = e0 + eDot * T;
  const i = (i0 + iDot * T) * DEG;
  const L = L0 + LDot * T;
  const peri = peri0 + periDot * T;
  const node = node0 + nodeDot * T;
  const omega = (peri - node) * DEG;
  const Omega = node * DEG;
  const M = norm180(L - peri) * DEG;

  const E = solveKepler(M, e);
  const xOrb = a * (Math.cos(E) - e);
  const yOrb = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cosO = Math.cos(Omega), sinO = Math.sin(Omega);
  const cosw = Math.cos(omega), sinw = Math.sin(omega);
  const cosi = Math.cos(i), sini = Math.sin(i);

  const x = (cosO * cosw - sinO * sinw * cosi) * xOrb + (-cosO * sinw - sinO * cosw * cosi) * yOrb;
  const y = (sinO * cosw + cosO * sinw * cosi) * xOrb + (-sinO * sinw + cosO * cosw * cosi) * yOrb;
  const z = (sinw * sini) * xOrb + (cosw * sini) * yOrb;
  return { x, y, z, a, e };
}

export function orbitalPeriodDays(planet) {
  const a = planet.elements[0];
  return Math.sqrt(a * a * a) * 365.25;
}

// ---- Sun (geocentric apparent longitude) and Moon (geocentric), Meeus low-precision ----

function sunEclipticLongitudeDeg(T) {
  const L0 = norm360(280.46646 + 36000.76983 * T);
  const M = norm360(357.52911 + 35999.05029 * T) * DEG;
  const C = (1.914602 - 0.004817 * T) * Math.sin(M) + 0.019993 * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  return norm360(L0 + C);
}

function moonEclipticDeg(T) {
  const Lp = norm360(218.3164477 + 481267.88123421 * T);
  const D = norm360(297.8501921 + 445267.1114034 * T) * DEG;
  const M = norm360(357.5291092 + 35999.0502909 * T) * DEG;
  const Mp = norm360(134.9633964 + 477198.8675055 * T) * DEG;
  const F = norm360(93.2720950 + 483202.0175233 * T) * DEG;

  const lon = Lp
    + 6.288774 * Math.sin(Mp) - 1.274027 * Math.sin(2 * D - Mp) + 0.658314 * Math.sin(2 * D)
    - 0.185116 * Math.sin(M) - 0.059268 * Math.sin(2 * D - 2 * Mp) - 0.057048 * Math.sin(2 * D - M - Mp)
    + 0.053255 * Math.sin(2 * D + Mp) + 0.045654 * Math.sin(2 * D - M) + 0.041024 * Math.sin(Mp - M)
    - 0.034718 * Math.sin(D) - 0.030465 * Math.sin(Mp + M);

  const lat = 5.128122 * Math.sin(F) + 0.280602 * Math.sin(Mp + F) + 0.277693 * Math.sin(Mp - F)
    + 0.173237 * Math.sin(2 * D - F) + 0.055413 * Math.sin(2 * D + F - Mp) + 0.046271 * Math.sin(2 * D - F - Mp);

  return { lon: norm360(lon), lat };
}

// Moon's geocentric ecliptic position, used only to draw it near Earth —
// direction is accurate, distance is a fixed mean value for legibility.
export function moonOffsetFromEarth(jd) {
  const T = juliancenturies(jd);
  const { lon, lat } = moonEclipticDeg(T);
  const lonR = lon * DEG, latR = lat * DEG;
  const distAU = 0.00257; // mean Earth-Moon distance in AU
  return {
    x: distAU * Math.cos(latR) * Math.cos(lonR),
    y: distAU * Math.cos(latR) * Math.sin(lonR),
    z: distAU * Math.sin(latR),
    lon, lat,
  };
}

// Angular separation (degrees) between Sun and Moon as seen from Earth, and
// the Moon's ecliptic latitude — both needed to judge "new moon near a node."
function sunMoonGeometry(jd) {
  const T = juliancenturies(jd);
  const sunLon = sunEclipticLongitudeDeg(T);
  const moon = moonEclipticDeg(T);
  const sep = Math.abs(norm180(moon.lon - sunLon));
  return { sep, moonLat: moon.lat };
}

// Search forward from `fromDate` for new-moon moments (Sun/Moon ecliptic
// longitude aligned) and report whichever is closest to a lunar node (small
// |latitude|) as the best solar-eclipse candidate — the real condition for
// a solar eclipse, evaluated with a simplified (Meeus low-precision) model
// rather than full perturbation theory, so treat the date as an estimate
// good to within roughly a day, not a to-the-minute prediction.
export function findNextSolarEclipse(fromDate, searchMonths = 18) {
  const startJd = dateToJulianDate(fromDate);
  const endJd = startJd + searchMonths * 30.437;

  // The synodic month (new moon to new moon) is ~29.53 days: find the first
  // new moon at/after fromDate by fine scanning, then step by that period to
  // get every subsequent new moon, refining each with a local minimization.
  const synodic = 29.530588;
  let jd = startJd;
  const candidates = [];
  // find the first new moon at/after startJd by scanning finely for ~35 days
  let best = null;
  for (let t = startJd; t < startJd + 35; t += 0.1) {
    const { sep } = sunMoonGeometry(t);
    if (!best || sep < best.sep) best = { jd: t, sep };
  }
  let cursor = best.jd;
  while (cursor < endJd) {
    // refine around cursor with a fine local search
    let refined = null;
    for (let t = cursor - 1; t <= cursor + 1; t += 0.02) {
      const { sep, moonLat } = sunMoonGeometry(t);
      if (!refined || sep < refined.sep) refined = { jd: t, sep, moonLat };
    }
    candidates.push(refined);
    cursor += synodic;
  }

  candidates.sort((a, b) => Math.abs(a.moonLat) - Math.abs(b.moonLat));
  const winner = candidates[0];
  return {
    date: julianDateToDate(winner.jd),
    moonLatitude: winner.moonLat,
    separation: winner.sep,
    likely: Math.abs(winner.moonLat) < 1.5,
    allCandidates: candidates.map((c) => ({ date: julianDateToDate(c.jd), moonLat: c.moonLat })),
  };
}
