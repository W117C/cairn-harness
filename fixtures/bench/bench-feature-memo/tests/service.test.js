import test from "node:test";
import assert from "node:assert/strict";
import { loadCount, resetCount } from "../src/loader.js";
import { getUser, resetCache } from "../src/service.js";

test("同一个 id 只真取一次", async () => {
  resetCache(); resetCount();
  const a = await getUser(7);
  const b = await getUser(7);
  assert.deepEqual(a, b);
  assert.equal(loadCount(), 1, "第二次应当命中缓存");
});
test("不同 id 各自真取", async () => {
  resetCache(); resetCount();
  await getUser(1);
  await getUser(2);
  assert.equal(loadCount(), 2);
});
test("resetCache 之后会重新取", async () => {
  resetCache(); resetCount();
  await getUser(3);
  resetCache();
  await getUser(3);
  assert.equal(loadCount(), 2);
});
