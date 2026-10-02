import test from "node:test";
import assert from "node:assert/strict";
import { sumdigits } from "../src/m28-sumdigits.js";
test("sumdigits：各位相加", () => {
  assert.equal(sumdigits(1234), 10)
  assert.equal(sumdigits(0), 0)
});
