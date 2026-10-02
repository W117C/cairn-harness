import test from "node:test";
import assert from "node:assert/strict";
import { range } from "../src/m29-range.js";
test("range：闭区间 [a,b]", () => {
  assert.deepEqual(range(2,5), [2,3,4,5])
});
