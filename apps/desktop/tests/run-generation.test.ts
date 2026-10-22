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
    expect(app).toContain("if ((runGen.current.get(sid) ?? 0) === myGen) runningSet.current.delete(keyOf(sid));");
  });

  it("停止态写入同样按代际守卫（旧 run 的 aborted 不能改新 run 的 stopped）", () => {
    expect(app).toContain("if ((runGen.current.get(sid) ?? 0) === myGen) {\n          setStoppedIds");
  });
});
