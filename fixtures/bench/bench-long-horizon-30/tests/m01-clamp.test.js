import test from "node:test";
import assert from "node:assert/strict";
import { clamp } from "../src/m01-clamp.js";

test("clamp：把 v 夹在 [lo, hi] 之间", () => {
  assert.equal(clamp(5, 1, 3), 3)
  assert.equal(clamp(0, 1, 3), 1)
  assert.equal(clamp(2, 1, 3), 2);
});
