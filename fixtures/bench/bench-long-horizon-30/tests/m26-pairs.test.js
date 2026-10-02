import test from "node:test";
import assert from "node:assert/strict";
import { pairs } from "../src/m26-pairs.js";
test("pairs：两两配对", () => {
  assert.deepEqual(pairs([1,2,3,4,5]), [[1,2],[3,4]])
});
