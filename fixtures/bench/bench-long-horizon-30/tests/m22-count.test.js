import test from "node:test";
import assert from "node:assert/strict";
import { count } from "../src/m22-count.js";
test("count：数出现次数", () => {
  assert.equal(count([1,2,1,1],1), 3)
  assert.equal(count([1,2],9), 0)
});
