import test from "node:test";
import assert from "node:assert/strict";
import { palindrome } from "../src/m27-palindrome.js";
test("palindrome：忽略大小写与空格", () => {
  assert.equal(palindrome("A man a plan"), false)
  assert.equal(palindrome("Never odd or even"), true)
  assert.equal(palindrome("AbA"), true)
});
