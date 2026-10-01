import test from "node:test";
import assert from "node:assert/strict";
import { toCsv } from "../src/export.js";

test("普通字段直接用逗号连", () => {
  assert.equal(toCsv([["a", "b"], ["c", "d"]]), "a,b\nc,d");
});
// 待实现：RFC 4180 转义
test("含逗号的字段要用双引号包住", () => {
  assert.equal(toCsv([["a,b", "c"]]), '"a,b",c');
});
test("含双引号的字段：包起来并把内部引号写成两个", () => {
  assert.equal(toCsv([['he said "hi"', "x"]]), '"he said ""hi""",x');
});
test("含换行的字段要包起来", () => {
  assert.equal(toCsv([["line1\nline2", "x"]]), '"line1\nline2",x');
});
