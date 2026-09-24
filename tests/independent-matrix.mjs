import assert from "node:assert/strict";
import { independentFixtures } from "./independent-fixtures.mjs";
import { sanitizeScenario } from "../worker/index.js";

const ids = new Set();
const pairs = new Map();
for (const fixture of independentFixtures) {
  assert.match(fixture.id, /^[a-z0-9-]+$/u);
  assert.ok(!ids.has(fixture.id), `duplicate id: ${fixture.id}`);
  ids.add(fixture.id);
  assert.equal(typeof fixture.passed, "boolean");
  if (fixture.verdict) assert.ok(["passed","almost","off"].includes(fixture.verdict));
  if (fixture.coachingNeed) assert.equal(fixture.coachingNeed,"content-before-ask");
  if (fixture.judgment) assert.ok(["aligned","misread","uncertain"].includes(fixture.judgment));
  assert.ok(typeof fixture.script === "string" && fixture.script.length >= 15);
  assert.ok(sanitizeScenario(fixture.scenario), `${fixture.id}: invalid or empty scenario`);
  const members = pairs.get(fixture.pair) || [];
  members.push(fixture);
  pairs.set(fixture.pair, members);
}

for (const [pair, members] of pairs) {
  assert.equal(members.length, 2, `${pair}: expected exactly two counterfactuals`);
  assert.deepEqual(new Set(members.map(item => item.passed)), new Set([true, false]),
    `${pair}: require a pass and a non-pass`);
}

assert.ok(pairs.size >= 8, "keep multiple independent failure mechanisms in the matrix");
console.log(`PASS independent matrix: ${independentFixtures.length} scripts, ${pairs.size} contrasting pairs`);
