// 漂移判据（2026-10-19 独立评审追出的真缺陷：会话被**永久卡死** + 没有证据的指控）。
//
// 缺陷形状：基线不稳（unstable，只在我们自己测不准时出现——多半是 worker 尾随写）时，
// `externalDrift` 直接 `return true`（拒绝），而拒绝发生在 refreshSnapshot **之前**
// ⇒ 基线永远不重建 ⇒ 每一轮 run 都撞同一句"会话已被外部修改（CLI？），请刷新后重试"
// ⇒ 会话**永久不可用**，连它自己给的那条出路（刷新后重试）都走不通
// （只有切走再切回、让 openSession 重建基线才恢复）。
//
// 而且那句话是**指控**：实测 20MB 会话日志、本端无人写、文件逐字未动 —— 没有任何外部改动的证据。
// "测不准"被读成"别人改了"，这是本仓反复判死的那个方向。
//
// 修法：基线不稳 ⇒ **重建基线后放行**（让这一轮从当前真相起跑），不指控、不卡死。
// 卡死比"这一轮测不出漂移"坏得多：卡死让会话彻底不可用，而尾随写是我们自己的。
//
// 判据落在**纯函数**上（decideDrift）：本仓无 jsdom，交互逻辑走「纯函数 + 接线见证」两面。
// 纯函数能真跑 ⇒ 这一条不是恒真的源码断言。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decideDrift, type DriftSnapshot } from "../src/main/kernel-host";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const snap = (over: Partial<DriftSnapshot> = {}): DriftSnapshot => ({
  size: 100, mtimeMs: 5, lines: 10, ownAtSnapshot: 10, ...over,
});

describe("漂移判据（decideDrift）", () => {
  it("基线不稳 + 本端零增长 + 文件变了 ⇒ fail-closed 拒绝", () => {
    const v = decideDrift({
      baseline: snap({ unstable: true }),
      current: { size: 200, mtimeMs: 9 },
      ownSinceSnapshot: 0,
      currentLines: 20,
    });
    expect(v.kind).toBe("reject");
  });

  it("基线不稳 + 本端有增长 ⇒ 重建后放行，不把自身尾随写误判成外部修改", () => {
    const v = decideDrift({
      baseline: snap({ unstable: true }),
      current: { size: 200, mtimeMs: 9 },
      ownSinceSnapshot: 1,
      currentLines: 20,
    });
    expect(v.kind).toBe("rebuild");
  });

  it("基线不稳 + 文件逐字未动 ⇒ 放行（快路径排在不稳之前）", () => {
    const v = decideDrift({
      baseline: snap({ unstable: true }),
      current: { size: 100, mtimeMs: 5 },
      ownSinceSnapshot: 0,
      currentLines: 10,
    });
    expect(v.kind).toBe("allow");
  });

  it("基线稳 + 外部追加（行数对不上）⇒ 拒绝（真外部改动仍拦得住，回归锁）", () => {
    const v = decideDrift({
      baseline: snap(),
      current: { size: 200, mtimeMs: 9 },
      ownSinceSnapshot: 0,
      currentLines: 20,
    });
    expect(v.kind).toBe("reject");
  });

  it("基线稳 + 增长全来自本端 ⇒ 放行（自身增长不是外部改动）", () => {
    const v = decideDrift({
      baseline: snap(),
      current: { size: 200, mtimeMs: 9 },
      ownSinceSnapshot: 5,
      currentLines: 15, // snap.lines(10) + own(5)
    });
    expect(v.kind).toBe("allow");
  });

  it("无基线（首场 run）⇒ 放行", () => {
    const v = decideDrift({ baseline: undefined, current: { size: 1, mtimeMs: 1 }, ownSinceSnapshot: 0, currentLines: 1 });
    expect(v.kind).toBe("allow");
  });

  it("快照在场而文件消失 ⇒ 拒绝（外部删除）", () => {
    const v = decideDrift({ baseline: snap(), current: null, ownSinceSnapshot: 0, currentLines: null });
    expect(v.kind).toBe("reject");
  });

  it("反向对照：判据不是恒真（同一组输入换个基线就换个结论）", () => {
    const input = { current: { size: 200, mtimeMs: 9 }, ownSinceSnapshot: 0, currentLines: 20 };
    expect(decideDrift({ ...input, baseline: snap() }).kind).toBe("reject");
    expect(decideDrift({ ...input, baseline: snap({ unstable: true }) }).kind).toBe("reject");
    expect(decideDrift({ ...input, ownSinceSnapshot: 1, baseline: snap({ unstable: true }) }).kind).toBe("rebuild");
  });
});

describe("接线：externalDrift 走这一个判据，rebuild 分支真的重建基线", () => {
  const src = read("../src/main/kernel-host.ts");

  it("externalDrift 调 decideDrift（判据不许在两处各写一份）", () => {
    expect(src).toContain("const verdict = decideDrift({");
    expect(src).toContain('if (verdict.kind === "allow")');
    expect(src).toContain('if (verdict.kind === "rebuild")');
  });

  it("rebuild 分支真的调 refreshSnapshot（不重建 = 只是把拒绝换了个说法）", () => {
    const i = src.indexOf('if (verdict.kind === "rebuild")');
    const fn = src.slice(i, i + 900);
    expect(fn).toContain("await refreshSnapshot(sessionId, logPath);");
    expect(fn).toContain("return false;"); // 放行，不是拒绝
  });

  it("旧的「不稳即拒绝」不许回来", () => {
    expect(src).not.toContain("if (snap.unstable === true) return true;");
  });
});
