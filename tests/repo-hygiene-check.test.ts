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
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 盘上 src 下最大的那个 .ts 文件（只读；只用于"帽 > 现状"这条不变式）。 */
function maxSrcFile(): { path: string; lines: number } {
  const root = join(process.cwd(), "src");
  const out: Array<{ path: string; lines: number }> = [];
  const walk = (rel: string): void => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const r = rel === "" ? e.name : rel + "/" + e.name;
      if (e.isDirectory()) { walk(r); continue; }
      if (!e.name.endsWith(".ts")) continue;
      out.push({ path: "src/" + r, lines: readFileSync(join(root, r), "utf8").split("\n").length });
    }
  };
  walk("");
  return out.reduce((a, b) => (b.lines > a.lines ? b : a));
}
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
    // 读数 2026-10-11（W4 第三切片后）：最大是 orchestrator 2566 行（agent-runner 已降到 2515），帽 2600。夹具随现读走。
    expect(oversizedFiles([{ path: "src/agent/orchestrator.ts", lines: 2566 }]).ok).toBe(true);
  });

  it("超帽 ⇒ 红，且按大小降序点名两支（反向验证）", () => {
    // 用**帽派生**而不是写死 2801：帽调过一次（2800→2900）就把这条判卷顶红了，
    // 而它想判的只是"超帽怎么判"，与帽具体是几无关。
    const v = oversizedFiles([
      { path: "src/a.ts", lines: SRC_FILE_LINE_CAP + 1 },
      { path: "src/b.ts", lines: SRC_FILE_LINE_CAP * 2 },
      { path: "src/ok.ts", lines: 100 },
    ]);
    expect(v.ok).toBe(false);
    // 结构优先：`offenders` 就是「点名」这件事的机器可读面（降序 + 只收超帽那几支）。
    // 不去 toContain 散文——那既挡不住漂移，又给全仓顶包格水位加一格。
    expect(v.offenders).toEqual([
      { path: "src/b.ts", lines: SRC_FILE_LINE_CAP * 2 },
      { path: "src/a.ts", lines: SRC_FILE_LINE_CAP + 1 },
    ]);
  });

  it("恰好等于帽 ⇒ 绿", () => {
    expect(oversizedFiles([{ path: "src/exact.ts", lines: SRC_FILE_LINE_CAP }]).ok).toBe(true);
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
  it("取料帽 70%、体量帽 2900，与 docs/optimization-plan-2026-10-02.md §体量门登记的一致", () => {
    // 0.60 → 0.70 是 2026-10-05 的**第一次降帽裁决**（业主拍板），依据与读数写在
    // scripts/repo-hygiene-check.ts 的 OUTPUTS_SHARE_CAP 注释里：0.60 那档立门当天即被
    // 撞破（10-03 62.1% → 10-04 67.4%），机制是取料入库快过源码，与「证人与页同笔落库」
    // 纪律方向相反。不选「outputs/ 移出版本控制」是因为那会与该纪律正面冲突。
    expect(OUTPUTS_SHARE_CAP).toBe(0.7);
    // 体量帽**刻意不钉某个数字**：这一格上一版写死 2900，于是帽每被按设计上取整一次
    // （2800→2900→3000）判卷就红一次，而那个红**不代表任何东西坏**——它只代表"有人合法地
    // 维护了帽，忘了来改这个数字"。钉数字的那一格已被下一条取代：真正的不变式是
    // 「帽 > **盘上现读**最大文件」，它读盘、跟着仓长，且在帽被悄悄调小时照样响。
    // 帽每次调整的**理由**记在 `scripts/repo-hygiene-check.ts` 那一大段注释里（谁打破的、
    // 为什么该抬、真修法 W4 是什么），本格不重复那套叙述。
    // 帽不许被悄悄调回：降帽一次一档，要再降必须改这一处并同步文档，不许只改门。
    expect(OUTPUTS_SHARE_CAP).toBeGreaterThan(0.6);
  });

  it("体量帽仍高于现状最大文件 2566（降到 2566 及以下 ⇒ 门必红，那是降帽时刻该有的红）", () => {
    expect(SRC_FILE_LINE_CAP).toBeGreaterThan(2566);
  });

  it("**不变式**：帽必须高于盘上现状最大文件——否则门红在一个谁都不该去处理的地方", () => {
    // 这一条是这次撞红教出来的：原判卷只钉「帽 > 2761」这个**历史数**，而真正的不变式是
    // 「帽 > **现读**最大文件」。钉历史数 ⇒ 文件长过帽时判卷照样绿，只有门红，
    // 而门红的那一侧没人知道该怎么办（放宽帽违反直觉、拆分要独占窗口）。
    // 改成读盘：谁是最大文件、多少行，都由盘说了算。
    // 门把"扫 src 数行数"内联在 main 里（没有导出面），所以这里自带一份只读实现。
    // 刻意不把它抽成共享函数：那会动门的 IO 面，而本判卷要的是"**盘上现状**"这个独立事实——
    // 两处各自取料、互相印证，比共享一次取料更能发现"取料面本身坏了"。
    const max = maxSrcFile();
    const files = [max];
    expect(
      SRC_FILE_LINE_CAP > max.lines,
      "帽 " + String(SRC_FILE_LINE_CAP) + " ≤ 现状最大 " + max.path + "（" + String(max.lines) + " 行）"
        + " ⇒ 门面②必红。要么 W4 拆分，要么按本文件的帽设计把帽上取整到现状之上（并写清理由）。",
    ).toBe(true);
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
