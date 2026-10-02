import test from "node:test";
import assert from "node:assert/strict";
import { revwords } from "../src/m24-revwords.js";

test("revwords：词序倒置，词内字母不动", () => {
  assert.equal(revwords("ab cd"), "cd ab")
  assert.equal(revwords("one two three"), "three two one")
});
