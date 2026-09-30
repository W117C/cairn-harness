/** 第 243 页：页号占号这把尺的判卷。
 *  动因：09-30 一晚撞了三次号（234／236／240），三次都是「现读最大＋1」这个**读法**在并发下的必然竞态，
 *  不是有人不守规矩。这一把把它换成原子占位（`mkdir` 的 EEXIST 语义），号池放 git common dir 下（跨 worktree 共享）。
 *  判卷面按本仓规矩：纯函数＋存在性注入（假 ops），接线判卷行锚定（规则 236：同文件 toContain 会恒真）。 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PAGE_CLAIM_MAX_ATTEMPTS,
  claimPage,
  claimedPages,
  insideRepo,
  nextFreePage,
  pageNumbersIn,
  type ClaimOps,
  type CreateOutcome,
} from "../scripts/lib/page-claim";

/** 假号池：`pool` 就是已经存在的目录名；`blocked` 用来模拟"别人在我 create 之前抢先"。 */
function fakeOps(pool: Set<string>, opts?: {
  ensureThrows?: Error;
  listThrows?: boolean;
  alwaysExists?: boolean;
  onAttempt?: (candidate: number) => void;
}): { ops: ClaimOps; tried: number[] } {
  const tried: number[] = [];
  return {
    tried,
    ops: {
      ensureDir: () => { if (opts?.ensureThrows !== undefined) throw opts.ensureThrows; },
      list: () => (opts?.listThrows === true ? null : [...pool]),
      create: (_d, name) => {
        const n = Number(name);
        tried.push(n);
        opts?.onAttempt?.(n);
        if (opts?.alwaysExists === true) return "exists" satisfies CreateOutcome;
        if (pool.has(name)) return "exists" satisfies CreateOutcome;
        pool.add(name);
        return "ok" satisfies CreateOutcome;
      },
    },
  };
}

describe("nextFreePage：页号单调往上（max＋1），不是最小可用号", () => {
  it("连续号回到 max＋1；有空洞也不回填；start 只当**下限**", () => {
    expect(nextFreePage([1, 2, 3], 1)).toBe(4);
    expect(nextFreePage([7, 9], 1)).toBe(10);
    expect(nextFreePage([1, 2], 5)).toBe(5);
  });

  it("非整数不参与 max（一个 9.5 或 NaN 都不许把号带到小数／NaN），空面回 start", () => {
    expect(nextFreePage([4, 9.5, Number.NaN], 1)).toBe(5);
    expect(nextFreePage([], 242)).toBe(242);
  });

  it("空洞不回填这条要有名字：台账上删过一页也不许把那个号发给新页（旧号出现在两处比新号撞车更难查）", () => {
    expect(nextFreePage([1, 2, 4, 5], 1)).toBe(6);
  });
});

describe("页号取料", () => {
  it("台账标题里的页号要抽出来，**重复的号全收**（去重＝把撞号史读成没人占过）", () => {
    const text = [
      "### 2026-09-30 · 第 239 页 · 甲",
      "### 2026-09-30 · 第 240 页（本会话）· 乙",
      "### 2026-09-30 · 第 240 页 · 丙",
      "### 2026-09-30 · 第 237 页补 凭证：丁",
      "正文里提一句 第 999 页 不算标题",
    ].join("\n");
    expect(pageNumbersIn(text).sort((a, b) => a - b)).toEqual([237, 239, 240, 240]);
  });

  it("号池目录名只认纯数字（临时名／别人的文件不算占位，也不能因此被删）", () => {
    expect(claimedPages(["12", "13", "tmp-14", ".lock", "14x"]).sort((a, b) => a - b)).toEqual([12, 13]);
  });

  /** `--file=` 是用户给的路径，边界检查必须按**目录段**比而不是裸前缀：
   *  `/repo/.worktrees-backup/x` 与 `/repo/.worktrees` 共享前缀却不是自家人（第十族：前缀匹配要按位置枚举）。 */
  it("insideRepo：按目录边界判，绝对路径/out/../ 与同前缀兄弟目录都算在外面，空根不算在里面", () => {
    expect(insideRepo("/repo/PROGRESS.md", "/repo")).toBe(true);
    expect(insideRepo("/repo/docs/x.md", "/repo")).toBe(true);
    expect(insideRepo("/tmp/PROGRESS.md", "/repo")).toBe(false);
    expect(insideRepo("/repo/../etc/passwd", "/repo")).toBe(false);
    expect(insideRepo("/repo/.worktrees-backup/x", "/repo/.worktrees")).toBe(false);
    expect(insideRepo("/repo", "/repo"), "根自己不算「在里面」：调用方拿这个判存在性时会误判").toBe(false);
    expect(insideRepo("/repo/x", "")).toBe(false);
  });
});

