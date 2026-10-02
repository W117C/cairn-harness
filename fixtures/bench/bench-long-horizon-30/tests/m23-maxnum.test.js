import test from "node:test";
import assert from "node:assert/strict";
import { maxnum } from "../src/m23-maxnum.js";
test("maxnum：数值最大值（不是字典序）", () => {
  assert.equal(maxnum([9, 100, 20]), 100)
  assert.throws(() => maxnum([]))
});
