import { test, assert } from "./helpers.js";
import { parseMidiFile } from "../src/sound.js";

// Builds a minimal, real Standard MIDI File (format 0, 1 track) with a
// tempo meta event and a sequence of note-on/note-off pairs — used to
// verify the parser against files we constructed by hand from the real
// SMF spec, not against itself.
function varLen(value) {
  let buffer = value & 0x7f;
  while ((value >>= 7)) buffer = (buffer << 8) | ((value & 0x7f) | 0x80);
  const bytes = [];
  while (true) { bytes.push(buffer & 0xff); if (buffer & 0x80) buffer >>= 8; else break; }
  return bytes;
}

function buildMidi({ ticksPerQuarter = 480, usPerQuarter = 500000, notes }) {
  const events = [0, 0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff];
  for (const n of notes) {
    events.push(...varLen(n.onDelta), 0x90, n.note, n.velocity ?? 100);
    events.push(...varLen(n.durationTicks), 0x80, n.note, 0);
  }
  events.push(0, 0xff, 0x2f, 0x00);
  const trackLen = events.length;
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ticksPerQuarter >> 8) & 0xff, ticksPerQuarter & 0xff];
  const track = [0x4d, 0x54, 0x72, 0x6b, (trackLen >> 24) & 0xff, (trackLen >> 16) & 0xff, (trackLen >> 8) & 0xff, trackLen & 0xff, ...events];
  return new Uint8Array([...header, ...track]).buffer;
}

test("parses a simple 3-note sequence with correct pitches and timing at 120bpm", () => {
  // onDelta is relative to the PRECEDING event in the track (the previous
  // note's note-off, once a note has already played) — 0 here means each
  // note starts immediately after the previous one ends, back-to-back.
  const buffer = buildMidi({ ticksPerQuarter: 480, usPerQuarter: 500000, notes: [
    { note: 60, onDelta: 0, durationTicks: 480 },
    { note: 64, onDelta: 0, durationTicks: 480 },
    { note: 67, onDelta: 0, durationTicks: 480 },
  ] });
  const { notes, durationSec } = parseMidiFile(buffer);
  assert.equal(notes.length, 3);
  assert.deepEqual(notes.map((n) => n.note), [60, 64, 67]);
  // 480 ticks at 480 ticks/quarter, 500000us/quarter (120bpm) = exactly 0.5s per note
  assert.ok(Math.abs(notes[0].startSec - 0) < 1e-6);
  assert.ok(Math.abs(notes[0].endSec - 0.5) < 1e-6);
  assert.ok(Math.abs(notes[1].startSec - 0.5) < 1e-6);
  assert.ok(Math.abs(notes[2].startSec - 1.0) < 1e-6);
  assert.ok(Math.abs(durationSec - 1.5) < 1e-6);
});

test("respects a real tempo other than the 120bpm default", () => {
  // 240bpm = 250000 us/quarter -> half the duration of the 120bpm case
  const buffer = buildMidi({ ticksPerQuarter: 480, usPerQuarter: 250000, notes: [
    { note: 60, onDelta: 0, durationTicks: 480 },
  ] });
  const { notes } = parseMidiFile(buffer);
  assert.ok(Math.abs(notes[0].endSec - 0.25) < 1e-6, `expected 0.25s at 240bpm, got ${notes[0].endSec}`);
});

test("preserves real note velocity (loudness)", () => {
  const buffer = buildMidi({ notes: [{ note: 60, onDelta: 0, durationTicks: 240, velocity: 42 }] });
  const { notes } = parseMidiFile(buffer);
  assert.equal(notes[0].velocity, 42);
});

test("rejects a file with no MThd header", () => {
  assert.throws(() => parseMidiFile(new Uint8Array([1, 2, 3, 4]).buffer), /Not a standard MIDI file/);
});

test("rejects SMPTE-based timing (only ticks-per-quarter is supported)", () => {
  const buffer = buildMidi({ notes: [{ note: 60, onDelta: 0, durationTicks: 240 }] });
  const bytes = new Uint8Array(buffer);
  bytes[12] |= 0x80; // set the SMPTE flag bit on the division field
  assert.throws(() => parseMidiFile(bytes.buffer), /SMPTE/);
});

function rawMidi(events, ticksPerQuarter = 480) {
  const trackLen = events.length;
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ticksPerQuarter >> 8) & 0xff, ticksPerQuarter & 0xff];
  const track = [0x4d, 0x54, 0x72, 0x6b, (trackLen >> 24) & 0xff, (trackLen >> 16) & 0xff, (trackLen >> 8) & 0xff, trackLen & 0xff, ...events];
  return new Uint8Array([...header, ...track]).buffer;
}

test("same note on two channels is tracked independently", () => {
  const { notes } = parseMidiFile(rawMidi([
    0, 0x90, 60, 100, 0, 0x91, 60, 100, // ch0 and ch1 both start note 60
    0x83, 0x60, 0x80, 60, 0, // (delta 480) ch0 off
    0x83, 0x60, 0x81, 60, 0, // (delta 480) ch1 off
    0, 0xff, 0x2f, 0,
  ]));
  assert.equal(notes.length, 2);
  const ends = notes.map((n) => n.endSec).sort();
  assert.ok(Math.abs(ends[0] - 0.5) < 1e-9 && Math.abs(ends[1] - 1.0) < 1e-9);
});

test("meta events cancel running status (no misparse of following data bytes)", () => {
  // note on (status 0x90), meta event, then a full new status note off.
  const { notes } = parseMidiFile(rawMidi([
    0, 0x90, 60, 100,
    0x83, 0x60, 0xff, 0x01, 0x01, 0x41, // text meta after 480 ticks
    0, 0x80, 60, 0,
    0, 0xff, 0x2f, 0,
  ]));
  assert.equal(notes.length, 1);
  assert.ok(Math.abs(notes[0].endSec - 0.5) < 1e-9);
});
