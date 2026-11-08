// 漂移判据：稳定基线保留自身增长；不稳基线不能吸收未经确认的文件修改。
import { describe, expect, it } from "vitest";
import { checkSessionDrift, decideDrift, type DriftSnapshot } from "../src/main/kernel-host";

const snap = (over: Partial<DriftSnapshot> = {}): DriftSnapshot => ({
  size: 100, mtimeMs: 5, lines: 10, ownAtSnapshot: 10, ...over,
});

describe("run 前漂移采样", () => {
  it("stat 未变时保留原基线，不把较新的行数和计数拼进旧 stat", async () => {
    let reads = 0;
    const verdict = await checkSessionDrift(
      snap(),
      async () => ({ size: 100, mtimeMs: 5 }),
      async () => { reads++; return 11; },
      () => 11,
    );
    expect(verdict).toEqual({ kind: "allow" });
    expect(reads).toBe(0);
  });

  it("本端写入尚未回调时等待归因，不能按旧计数误拒绝", async () => {
    let pending = 1;
    let own = 10;
    setImmediate(() => { own = 11; pending = 0; });
    const verdict = await checkSessionDrift(
      snap(),
      async () => ({ size: 110, mtimeMs: 6 }),
      async () => 11,
      () => own,
      () => pending,
    );
    expect(verdict).toEqual({ kind: "allow", snapshot: { size: 110, mtimeMs: 6, lines: 11, ownAtSnapshot: 11 } });
  });

  it("当前读数持续变化时拒绝，且不返回能污染旧基线的快照", async () => {
    let size = 100;
    const verdict = await checkSessionDrift(
      snap(),
      async () => ({ size: ++size, mtimeMs: size }),
      async () => 11,
      () => 11,
    );
    expect(verdict).toEqual({ kind: "reject" });
  });

  it.each([0, 1])("采样中本端又追加一行，外部追加 %i 行时仍按一致快照裁决", async (external) => {
    let own = 11;
    let lines = 11;
    let size = 110;
    const verdict = await checkSessionDrift(
      snap(),
      async () => ({ size, mtimeMs: size }),
      async () => {
        if (own === 11) {
          own++;
          lines += 1 + external;
          size = lines * 10;
        }
        return lines;
      },
      () => own,
    );
    expect(verdict.kind).toBe(external === 0 ? "allow" : "reject");
    if (external === 0) {
      expect(verdict.snapshot).toEqual({ size: 120, mtimeMs: 120, lines: 12, ownAtSnapshot: 12 });
    } else {
      expect(verdict.snapshot).toBeUndefined();
    }
  });
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
