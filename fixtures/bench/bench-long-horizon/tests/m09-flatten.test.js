import test from "node:test";
import assert from "node:assert/strict";
import { flatten } from "../src/m09-flatten.js";

test("flatten：**递归**展平到最深层", () => {
  assert.deepEqual(flatten([1,[2,[3,[4]]]]), [1,2,3,4]);
});