describe("claimPage：原子占位", () => {
  it("空池占到 1；台账已写到 240 就从 241 起", () => {
    const a = fakeOps(new Set());
    const r = claimPage({ dir: "/pool", taken: [], ops: a.ops });
    expect(r.page).toBe(1);
    const b = fakeOps(new Set());
    const r2 = claimPage({ dir: "/pool", taken: pageNumbersIn("### x · 第 240 页 · 乙\n### x · 第 239 页 · 甲"), ops: b.ops });
    expect(r2.page, r2.cell).toBe(241);
  });

  it("别人抢先占了同一号 ⇒ 让位后**重新 list** 再占一次（拿旧名单里的下一个会把已被占的号再发一遍）", () => {
    const pool = new Set<string>();
    const { ops, tried } = fakeOps(pool, {
      onAttempt: (n) => {
        // 我算出 241 的这一瞬，隔壁把 241 与 242 都占了（池里此刻能看到）
        if (n === 241) { pool.add("241"); pool.add("242"); }
      },
    });
    const r = claimPage({ dir: "/pool", taken: [240], ops });
    expect(r.page, r.cell).toBe(243);
    expect(tried, "重新扫过就该一步到位：候选序列里不该再出现 242").toEqual([241, 243]);
    expect(r.yielded).toBe(1);
    expect(pool.has("243"), "占到的号必须真的落进池").toBe(true);
  });

  it("台账那一维取不到时要印「取不到」而不是 0，且号池那一维仍然能用", () => {
    const { ops } = fakeOps(new Set(["240", "241"]));
    const r = claimPage({ dir: "/pool", taken: null, ops });
    expect(r.page, r.cell).toBe(242);
    expect(r.cell, r.cell).toContain("台账面 取不到");
    expect(r.cell, "把「读不到」写成实数 0 ＝ 本仓点名的同形假绿").not.toContain("台账面 0");
    // 反向：台账有料时那一格必须报出条数，不许长期挂「取不到」把这一维藏掉
    expect(claimPage({ dir: "/pool", taken: [1, 2, 3], ops: fakeOps(new Set()).ops }).cell).toContain("台账面 3 个");
  });

  it("号池建不出来＝那一格取不到，且这一态与「读不到」「让位次数用满」各有各的名字（三态同形就没人知道该修哪一台）", () => {
    const a = fakeOps(new Set(), { ensureThrows: new Error("EACCES: permission denied") });
    const r = claimPage({ dir: "/pool", taken: [], ops: a.ops });
    expect(r.page).toBeNull();
    expect(r.cell, r.cell).toContain("建不出来");
    expect(r.cell, "这一态不许借用另一态的名字").not.toContain("读不到");
    expect(r.cell, "这一态不许借用另一态的名字").not.toContain("让位次数用满");

    const b = fakeOps(new Set(), { listThrows: true });
    const r2 = claimPage({ dir: "/pool", taken: [], ops: b.ops });
    expect(r2.page).toBeNull();
    expect(r2.cell, r2.cell).toContain("读不到");

    const c = fakeOps(new Set(), { alwaysExists: true });
    const r3 = claimPage({ dir: "/pool", taken: [], ops: c.ops });
    expect(r3.page).toBeNull();
    expect(r3.cell, r3.cell).toContain("让位次数用满");
    // 三种坏读数各有一句自己的名字：两两不许同形（同形＝读的人不知道该修哪一台）
    expect(new Set([r.cell, r2.cell, r3.cell]).size, "三态必须三个名字").toBe(3);
    // 负控：占到的那一句不许长得像坏读数
    const ok = claimPage({ dir: "/pool", taken: [], ops: fakeOps(new Set()).ops });
    expect(ok.page).toBe(1);
    expect(ok.cell, ok.cell).not.toContain("取不到");
    expect(ok.cell, ok.cell).not.toContain("让位次数用满");
  });

  it("一直让位要撞帽并出声，不许无限重试（帽本身就是读数）", () => {
    const { ops, tried } = fakeOps(new Set(), { alwaysExists: true });
    const r = claimPage({ dir: "/pool", taken: [], ops });
    expect(r.page).toBeNull();
    expect(tried.length, "尝试次数必须正好等于帽，不是再多跑一轮").toBe(PAGE_CLAIM_MAX_ATTEMPTS);
    expect(r.cell, r.cell).toContain("让位次数用满");
  });
});

