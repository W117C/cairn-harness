import test from "node:test";
import assert from "node:assert/strict";
import { drain } from "../src/queue.js";

const slow = (n) => new Promise((r) => setTimeout(() => r(n), 5));

test("drain 等所有异步任务完成后才返回", async () => {
  const jobs = [1, 2, 3, 4];
  assert.deepEqual(await drain(jobs, slow), [1, 2, 3, 4]);
});
test("drain 保持提交顺序", async () => {
  const jobs = [3, 1, 2];
  assert.deepEqual(await drain(jobs, slow), [3, 1, 2]);
});
