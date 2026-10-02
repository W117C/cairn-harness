import test from "node:test";
import assert from "node:assert/strict";
import { uniqsorted } from "../src/m30-uniqsorted.js";
test("uniqsorted：去重且升序", () => {
  assert.deepEqual(uniqsorted([10,2,2,1]), [1,2,10])
});
