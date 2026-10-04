// 仓库体量门（scripts/repo-hygiene-check.ts）的判据单测。
//
// 为什么这些判据要单测而不是只在门里跑：门跑的是**真仓当前状态**，它证明不了
// 「判据在越界时会不会转红」。本仓对每条核心判据都要求一条反向验证
// （`no-progress-check` 的 REDKINDS、`routing-check` 的 F4 同族做法）——
// 这里把越界输入摆在单测里，是为了让「这条判据能不能红」在每次 `pnpm test` 时都被量一次。
//
// 特别收录 SH4b 那条回归：初版按换行切 + `startsWith("outputs/")` 数，**164 条中文名取料全被漏掉**，
// 量出 52.6% 而真实 59.3%。少算的那一半恰好是本门最该盯的中文取料目录，
// 而它照样印出一个像模像样的百分比——这类「过滤器悄悄少收」比不过收更坏。
import { describe, expect, it } from "vitest";
import {
  OUTPUTS_SHARE_CAP,
  SRC_FILE_LINE_CAP,
  outputsShareVerdict,
  oversizedFiles,
  selfTests,
  trackedCounts,
} from "../scripts/repo-hygiene-check";

describe("trackedCounts：分母与分子是一份口径", () => {
  it("NUL 分隔：outputs 与其余加起来等于总数", () => {
    const c = trackedCounts("src/a.ts\0outputs/x.json\0docs/d.md\0");
    expect(c).toEqual({ total: 3, outputs: 1, rest: 2 });
  });

  // 回归钉：中文名路径必须原样收进来。
  // 若实现退回「换行切 + C 风格引用」，这条会红——而门本身照样绿（它只印百分比，不报缺收）。
  it("中文名取料被收进来（不因 git 的 C 风格引用而漏）", () => {
    const c = trackedCounts(
      ["src/a.ts", "outputs/agents-md/01-孤儿面迁移.md", "outputs/ga/英文名.json", "docs/x.md"].join("\0") + "\0",
    );
    expect(c.total).toBe(4);
    expect(c.outputs).toBe(2);
    expect(c.rest).toBe(2);
  });

  it("目录本身（outputs 无斜杠）算一个条目", () => {
    const c = trackedCounts("outputs\0src/a.ts\0");
    expect(c.outputs).toBe(1);
    expect(c.total).toBe(2);
  });

  it("末尾无 NUL 也不丢最后一条", () => {
    expect(trackedCounts("src/a.ts\0outputs/b.ts").total).toBe(2);
  });

  it("空清单 ⇒ 三项全 0（由 outputsShareVerdict 判红，不在这里放行）", () => {
    expect(trackedCounts("")).toEqual({ total: 0, outputs: 0, rest: 0 });
  });
});

describe("outputsShareVerdict：超帽才红，且必须带着分母", () => {
  it("现状量级在帽内 ⇒ 绿", () => {
    const v = outputsShareVerdict({ total: 2443, outputs: 1449, rest: 994 });
    expect(v.ok).toBe(true);
    expect(v.share).toBeCloseTo(0.593, 3);
  });

  it("详情行必须同时印出分子与分母（只印百分比会被读成别的意思）", () => {
    const v = outputsShareVerdict({ total: 100, outputs: 60, rest: 40 });
    // 分子 / 分母 / 其余 三个数都必须在场。这一格量的正是「范围得是字段」：
    // 只印一个百分比，别人没法判断这个比例的分母是什么。
    for (const n of ["60", "100", "40"]) expect(v.detail).toContain(n);
  });

  it("超帽 ⇒ 红（反向验证）", () => {
    expect(outputsShareVerdict({ total: 1000, outputs: 900, rest: 100 }).ok).toBe(false);
  });

  it("恰好等于帽 ⇒ 绿（边界含等号）", () => {
    expect(outputsShareVerdict({ total: 100, outputs: 60, rest: 40 }).ok).toBe(true);
  });

  // 第三态：取不到清单时「没算出来」与「占比 0」同形，放行就是把没尺读成没问题。
  //
  // 这一条刻意**不**去 `toContain` 那句诊断散文：断言「文案里含某个裸名字」既挡不住
  // 语义漂移，又会给全仓的「顶包格」水位加一格（`scripts/prose-needle-scan.ts` 的
  // `SCOPE_CEILINGS.bareName` 是只准下调的棘轮）。改成断**结构**：
  // 判红 + 不编一个占比出来 —— 后者才是「不当 0 放行」这句话真正在承诺的事。
  it("total=0 ⇒ 判红，且不编一个占比出来", () => {
    const v = outputsShareVerdict({ total: 0, outputs: 0, rest: 0 });
    expect(v.ok).toBe(false);
    expect(v.share).toBe(0);
  });
});

