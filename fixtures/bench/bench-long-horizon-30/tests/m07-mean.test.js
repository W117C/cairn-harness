import test from "node:test";
import assert from "node:assert/strict";
import { mean } from "../src/m07-mean.js";

test("mean：平均值（除以个数）", () => {
  assert.equal(mean([2,4,6]), 4);
});
