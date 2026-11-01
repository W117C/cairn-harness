// 运行代际（2026-10-18 真机）：打断并发送后，队列里那条会立刻开新 run；旧 run 的 finally
// 若无条件 runningSet.delete，会把新 run 刚置上的旗摘掉——界面上“新 run 在跑、running=false”，
// 停止键消失、状态错位。修法：每轮领一个代际号，清理/停止态写入只在号还是自己的时生效。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const app = readAppSurface();

describe("run 代际守卫", () => {
  it("起跑领代际号；finally 只在号未变时摘旗", () => {
    expect(app).toContain("const myGen = (runGen.current.get(sid) ?? 0) + 1;");
    expect(app).toContain("runGen.current.set(sid, myGen);");
    expect(app).toContain("if ((runGen.current.get(sid) ?? 0) === myGen) runningSet.current.delete(key);");
  });

  it("停止态写入同样按代际守卫（旧 run 的 aborted 不能改新 run 的 stopped）", () => {
    // 第 919 页：这条哨兵原来钉的是带缩进的原文（`{` + 换行 + 十个空格 + `setStoppedIds`）。
    // 第 4 轮把这段守卫搬进 `drainQueue(initial, async (msg) => {…})` 的回调里，缩进多一层就红了，
    // 而「号还是自己的才写 stopped」一字没变。改成按**词序**判：空白随缩进走，守卫条件、
    // 函数式更新与 `res.aborted` 的语义仍在同一块里。
    expect(app).toMatch(/if \(\(runGen\.current\.get\(sid\) \?\? 0\) === myGen\) \{\s*setStoppedIds\(\(prev\) => \{/);
    expect(app).toContain("const want = res.aborted === true;");
  });

  it("起点删除同样按代际守卫（旧 run 收尾不能删掉新 run 的起点）", () => {
    expect(app).toContain("if ((runGen.current.get(sid) ?? 0) === myGen) runStartBySession.current.delete(sid);");
  });
});
