import { test, assert } from "./helpers.js";
import { balanceAnswerPositions } from "../src/quiz.js";

test("quiz: answers are spread across all positions, not always option 1", () => {
  const qs = Array.from({ length: 40 }, (_, i) => ({ prompt: "q" + i, options: ["right" + i, "a", "b", "c"], answer: "right" + i }));
  const out = balanceAnswerPositions(qs);
  const counts = [0, 0, 0, 0];
  for (const q of out) { const i = q.options.indexOf(q.answer); assert.ok(i >= 0); assert.equal(new Set(q.options).size, 4); counts[i]++; }
  for (const c of counts) assert.ok(c >= 8 && c <= 12, "spread " + counts);
});
test("quiz: options are preserved and short/odd questions are safe", () => {
  const out = balanceAnswerPositions([{ prompt: "tf", options: ["True", "False"], answer: "True" }, { prompt: "x", options: ["a"], answer: "a" }, { prompt: "bad", options: ["a", "b"], answer: "zzz" }]);
  assert.deepEqual(out[0].options.slice().sort(), ["False", "True"]);
  assert.deepEqual(out[1].options, ["a"]);
  assert.equal(out[2].answer, "zzz");
});
