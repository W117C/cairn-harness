import test from "node:test";
import assert from "node:assert/strict";
import { listPage } from "../src/api.js";

test("listPage 每页满员", () => {
  assert.deepEqual(listPage(0, 4), [1, 2, 3, 4]);
});
test("listPage 末页余数正确", () => {
  assert.deepEqual(listPage(1, 4), [5, 6, 7]);
});
