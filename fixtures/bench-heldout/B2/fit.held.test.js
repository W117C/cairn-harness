// held-out（隐藏验收）——B2 textfit。
// 与 B1 同一套纪律：这份文件不在靶子里，模型看不见，跑完才装进副本。
// 为什么这条任务需要它：可见测试只给了两个宽度 5 的例子，
// 照着那两个例子「拼字符串」能通过，但**规格**（每段各自走 wrap、段间空一行、空段占一个空行）
// 要在别的宽度、别的段数、空段在头/在尾这些形状上才量得出来。
// 期望值全部按 README + 行数组口径手算：段与段之间插一个空行，空段自己不产出行。
import test from "node:test";
import assert from "node:assert/strict";
import { joinFitted } from "../src/fit.js";

test("宽度换成 3：每段真的按 wrap 的规则折", () => {
  assert.equal(joinFitted(["aa bb cc", "dd"], 3), "aa\nbb\ncc\n\ndd");
});

test("折行边界：正好装满一行不再塞下一个词", () => {
  // hello(5) | world this(10) | is a test(9)
  assert.equal(joinFitted(["hello world this is a test"], 10), "hello\nworld this\nis a test");
});

test("零段：空字符串，不许留下分隔符", () => {
  assert.equal(joinFitted([], 5), "");
});

test("单空段：只有一个空行位，结果为空字符串", () => {
  assert.equal(joinFitted([""], 5), "");
});

test("空段在开头：前面不留分隔空行，段间的空行照给", () => {
  // 段1 空（不产行）+ 空行 + 段2 "x" ⇒ "\nx"
  assert.equal(joinFitted(["", "x"], 5), "\nx");
});

test("空段在结尾：保留一个空行 ⇒ 以换行收尾", () => {
  assert.equal(joinFitted(["x", ""], 5), "x\n");
});

test("三段混合：长段折行 + 空段 + 短段", () => {
  assert.equal(joinFitted(["aa bb cc", "", "dd"], 5), "aa bb\ncc\n\n\ndd");
});
