import { test, assert } from "./helpers.js";
import { addDays, conceptForDate, conceptIndexForDate, dayDiff, displayStreak, emptyState, markMilestoneShown, milestoneMessage, normalizeState, recordVisit, toDateKey, weekView } from "../src/dailyLogic.js";
import { CONCEPTS } from "../src/dailyConcepts.js";
import { ANIM_KINDS, animMeta } from "../src/dailyAnim.js";

const run = (days, s = emptyState()) => days.reduce((st, d) => recordVisit(st, d), s);
const seq = (start, n) => Array.from({ length: n }, (_, i) => addDays(start, i));

test("first visit starts a streak of 1", () => {
  const s = recordVisit(emptyState(), "2025-03-01");
  assert.equal(s.current, 1); assert.equal(s.best, 1); assert.equal(s.total, 1); assert.equal(s.last, "2025-03-01");
});
test("same day twice changes nothing", () => {
  const a = recordVisit(emptyState(), "2025-03-01");
  assert.deepEqual(recordVisit(a, "2025-03-01"), a);
});
test("consecutive days continue the streak", () => {
  const s = run(seq("2025-03-01", 5));
  assert.equal(s.current, 5); assert.equal(s.best, 5); assert.equal(s.total, 5);
});
test("a gap of 2+ days resets the streak but keeps best", () => {
  const s = run([...seq("2025-03-01", 4), "2025-03-08"]);
  assert.equal(s.current, 1); assert.equal(s.best, 4); assert.equal(s.total, 5);
});
test("freeze earned at 7 days, max 2", () => {
  assert.equal(run(seq("2025-03-01", 7)).freezes, 1);
  assert.equal(run(seq("2025-03-01", 14)).freezes, 2);
  assert.equal(run(seq("2025-03-01", 21)).freezes, 2);
});
test("a freeze covers exactly one missed day", () => {
  let s = run(seq("2025-03-01", 7)); // last 03-07, 1 freeze
  s = recordVisit(s, "2025-03-09"); // missed 03-08
  assert.equal(s.current, 8); assert.equal(s.freezes, 0); assert.deepEqual(s.covered, ["2025-03-08"]);
  s = recordVisit(s, "2025-03-12"); // two missed days, no freeze
  assert.equal(s.current, 1);
});
test("a freeze does not cover two missed days", () => {
  const s = recordVisit(run(seq("2025-03-01", 7)), "2025-03-10");
  assert.equal(s.current, 1); assert.equal(s.freezes, 1);
});
test("DST and year boundaries count calendar days", () => {
  assert.equal(dayDiff("2025-03-08", "2025-03-09"), 1); // US spring forward
  assert.equal(dayDiff("2025-11-01", "2025-11-02"), 1); // US fall back
  assert.equal(dayDiff("2024-02-28", "2024-03-01"), 2); // leap year
  const s = run(["2025-03-08", "2025-03-09", "2025-03-10", "2025-12-31", "2026-01-01"]);
  assert.equal(s.current, 2);
  assert.equal(addDays("2025-12-31", 1), "2026-01-01");
});
test("toDateKey uses the local calendar day, not UTC", () => {
  assert.equal(toDateKey(new Date(2025, 5, 15, 23, 59)), "2025-06-15");
  assert.equal(toDateKey(new Date(2025, 5, 15, 0, 1)), "2025-06-15");
  assert.equal(toDateKey(new Date("nope")), null);
});
test("clock going backwards never resets or inflates", () => {
  const a = run(seq("2025-03-01", 5));
  const b = recordVisit(a, "2025-02-20");
  assert.deepEqual(b, a);
  assert.equal(recordVisit(b, "2025-03-06").current, 6);
});
test("displayStreak shows a lapsed streak as 0", () => {
  const s = run(seq("2025-03-01", 3));
  assert.equal(displayStreak(s, "2025-03-04"), 3);
  assert.equal(displayStreak(s, "2025-03-05"), 0);
  assert.equal(displayStreak(run(seq("2025-03-01", 7)), "2025-03-09"), 7);
});
test("corrupt state is normalised safely", () => {
  assert.deepEqual(normalizeState("junk"), emptyState());
  const s = normalizeState({ current: -3, best: "x", freezes: 99, last: "2025-13-45", days: ["bad", "2025-01-01"] });
  assert.equal(s.freezes, 2); assert.equal(s.last, null); assert.deepEqual(s.days, ["2025-01-01"]);
  assert.equal(recordVisit({ bogus: true }, "2025-01-01").current, 1);
});
test("milestones fire once at 3, 7, 30, 100", () => {
  let s = run(seq("2025-03-01", 3));
  assert.ok(milestoneMessage(s));
  s = markMilestoneShown(s); assert.equal(milestoneMessage(s), null);
  assert.equal(milestoneMessage(run(seq("2025-03-01", 4))), null);
  for (const n of [7, 30, 100]) assert.ok(milestoneMessage(run(seq("2025-01-01", n))));
});
test("weekView marks visits, covered days and today", () => {
  let s = run(seq("2025-03-01", 7)); s = recordVisit(s, "2025-03-09");
  const w = weekView(s, "2025-03-09");
  assert.equal(w.length, 7); assert.equal(w[6].today, true); assert.equal(w[6].visited, true);
  assert.equal(w[5].covered, true); assert.equal(w[5].visited, false);
});

