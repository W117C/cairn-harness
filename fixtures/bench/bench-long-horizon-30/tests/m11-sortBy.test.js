import test from "node:test";
import assert from "node:assert/strict";
import { sortBy } from "../src/m11-sortBy.js";

test("sortBy：按**数值**升序（不是字符串序）", () => {
  assert.deepEqual(sortBy([10,9,100], (n) => n), [9,10,100]);
});
