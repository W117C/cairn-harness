import test from "node:test";
import assert from "node:assert/strict";
import { total } from "../src/worker.js";

test("total 累加异步结果", async () => {
  const r = await total([1, 2, 3], (n) => Promise.resolve(n * 10));
  assert.equal(r, 60);
});
