import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "../src/m13-escapeHtml.js";

test("escapeHtml：转义 & < > 三个字符", () => {
  assert.equal(escapeHtml("a&b<c>d"), "a&amp;b&lt;c&gt;d");
});
