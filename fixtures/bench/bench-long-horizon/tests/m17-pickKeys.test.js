import test from "node:test";
import assert from "node:assert/strict";
import { pickKeys } from "../src/m17-pickKeys.js";

test("pickKeys：挑出**指定**的键（当前挑反了）", () => {
  assert.deepEqual(pickKeys({a:1,b:2,c:3}, ["a","c"]), {a:1,c:3});
});
