import test from "node:test";
import assert from "node:assert/strict";
import { last } from "../src/m21-last.js";
test("last：取最后一个；空数组 undefined", () => {
  assert.equal(last([1,2,3]), 3)
  assert.equal(last([]), undefined)
});
