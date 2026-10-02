import test from "node:test";
import assert from "node:assert/strict";
import { capfirst } from "../src/m25-capfirst.js";
test("capfirst：只首字母大写", () => {
  assert.equal(capfirst("hello World"), "Hello World")
});
