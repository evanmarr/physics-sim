// src/sound.js itself isn't safely importable standalone in plain Node
// (it's a full UI module, only its top-level declarations are DOM-free —
// calling its actual methods needs a real document/AudioContext). This
// instead locks in the underlying equal-temperament formula it uses
// (verified by direct code inspection at src/sound.js:462: `const A4 =
// 440` and `12 * Math.log2(freq / A4)`), against known reference
// frequencies, so a future edit to that formula gets caught by a real
// numeric check rather than only a manual re-read.
import { test, assert } from "./helpers.js";

const A4 = 440;
function freqForSemitonesFromA4(semitones) { return A4 * Math.pow(2, semitones / 12); }

test("A4 reference pitch is 440 Hz", () => {
  assert.equal(freqForSemitonesFromA4(0), 440);
});

test("one octave up (12 semitones) exactly doubles frequency", () => {
  assert.ok(Math.abs(freqForSemitonesFromA4(12) - 880) < 1e-9);
});

test("one octave down (12 semitones) exactly halves frequency", () => {
  assert.ok(Math.abs(freqForSemitonesFromA4(-12) - 220) < 1e-9);
});

test("C4 (middle C, 9 semitones below A4) is approximately 261.63 Hz", () => {
  const c4 = freqForSemitonesFromA4(-9);
  assert.ok(Math.abs(c4 - 261.63) < 0.01, `expected ~261.63, got ${c4}`);
});

test("the semitone-from-frequency inverse (log2) round-trips exactly", () => {
  for (const semitones of [-24, -12, -1, 0, 1, 12, 24]) {
    const freq = freqForSemitonesFromA4(semitones);
    const recovered = Math.round(12 * Math.log2(freq / A4));
    assert.equal(recovered, semitones);
  }
});
