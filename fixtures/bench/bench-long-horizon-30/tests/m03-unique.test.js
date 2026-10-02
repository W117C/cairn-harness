import test from "node:test";
import assert from "node:assert/strict";
import { unique } from "../src/m03-unique.js";

test("unique：去重且**保持首次出现顺序**", () => {
  assert.deepEqual(unique([3,1,3,2]), [3,1,2]);
});