describe("接线：CLI 吃的是这把尺，不是自己再算一遍", () => {
  const src = readFileSync(fileURLToPath(new URL("../scripts/next-page.ts", import.meta.url)), "utf8");

  it("next-page.ts 必须调 claimPage 并在没占到时退 2（只印不占＝号池永远空，撞号照旧）", () => {
    expect(src, "取料必须走共用的 claimPage，不许在 CLI 里另写一套 max＋1").toMatch(
      /^const r = claimPage\(\{/m);
    /* 每个「没占到」出口都要退 2 ⇒ 数**总个数**而不是找第一个：
       早先这里是 `/^  process\.exit\(2\);$/m`（无 g），它被 common-dir 那一支先满足，
       于是把 `page === null` 那支的 exit 删掉，CLI 照样印「❌ 没占到」而退 0——这条判卷当时是零证人（评审实测两删都绿）。
       数个数才会为"少任何一个出口"而红；分支自己另有锚点（下面两条）。 */
    const exits = src.match(/^  process\.exit\(2\);$/gm) ?? [];
    expect(exits.length, `CLI 里 2-空格缩进的 exit(2) 只有 ${String(exits.length)} 处；四个「没占到」出口（common dir／台账路径／两面无料／没占到）一个都不许少`).toBe(4);
    expect(src, "没占到那一支必须按 page===null 判，而不是按 cell 空判（cell 永远有字）").toMatch(
      /^if \(r\.page === null\) \{$/m);
  });

  it("common dir 取不到要出声并退 2（静默退回 cwd 的 .git＝在 linked 树里各占各的池）", () => {
    expect(src, "取不到 common dir 的那一支必须存在且非零退出").toMatch(
      /^if \(COMMON === null\) \{$/m);
  });

  it("`--file=` 要归一化并查边界，且台账读不到不许冒充 0 条", () => {
    expect(src, "`join(cwd, 绝对路径)` 不认第二段 ⇒ 一个看着合法的 `--file=/abs/x.md` 会静默读到不存在的路径；必须先 resolve 再查是否本仓").toMatch(
      /^const LEDGER = resolve\(CWD, LEDGER_ARG\);$/m);
    expect(src, "台账路径出仓要退 2，不去仓外读数字").toMatch(
      /^if \(TOP === null \|\| !insideRepo\(LEDGER, TOP\)\) \{$/m);
    expect(src, "台账读不到要传 null（由那一格自己说「取不到」），不许吞成空数组").toMatch(
      /^  taken = pageNumbersIn\(readFileSync\(LEDGER, "utf8"\)\);$/m);
    expect(src, "号池被清空后会被 recursive mkdir 悄悄重建 ⇒ 必须先记下它在不在").toMatch(
      /^const poolPreexisting = existsSync\(DIR\);$/m);
  });
});
