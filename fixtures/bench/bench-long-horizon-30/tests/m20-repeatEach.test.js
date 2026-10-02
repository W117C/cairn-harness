import test from "node:test";
import assert from "node:assert/strict";
import { repeatEach } from "../src/m20-repeatEach.js";

test("repeatEach：每个元素重复 n 次", () => {
  assert.deepEqual(repeatEach(["a","b"], 2), ["a","a","b","b"]);
});