test("concept choice is deterministic per day", () => {
  assert.equal(conceptForDate("2025-06-01", CONCEPTS).id, conceptForDate(new Date(2025, 5, 1, 17), CONCEPTS).id);
});
test("concepts cycle with no repeats until exhausted, and across cycle boundaries", () => {
  const n = CONCEPTS.length;
  for (const start of [addDays("1970-01-01", n * 20), addDays("1970-01-01", n * 21)]) {
    const ids = seq(start, n).map((d) => conceptForDate(d, CONCEPTS).id);
    assert.equal(new Set(ids).size, n);
  }
  let prev = null;
  for (const d of seq("2025-01-01", n * 4)) { const id = conceptForDate(d, CONCEPTS).id; assert.notEqual(id, prev); prev = id; }
  assert.equal(conceptForDate("2025-01-01", []), null);
  assert.ok(conceptIndexForDate("1969-12-31", 5) >= 0);
});

test("concept list is valid", () => {
  const modes = ["physics", "chemistry", "astronomy", "history", "cybersecurity", "mathematics", "economics", "zoology", "sound", "sustainability", "whiteboard", "war", "genetics"];
  assert.ok(CONCEPTS.length >= 60);
  assert.equal(new Set(CONCEPTS.map((c) => c.id)).size, CONCEPTS.length);
  const subjects = new Set(CONCEPTS.map((c) => c.subject));
  for (const s of ["Physics", "Chemistry", "Astronomy", "History of Science", "Cybersecurity", "Mathematics", "Economics", "Zoology", "Genetics", "Sound", "Sustainability"]) assert.ok(subjects.has(s), s);
  for (const c of CONCEPTS) {
    assert.ok(c.title.length > 2, c.id);
    assert.ok(c.blurb.length > 40 && c.whyItMatters.length > 10, c.id);
    assert.ok(ANIM_KINDS.includes(c.anim.kind), `${c.id} kind ${c.anim.kind}`);
    assert.ok(modes.includes(c.tryIt.mode), `${c.id} mode`);
    assert.ok(c.tryIt.label.startsWith("Try it in "), c.id);
    const m = animMeta(c.anim); assert.equal(m.captions.length, 3, c.id);
    m.captions.forEach((cap, i) => assert.ok(cap.startsWith(`${i + 1}. `), `${c.id} caption ${i}`));
  }
  for (const k of ANIM_KINDS) assert.ok(CONCEPTS.some((c) => c.anim.kind === k), `unused kind ${k}`);
});
