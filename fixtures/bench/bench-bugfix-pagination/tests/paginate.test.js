import test from "node:test";
import assert from "node:assert/strict";
import { page } from "../src/paginate.js";

test("第一页取满 size 条", () => {
  assert.deepEqual(page([1, 2, 3, 4, 5], 0, 3), [1, 2, 3]);
});
test("第二页取剩下的", () => {
  assert.deepEqual(page([1, 2, 3, 4, 5], 1, 3), [4, 5]);
});
test("越界页返回空", () => {
  assert.deepEqual(page([1, 2, 3], 9, 3), []);
});
