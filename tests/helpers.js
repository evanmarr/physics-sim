// Minimal test registry shared by every tests/*.test.js file — see
// tests/run.js. No framework dependency: this project has almost none
// (pg, nodemailer) and these tests only exercise pure logic modules.
import assert from "node:assert/strict";

export const registry = [];
export function test(name, fn) { registry.push({ name, fn }); }
export { assert };
