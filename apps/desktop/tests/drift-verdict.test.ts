// 漂移判据：稳定基线保留自身增长；不稳基线不能吸收未经确认的文件修改。
import { describe, expect, it } from "vitest";
import { decideDrift, type DriftSnapshot } from "../src/main/kernel-host";

const snap = (over: Partial<DriftSnapshot> = {}): DriftSnapshot => ({
  size: 100, mtimeMs: 5, lines: 10, ownAtSnapshot: 10, ...over,
});

describe("漂移判据（decideDrift）", () => {
  it("基线不稳时，本端尾随写不能掩盖同时发生的外部追加", () => {
    const v = decideDrift({
      baseline: snap({ unstable: true }),
      current: { size: 200, mtimeMs: 9 },
      ownSinceSnapshot: 1,
      currentLines: 12,
    });
    expect(v.kind).toBe("reject");
  });

  it("基线不稳 + 本端零增长 + 文件变了 ⇒ fail-closed 拒绝", () => {
    const v = decideDrift({
      baseline: snap({ unstable: true }),
      current: { size: 200, mtimeMs: 9 },
      ownSinceSnapshot: 0,
      currentLines: 20,
    });
    expect(v.kind).toBe("reject");
  });

  it("基线不稳 + 本端有增长 ⇒ 仍拒绝，等待显式刷新", () => {
    const v = decideDrift({
      baseline: snap({ unstable: true }),
      current: { size: 200, mtimeMs: 9 },
      ownSinceSnapshot: 1,
      currentLines: 20,
    });
    expect(v.kind).toBe("reject");
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
    expect(decideDrift({ ...input, ownSinceSnapshot: 1, baseline: snap({ unstable: true }) }).kind).toBe("reject");
    expect(decideDrift({ ...input, ownSinceSnapshot: 10, baseline: snap() }).kind).toBe("allow");
  });
});
