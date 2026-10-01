import test from "node:test";
import assert from "node:assert/strict";
import { sum } from "../src/m02-sum.js";

test("sum：求和（含第一个元素）", () => {
  assert.equal(sum([1,2,3]), 6)
  assert.equal(sum([]), 0);
});
