import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { test, assert } from "./helpers.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (f) => readFileSync(path.join(root, f), "utf8");

test("manifest has required fields and icons exist on disk", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  for (const k of ["name", "short_name", "start_url", "scope", "display", "theme_color", "background_color"]) assert.ok(m[k], k);
  assert.equal(m.display, "standalone");
  assert.ok(m.categories.includes("education"));
  const sizes = m.icons.map((i) => i.sizes + ":" + i.purpose);
  for (const s of ["192x192:any", "512x512:any", "512x512:maskable"]) assert.ok(sizes.includes(s), s);
  for (const i of m.icons) assert.ok(existsSync(path.join(root, i.src)), i.src);
});

test("sw.js precaches every src module, particle page and shell file", () => {
  const sw = read("sw.js");
  assert.match(sw, /const VERSION = 'kinetic-v\d+'/);
  const files = [
    ...readdirSync(path.join(root, "src")).filter((f) => f.endsWith(".js")).map((f) => "/src/" + f),
    ...readdirSync(path.join(root, "particle-physics")).filter((f) => f.endsWith(".html")).map((f) => "/particle-physics/" + f),
    "/index.html", "/style.css", "/offline.html", "/manifest.webmanifest",
  ];
  for (const f of files) assert.ok(sw.includes(`"${f}"`) || sw.includes(`'${f}'`), "missing " + f);
  assert.ok(sw.includes("'/api/'") || sw.includes("/api/"));
});
