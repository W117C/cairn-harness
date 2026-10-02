import test from "node:test";
import assert from "node:assert/strict";
import { trimAll } from "../src/m12-trimAll.js";

test("trimAll：**每一条**都去掉首尾空白", () => {
  assert.deepEqual(trimAll([" a ", " b "]), ["a","b"]);
});
