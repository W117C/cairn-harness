import test from "node:test";
import assert from "node:assert/strict";
import { lastN } from "../src/m19-lastN.js";

test("lastN：取**最后** n 个", () => {
  assert.deepEqual(lastN([1,2,3,4,5], 2), [4,5]);
});
