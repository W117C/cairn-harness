import test from "node:test";
import assert from "node:assert/strict";
import { splitLines } from "../src/m14-splitLines.js";

test("splitLines：按 \n / \r\n 切行，**去掉空尾行**", () => {
  assert.deepEqual(splitLines("a\r\nb\n"), ["a","b"]);
});
