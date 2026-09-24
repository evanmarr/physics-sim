import { test, assert } from "./helpers.js";
import { dateToJulianDate, julianDateToDate, planetPosition, PLANETS, orbitalPeriodDays } from "../src/astronomyData.js";

test("Julian date round-trips through a real date", () => {
  const d = new Date("2026-01-01T00:00:00.000Z");
  const jd = dateToJulianDate(d);
  const back = julianDateToDate(jd);
  assert.equal(back.getTime(), d.getTime());
});

test("J2000.0 epoch (2000-01-01 12:00 UTC) is Julian Date 2451545.0", () => {
  const jd = dateToJulianDate(new Date("2000-01-01T12:00:00.000Z"));
  assert.ok(Math.abs(jd - 2451545.0) < 0.01, `expected ~2451545.0, got ${jd}`);
});

test("Earth's computed heliocentric distance is very close to 1 AU", () => {
  const earth = PLANETS.find((p) => p.name === "Earth");
  const jd = dateToJulianDate(new Date("2026-06-01T00:00:00.000Z"));
  const pos = planetPosition(earth, jd);
  const r = Math.hypot(pos.x, pos.y, pos.z);
  assert.ok(r > 0.98 && r < 1.02, `Earth's distance from the Sun should be ~1 AU, got ${r}`);
});

test("real relative orbital periods: Mercury < Earth < Mars < Jupiter", () => {
  const byName = (n) => PLANETS.find((p) => p.name === n);
  const mercury = orbitalPeriodDays(byName("Mercury"));
  const earth = orbitalPeriodDays(byName("Earth"));
  const mars = orbitalPeriodDays(byName("Mars"));
  const jupiter = orbitalPeriodDays(byName("Jupiter"));
  assert.ok(mercury < earth, "Mercury orbits faster than Earth");
  assert.ok(earth < mars, "Earth orbits faster than Mars");
  assert.ok(mars < jupiter, "Mars orbits faster than Jupiter");
  assert.ok(Math.abs(earth - 365.25) < 2, `Earth's period should be ~365.25 days, got ${earth}`);
});

test("next solar eclipse from mid-2026 is the 12 Aug 2026 one (within a day or two)", async () => {
  const { findNextSolarEclipse } = await import("../src/astronomyData.js");
  const r = findNextSolarEclipse(new Date("2026-07-01T00:00:00Z"));
  const target = Date.parse("2026-08-12T17:00:00Z");
  assert.ok(Math.abs(r.date.getTime() - target) < 2 * 86400000, `got ${r.date.toISOString()}`);
  assert.ok(r.likely);
});