describe("oversizedFiles：超帽判红且点名", () => {
  it("现状最大文件在帽内 ⇒ 绿", () => {
    expect(oversizedFiles([{ path: "src/main/agent-runner.ts", lines: 2761 }]).ok).toBe(true);
  });

  it("超帽 ⇒ 红，且按大小降序点名两支（反向验证）", () => {
    const v = oversizedFiles([
      { path: "src/a.ts", lines: 2801 },
      { path: "src/b.ts", lines: 5000 },
      { path: "src/ok.ts", lines: 100 },
    ]);
    expect(v.ok).toBe(false);
    // 结构优先：`offenders` 就是「点名」这件事的机器可读面（降序 + 只收超帽那几支）。
    // 不去 toContain 散文——那既挡不住漂移，又给全仓顶包格水位加一格。
    expect(v.offenders).toEqual([
      { path: "src/b.ts", lines: 5000 },
      { path: "src/a.ts", lines: 2801 },
    ]);
  });

  it("恰好等于帽 ⇒ 绿", () => {
    expect(oversizedFiles([{ path: "src/exact.ts", lines: 2800 }]).ok).toBe(true);
  });

  it("空清单 ⇒ 绿（没有文件就不该红；但真仓取不到 src 时由 IO 层另判红）", () => {
    const v = oversizedFiles([]);
    expect(v.ok).toBe(true);
    // 结构面：没有超帽的就没有 offenders（不去 toContain「n/a」那句散文，理由同上）。
    expect(v.offenders).toEqual([]);
  });
});

describe("帽的取值有据（防「悄悄把帽调到让门绿」）", () => {
  // 这两条不是测行为，是测**门的诚实度**：帽必须仍高于现状，且是文档里写着的那个数。
  it("取料帽 70%、体量帽 2800，与 docs/optimization-plan-2026-10-02.md §体量门登记的一致", () => {
    // 0.60 → 0.70 是 2026-10-05 的**第一次降帽裁决**（业主拍板），依据与读数写在
    // scripts/repo-hygiene-check.ts 的 OUTPUTS_SHARE_CAP 注释里：0.60 那档立门当天即被
    // 撞破（10-03 62.1% → 10-04 67.4%），机制是取料入库快过源码，与「证人与页同笔落库」
    // 纪律方向相反。不选「outputs/ 移出版本控制」是因为那会与该纪律正面冲突。
    expect(OUTPUTS_SHARE_CAP).toBe(0.7);
    expect(SRC_FILE_LINE_CAP).toBe(2800);
    // 帽不许被悄悄调回：降帽一次一档，要再降必须改这一处并同步文档，不许只改门。
    expect(OUTPUTS_SHARE_CAP).toBeGreaterThan(0.6);
  });

  it("体量帽仍高于现状最大文件 2761（降到 2761 及以下 ⇒ 门必红，那是降帽时刻该有的红）", () => {
    expect(SRC_FILE_LINE_CAP).toBeGreaterThan(2761);
  });

  it("帽不许被调到低于仓库自己的历史取料水位（0.593），否则这道门只会永远红", () => {
    // 2443/2443*0 … 精确算：1449/2443 = 0.5931（立门当天的实测）。
    expect(OUTPUTS_SHARE_CAP).toBeGreaterThanOrEqual(1449 / 2443);
  });
});

describe("反向验证总表：每一条自身判据都能转红", () => {
  const rows = selfTests();
  it("至少 9 条（覆盖面①现状/超帽/无尺/边界 + CJK 回归 + 面②现状/超帽/边界）", () => {
    expect(rows.length).toBeGreaterThanOrEqual(9);
  });
  for (const r of rows) {
    it(`${r.id} — ${r.detail}`, () => {
      expect(r.ok).toBe(true);
    });
  }
});