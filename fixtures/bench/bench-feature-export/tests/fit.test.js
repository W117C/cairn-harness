import test from "node:test";
import assert from "node:assert/strict";
import { wrap, joinFitted } from "../src/fit.js";

test("wrap 在空格处断行", () => {
  assert.deepEqual(wrap("aa bb cc", 5), ["aa bb", "cc"]);
});

test("wrap 不拆长词", () => {
  assert.deepEqual(wrap("aaaaaaa b", 3), ["aaaaaaa", "b"]);
});

// 待实现：joinFitted 把多段文本各自折行后用换行拼起来。
// 段与段之间空一行；每段内部用 wrap 的规则；空段保留为一个空行。
test("joinFitted 多段折行并用空行分隔", () => {
  assert.equal(joinFitted(["aa bb cc", "dd"], 5), "aa bb\ncc\n\ndd");
});

test("joinFitted 空段保留空行", () => {
  assert.equal(joinFitted(["aa", "", "bb"], 5), "aa\n\n\nbb");
});
