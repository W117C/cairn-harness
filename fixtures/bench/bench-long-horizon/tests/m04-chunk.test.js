import test from "node:test";
import assert from "node:assert/strict";
import { chunk } from "../src/m04-chunk.js";

test("chunk：按 size 切块，**末块不足也保留**", () => {
  assert.deepEqual(chunk([1,2,3,4,5], 2), [[1,2],[3,4],[5]]);
});
