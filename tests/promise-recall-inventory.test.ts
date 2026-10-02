// 判卷 · 回取承诺的**清单完整性**（第 63 页 §六 那条"这条尺没进门"的债，这一笔还）。
//
// 为什么必须有 vitest 这一半：探针（`scripts/probe-promise-recall.ts`）只有人记得跑它才说话；
// 而 D-8 第五判据点名的正是这一族形状——「机制挂在"有人跑"上，不挂在现状上」。
// 本文件不重抄判据，只吃探针导出的那一份纯函数（规则 100：同一条判据各抄一份迟早漂）。
//
// 判的两格（缺一格就能骗过去）：
//   ① 每个模型可见的回取承诺面都有判定归属（新加一句「全文见 X」而不登记 ⇒ 红）；
//   ② 判定归属表里没有陈旧键（把三处副本收成一支之后旧键还挂着 ⇒ 红，与 D-8 ② 同族）。
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  PROMISE_MARKS, RUNNERS, UI_ROOTS, builderCoverage, isKnownRunner, promiseInventoryFindings, runnerVerdict,
  scanBuilderCallSites, scanCapNoticeCalls, scanPromiseSites,
  type PromiseSite,
} from "../scripts/probe-promise-recall";
import { trackedExistingFiles } from "../scripts/lib/scan-scope";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** 真盘取料：与探针同一套口径（收成一份的 `trackedExistingFiles`，两支不再各抄一遍循环）。 */
function srcSources(): { files: { path: string; text: string }[]; missingOnDisk: string[] } {
  const scope = trackedExistingFiles(ROOT, "src");
  return {
    files: scope.files.map((p) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") })),
    missingOnDisk: scope.missingOnDisk,
  };
}

const scanned = srcSources();
const sites = scanPromiseSites(scanned.files);
const findings = promiseInventoryFindings(sites, RUNNERS);

describe("回取承诺清单：每一面都得有判定归属，登记表不许烂在这儿", () => {
  it("真盘扫到了料（读到 0 处＝没有尺，不读成干净——规则 74）", () => {
    expect(sites.length, "PROMISE_MARKS=" + PROMISE_MARKS.join("/")).toBeGreaterThan(0);
    // 取料面必须说得出范围：模型可见 / 免判 / 已跟踪不在盘，三样都要有数。
    expect(findings.modelKeys.length, JSON.stringify(findings.byAudience)).toBeGreaterThan(0);
  });

  it("每一处模型可见的承诺面都有判定归属（新加一句『全文见 X』而不登记 ⇒ 这条先红）", () => {
    expect(findings.unjudged, "没有判定归属的面：" + findings.unjudged.join(" | ")).toEqual([]);
  });

  // 第 309 页补的那半格：登记表**有键**不等于**有人判**。此前 `runOnce` 是"落到最后一支"的 ternary，
  // 于是把判定名打错会得到 `hopPruneStub` 的结论——清单看着齐全，那一面其实一次都没判过。
  it("登记了的判定名必须真有一个实现（打错名字＝顶包，比缺登记更难发现）", () => {
    const bad = Object.entries(RUNNERS).filter(([_k, v]) => !isKnownRunner(v));
    expect(bad, "指向不存在判定的登记：" + bad.map(([k, v]) => `${k}→${v}`).join(" | ")).toEqual([]);
    expect(isKnownRunner("hopWebAnchorClaim"), "第 309 页那一面的判定名要真在花名册里").toBe(true);
  });

  it("未知判定名不 exec、直接红在这一格（不许拿别的 hop 的结果顶替）", async () => {
    const v = await runnerVerdict("hopNoSuchThing", "/tmp");
    expect(v.ok, "未知名字居然返回了绿 ⇒ 它顶的是别人的结论").toBe(false);
    expect(v.detail).toContain("hopNoSuchThing");
    expect(v.how).toContain("不 exec");
  });

  it("判定归属表里没有陈旧键（那一面已不在盘上发射，登记表必须跟着撤）", () => {
    expect(findings.stale, "陈旧归属键：" + findings.stale.join(" | ")).toEqual([]);
  });

  it("复现器：凭空加一处承诺面 ⇒ 清单当场点名它（证明①不是恒真）", () => {
    const one = scanned.files.find((f) => f.path === "src/agent/plugins/skills.ts") ?? scanned.files[0];
    const withExtra = scanPromiseSites([
      { path: one.path, text: one.text + '\nfunction __addedPromise(): string { return "[全文见 /somewhere/else]"; }\n' },
    ]);
    const after = promiseInventoryFindings(withExtra, RUNNERS);
    expect(after.unjudged, "加了新面而判据没报 ⇒ 这条判据是恒真的").toContain("src/agent/plugins/skills.ts#__addedPromise");
  });

  it("反向一侧：同形状落在 UI 根里 ⇒ 不进义务名单（豁免按落位，不是全量放行）", () => {
    const uiRoot = UI_ROOTS[0]!;
    const asUi: PromiseSite[] = scanPromiseSites([
      { path: uiRoot + "__probe.js", text: 'function __probeUi(): string { return "[全文见 安全报告卡]"; }' },
    ]);
    expect(asUi.length, "UI 根那条得先扫得到料").toBeGreaterThan(0);
    const f = promiseInventoryFindings(asUi, RUNNERS);
    expect(f.modelKeys, JSON.stringify(f.byAudience)).toEqual([]);
    expect(f.unjudged).toEqual([]);
  });

  // #58：收料表原先只有五种中文措辞 ⇒ 英文写法（`obs_recall available`）与另一种中文（`取全文 obs_recall id=`）
  // 整族漏收（规则 122：机制判据挂在一种写法上＝换写法即绕过）。下面三条把"网加宽了"与
  // "没宽到把散文当承诺"一起钉住（第 68 页的教训：一条把安全写法也判红的判据，下一轮就有人放宽它）。
  it("#58 两种新写法都进清单，并且各自当场欠一条判定归属", () => {
    const sites = scanPromiseSites([
      { path: "src/__probe_en.ts", text: 'function a(): string { return "[observation abc: 12 bytes, 3 lines; obs_recall available]"; }' },
      { path: "src/__probe_zh.ts", text: 'function b(): string { return "[source_sha=deadbeef; 取全文 obs_recall id=abc]"; }' },
    ]);
    expect(sites.map((s) => s.mark).sort(), JSON.stringify(sites.map((s) => [s.file, s.mark]))).toEqual([" available", "取全文"]);
    const f = promiseInventoryFindings(sites, RUNNERS);
    expect(f.unjudged.length, "新面没被要求登记判定 ⇒ 这把尺只收字不逼判定").toBe(2);
  });

  it("负控：光有 available 而没点一个可调用的工具 ⇒ 不算承诺（本轮实测假红过的那条形状）", () => {
    const sites = scanPromiseSites([
      { path: "src/__probe_fp.ts", text: 'function c(): string { return "[context_budget_exceeded] final estimate 9; available 4321; request not sent"; }' },
    ]);
    expect(sites).toEqual([]);
  });

  it("盘上这两格确实进了模型可见清单（合成样本过了而盘上没收，等于没修）", () => {
    expect(findings.modelKeys).toContain("src/agent/ledger.ts#project");
    expect(findings.modelKeys).toContain("src/agent/solpi-runtime.ts#candidate");
  });
});

// #59 的裁决底料：把「回取承诺＝builder 调用」这一族判据从印象变成可复跑的数。
// 这一族的意义不在红，在于**下一轮不许再凭印象说"结构化就安全"**（规则 117：要裁决的数先落复跑面）。
describe("结构网（builder）与措辞网各自盖住几格", () => {
  it("builder 的**调用点**计数：调一次算一处，定义本身不算，认不出的名字不算", () => {
    const calls = scanBuilderCallSites([
      {
        path: "src/__probe_b.ts",
        text: 'export function byteCapNotice(a: number, b: number, c: string): string { return a + b + c; }\n' +
          'function run(): string { return "x" + byteCapNotice(1, 2, "y") + otherNotice(3); }\n',
      },
    ]);
    expect(calls.map((c) => `${c.file}#${c.fn}:${c.builder}`)).toEqual(["src/__probe_b.ts#run:byteCapNotice"]);
  });

  it("字面量在 builder 体内 ⇒ viaBuilder；在调用方 inline ⇒ inline（这就是 #59 那个分的两栏）", () => {
    const sites = scanPromiseSites([
      { path: "src/__probe_x.ts", text: 'function skillRecallSuffix(): string { return "[全文见 a]"; }' },
      { path: "src/__probe_y.ts", text: 'function project(): string { return "[obs_recall available]"; }' },
    ]);
    const cov = builderCoverage(sites);
    expect(cov.viaBuilder).toEqual(["src/__probe_x.ts#skillRecallSuffix"]);
    expect(cov.inline).toEqual(["src/__probe_y.ts#project"]);
  });

  // 陷阱写死成一条用例（规则 128 第二种形态）：builder 的**定义**与它的**调用点**是两个键，
  // 拿键集取交集会恒得 0 交集 ⇒ 看起来像"两网毫不相干"，实际是比错了东西。
  it("反向：按键集比 builder 调用点与承诺面会得 0 交集——所以只能按 `fn` 分栏", () => {
    const sites = scanPromiseSites([
      { path: "src/__probe_z.ts", text: 'function skillRecallSuffix(): string { return "[全文见 a]"; }' },
      { path: "src/__probe_z.ts", text: 'function caller(): string { return skillRecallSuffix(); }' },
    ]);
    const callKeys = [...new Set(scanBuilderCallSites([
      { path: "src/__probe_z.ts", text: 'function caller(): string { return skillRecallSuffix(); }' },
    ]).map((c) => `${c.file}#${c.fn}`))];
    expect(callKeys).toEqual(["src/__probe_z.ts#caller"]);
    expect(builderCoverage(sites).viaBuilder).toEqual(["src/__probe_z.ts#skillRecallSuffix"]);
  });

  it("盘上读数：今天确有承诺是 inline 发出来的 ⇒ 「按 builder 收料」只是补充网，不能替换措辞网", () => {
    const cov = builderCoverage(sites.filter((s) => s.audience === "model"));
    for (const k of ["src/agent/plugins/skills.ts#skillRecallSuffix", "src/agent/prune.ts#pruneRecallSuffix"]) {
      expect(cov.viaBuilder, "两个 builder 面认不出来 = NOTICE_BUILDERS 或取料漂了").toContain(k);
    }
    expect(cov.inline.length, "inline 归零说明承诺全搬进 builder 了——那时该重判 #59，别让这条静默绿着").toBeGreaterThan(0);
    expect(cov.inline).not.toContain("src/agent/prune.ts#pruneRecallSuffix");
  });
});

// 「半句话」这条判据的两种收法，宽窄各一条，数据都在这一面（第 74 页）。
// 宽版本（按措辞收 `截断/上限/未列出…`）量出来 107 处里 96 处是散文 ⇒ **否决**，读数留在
// `outputs/half-sentence-net-2026-09-26/01-measure.mts`；这里钉的是挂在结构上的窄版本。
describe("半句话的窄版本：byteCapNotice 的下一步实参 / truncationNotice 的老文案", () => {
  it("下一步给空串 ⇒ 抓到；给了动作串 ⇒ 放过；缺参不猜", () => {
    const calls = scanCapNoticeCalls([
      { path: "src/__probe_a.ts", text: 'function f(): string { return byteCapNotice(50, 1000, ""); }' },
      { path: "src/__probe_b.ts", text: 'function g(): string { return byteCapNotice(50, 1000, "接着读用 offset=2"); }' },
    ]);
    expect(calls.map((c) => c.file).sort()).toEqual(["src/__probe_a.ts", "src/__probe_b.ts"]);
    const a = calls.find((c) => c.file.endsWith("__probe_a.ts"))!;
    const b = calls.find((c) => c.file.endsWith("__probe_b.ts"))!;
    expect(a.emptyNextStep).toBe(true);
    expect(b.emptyNextStep).toBe(false);
    expect(b.nextStepArg).toContain("offset");
  });

  it("老文案 `truncationNotice(n)` 单独计数（它不说少了多少，第 67 页立的纪律）", () => {
    const calls = scanCapNoticeCalls([
      { path: "src/__probe_c.ts", text: 'function h(): string { truncationNotice(50); return capLspOutput("x", 1); }' },
    ]);
    expect(calls.map((c) => c.builder)).toEqual(["truncationNotice"]); // 认不出的名字不算（防把每个函数都收进来）
  });

  it("盘上两个数都得说得出（0 是读数不是没尺：调用点面必须非空）", () => {
    const calls = scanCapNoticeCalls(scanned.files);
    expect(calls.some((c) => c.builder === "byteCapNotice"), "byteCapNotice 的调用点一个都没扫到 = 取料漂了").toBe(true);
    expect(calls.filter((c) => c.emptyNextStep)).toEqual([]); // 今天合格；哪天有人传空串，这条点名它
  });
});

// 取料口径收成一份以后，这支自己要有判卷：它现在是 `gates.ts`、探针与本判卷三家的共用面。
describe("trackedExistingFiles：「已跟踪」与「盘上有」是两件事，缺席那一半必须有名字", () => {
  it("三态各自交出：在盘的进 files、不在盘的进 missingOnDisk、第三态不许混进前两态", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-scan-existing-"));
    try {
      const git = (args: string[]): void => { execFileSync("git", args, { cwd: dir, stdio: "ignore" }); };
      git(["init", "-q"]);
      mkdirSync(join(dir, "scripts"));
      writeFileSync(join(dir, "scripts", "on-disk.ts"), "export const a = 1;\n");
      writeFileSync(join(dir, "scripts", "deleted.ts"), "export const b = 1;\n");
      git(["add", "scripts/on-disk.ts", "scripts/deleted.ts"]);
      rmSync(join(dir, "scripts", "deleted.ts")); // 别人未提交的删除：索引里还在，盘上没了
      const r = trackedExistingFiles(dir);
      expect(r.trackedUnavailable).toBe(false);
      expect(r.files).toEqual(["scripts/on-disk.ts"]);
      // 关键在第二半：原来那一支写成 `.filter(existsSync)`，这里只会读出"扫描面 1 支"，
      // 而报告写着"扫了已跟踪脚本"⇒ 范围成了数出来的差值而不是字段（规则 82/92）。
      expect(r.missingOnDisk).toEqual(["scripts/deleted.ts"]);
      expect(r.files.length + r.missingOnDisk.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("拿不到 git 清单 ⇒ trackedUnavailable＝true，且不许被读成『没有要扫的东西』（fail-open 那一侧）", () => {
    const r = trackedExistingFiles(tmpdir());
    expect(r.trackedUnavailable).toBe(true);
    expect(r.files).toEqual([]); // 空**不是**"干净"，调用方必须据此退回磁盘遍历并出声
  });
});
