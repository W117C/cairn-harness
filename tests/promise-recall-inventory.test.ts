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
  CLAIM_BINDINGS, CLAIM_UNWITNESSED_CAP, PROMISE_MARKS, RUNNERS, UI_ROOTS, BINDING_SYMBOL_MAX_JUDGE_FILES, bindClaimFaces,
  builderCoverage, claimWitnessCeiling,
  claimWitnessFindings, claimWitnessRuns, isKnownRunner, promiseInventoryFindings, runnerVerdict,
  scanBuilderCallSites, scanCapNoticeCalls, scanClaimSites, scanPromiseSites,
  type ClaimSite, type ClaimWitnessFindings, type PromiseSite,
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

/* ================= 第 311 页：第二个 claim 类——模型可见的「能力断言」有没有证人 =================
 *
 * 第 308 页抓到的那格不是"文案说错了"，是**同一句里真话那半被点过 11 次、假话那半 0 次**：
 * 「这句有人判」这个印象是真的，被绕开的正是"按分句配证人"。本面把这件事收成一张表：
 * 凡是 harness 对模型说"我不会/只能/已按 X"的句子，测试里至少得有一段真点过它。
 *
 * 判卷吃的是**探针导出的同一份纯函数**（取料与受众判定都不在此重算，规则 100/236）。 */
describe("能力断言的证人面：一句都不曾被点过才算欠（第 311 页）", () => {
  it("受众判定沿整条 parent 链认终端写入——`paint(…)` 包一层也是给运维看的", () => {
    // 这四支是唯一变量为"怎么把字交给终端"的同形输入。旧写法只看**最近**那个 CallExpression，
    // 于是 `process.stdout.write(paint(YELLOW, "…"))` 判成 model（最近一层是 paint），
    // usage 文案被要求"照那句做一遍"＝断言越界（规则 60 那一族）。
    const src = [
      'function a(): void { console.warn("探针假句不覆盖既有转录记录"); }',
      'function b(): void { process.stdout.write(paint(YELLOW, "探针假句不覆盖既有转录记录")); }',
      'function c(): void { process.stderr.write("探针假句不覆盖既有转录记录"); }',
      'function d(): void { noteForModel("探针假句不覆盖既有转录记录"); }',
    ].join("\n");
    const sites = scanClaimSites([{ path: "src/__probe.ts", text: src }]);
    const byFn = new Map(sites.map((s) => [s.fn, s.audience]));
    expect([...byFn.keys()], "四支都该收到料：" + JSON.stringify(sites.map((s) => s.fn))).toEqual(["a", "b", "c", "d"]);
    expect([byFn.get("a"), byFn.get("b"), byFn.get("c")], "终端写入的三种写法都得认成 operator").toEqual([
      "operator", "operator", "operator",
    ]);
    expect(byFn.get("d"), "不挂终端的那一支仍是 model（不许把收窄写成放行）").toBe("model");
  });

  it("证人候选段：插值挖掉、按非中文断开、6 字门槛、去重", () => {
    const runs = claimWitnessRuns("假意歧义：${subject} ⇒ 清单仍是各份探针定义的并集，上限 ${String(n)} 条");
    expect(runs, JSON.stringify(runs)).toContain("清单仍是各份探针定义的并集");
    expect(runs.every((r) => r.length >= 6), "门槛之下的碎片顶不了证人：" + JSON.stringify(runs)).toBe(true);
    expect(new Set(runs).size, "同段重复会让分母虚高").toBe(runs.length);
    // 整句没有中文（纯英文/纯变量）⇒ 空数组＝**不可知**，不许由"命中 0"冒充"有人判过"
    expect(claimWitnessRuns("obs_recall available again later"), "纯英文句子挑不出中文段").toEqual([]);
  });

  it("三态各占一格：witnessed／unwitnessed／noNeedle，一条都不许静默归进『没问题』", () => {
    const fake: ClaimSite[] = [
      { file: "src/x.ts", fn: "f1", mark: "不会", text: "探针假句不会替你翻页", line: 1, audience: "model", runs: ["探针假句不会替你翻页"], needle: "探针假句不会替你翻页" },
      { file: "src/x.ts", fn: "f2", mark: "只能", text: "探针假句只能往小调", line: 2, audience: "model", runs: ["探针假句只能往小调"], needle: "探针假句只能往小调" },
      { file: "src/x.ts", fn: "f3", mark: "不会", text: "obs_recall available", line: 3, audience: "model", runs: [], needle: "" },
      { file: "src/x.ts", fn: "f4", mark: "不覆盖", text: "探针假句在终端里才看得见的不覆盖", line: 4, audience: "operator", runs: ["探针假句在终端里才看得见的不覆盖"], needle: "探针假句在终端里才看得见的不覆盖" },
    ];
    const f = claimWitnessFindings(fake, ["……探针假句不会替你翻页……"]);
    expect(f.witnessed.length, "被点过的那段要落进 witnessed").toBe(1);
    expect(f.unwitnessed, "只有第二段没人点过 ⇒ 欠证人恰好一条：" + f.unwitnessed.join(" | ")).toHaveLength(1);
    expect(f.unwitnessed[0]).toContain("f2");
    expect(f.noNeedle, "挑不出段的那条是**不可知**，不是有证人").toEqual(["src/x.ts#f3｜"]);
    expect(f.modelSites, "operator 那一面不进分母").toBe(3);
    // 「对全部输入同答」那一格：判据不许把三种态读成同一个数
    expect([f.witnessed.length, f.unwitnessed.length, f.noNeedle.length], JSON.stringify(f)).toEqual([1, 1, 1]);
  });

  it("帽三态各自出声：超帽红、低于帽也红（登记表自己烂掉不许静默）", () => {
    const mk = (n: number): ClaimWitnessFindings => ({
      modelSites: n, witnessed: [], unwitnessed: Array.from({ length: n }, (_u, i) => "k" + String(i)),
      noNeedle: [], byAudience: { model: n, operator: 0, ui: 0 },
    });
    expect(claimWitnessCeiling(mk(3), 3)).toMatchObject({ over: false, stale: false, margin: 0 });
    expect(claimWitnessCeiling(mk(4), 3), "新加一条无人判 ⇒ 必须红").toMatchObject({ over: true, stale: false });
    expect(claimWitnessCeiling(mk(2), 3), "有人补了证人而帽没跟着调低 ⇒ 也要红").toMatchObject({ over: false, stale: true });
  });

  it("真仓那一趟：分母非零、存量在帽内、四态相加＝分母（这条尺不许恒红也不许空载）", () => {
    const srcScope = trackedExistingFiles(ROOT, "src");
    const files = srcScope.files.map((p) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));
    const testPaths = trackedExistingFiles(ROOT, "tests").files;
    const corpus = testPaths.map((p) => readFileSync(join(ROOT, p), "utf8"));
    const sites = scanClaimSites(files);
    const f = claimWitnessFindings(sites, corpus);
    const bind = bindClaimFaces(f, CLAIM_BINDINGS, {
      src: new Map(files.map((x) => [x.path, x.text])),
      tests: new Map(testPaths.map((p, i) => [p, corpus[i] ?? ""])),
    });
    expect(sites.length, "一个面都没扫到＝没有尺，不读成干净（规则 74）").toBeGreaterThan(0);
    expect(f.modelSites, JSON.stringify(f.byAudience)).toBeGreaterThan(0);
    // 守恒律：任何一格都不许从清单里静默消失——"不可知"必须显式存在，而不是并进别的态。
    // 第 314 页起分母拆成**四态**（原句证人／绑定／欠证人／挑不出段）；绑定那一态不许偷偷吞掉一格。
    expect(f.witnessed.length + bind.bound.length + bind.unwitnessed.length + f.noNeedle.length, JSON.stringify(f))
      .toBe(f.modelSites);
    expect(bind.bad, "登记表自己有病就不许接着数：" + bind.bad.join(" | ")).toEqual([]);
    const ceil = claimWitnessCeiling({ unwitnessed: bind.unwitnessed }, CLAIM_UNWITNESSED_CAP);
    expect(ceil.over, `欠证人的能力断言超出帽：\n${bind.unwitnessed.join("\n")}`).toBe(false);
    expect(ceil.stale, `现读 ${String(ceil.read)} 低于帽 ${String(ceil.cap)} ⇒ 把帽调下来（只准调低）`).toBe(false);
    expect(f.witnessed.length, "一条都没被判过＝这条尺没在工作").toBeGreaterThan(0);
  });

  describe("绑定通道：证人用了另一套词时，靠**执行端符号 + 点名用例**配对（第 314/317 页）", () => {
    // 四件成立条件各配一条**独立**用例：合在一条里，四枚锚点会全红在同一条上＝其中三枚没有分辨力。
    const face = "src/__probe.ts#say｜探针假句永远不覆盖既有转录记录";
    const srcText = 'function say(): string { return "探针假句永远不覆盖既有转录记录"; } const GATE_LAYERS = [];';
    // 夹具也得长成**真判卷的形状**：第 317 页起，"文件里某处出现过这个符号"不再算（注释里提一句不算判）。
    const testText = 'it("GATE_LAYERS 的逐型表：每一层都要有判定归属", () => {\n  expect(GATE_LAYERS.length).toBeGreaterThan(0);\n});\n';
    const material = {
      src: new Map([["src/__probe.ts", srcText]]),
      tests: new Map([["tests/__probe.test.ts", testText]]),
    };
    const owed: Pick<ClaimWitnessFindings, "unwitnessed"> = { unwitnessed: [face] };
    const b = {
      face, symbol: "GATE_LAYERS", testFile: "tests/__probe.test.ts",
      testCase: "GATE_LAYERS 的逐型表：每一层都要有判定归属", why: "夹具：符号两边都在，且点得出那一条用例",
    };

    it("四件事都成立 ⇒ 那一格从欠证人移到绑定，条数一增一减（不是凭空多出来的）", () => {
      const r = bindClaimFaces(owed, [b], material);
      expect(r.bound, "三件齐了还不认＝这条通道没在工作").toEqual([face]);
      expect(r.unwitnessed, "移过去的那一格不许仍留在欠证人清单里（双记＝帽可以靠它骗数）").toEqual([]);
      expect(r.bad, "成立的绑定不该上报病：" + r.bad.join(" | ")).toEqual([]);
      expect(r.bound.length + r.unwitnessed.length, "守恒：绑定的总数只能等于进来的条数").toBe(owed.unwitnessed.length);
    });

    it("缺第二件：那句所在的源文件里没有那个符号 ⇒ 仍算欠证人，并点名是这一件没成", () => {
      const r = bindClaimFaces(owed, [{ ...b, symbol: "NOT_A_REAL_SYMBOL" }], material);
      expect(r.bound, "句子背后没有这个开关，就不许把这一格销账").toEqual([]);
      expect(r.unwitnessed).toEqual([face]);
      expect(r.bad.join("\n")).toContain("没有 NOT_A_REAL_SYMBOL 这个符号");
    });

    it("缺第四件：符号在那份判卷里**有**、但不在被点名的那条用例**体内** ⇒ 仍算欠证人（旧口径放得过的形状）", () => {
      // 与下面那条「缺第五件」同一形状，取料面同样**不从现读清单里 find**（第 322 页一并改掉）：
      // 这一格的句子被人补上原句证人时，反例就会失去对象——红的是哨兵、判据本身没坏。
      // 句子那一半照本文件的惯例用「探针假句……」：抄真句＝自己给自己当证人（第 311/317 页实测）。
      const srcScope = trackedExistingFiles(ROOT, "src");
      const files = srcScope.files.map((p) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));
      const testPaths = trackedExistingFiles(ROOT, "tests").files;
      const corpus = testPaths.map((p) => readFileSync(join(ROOT, p), "utf8"));
      const realFace = "src/agent/sidechat.ts#SIDECHAT_SYSTEM｜探针假句：只测体内引用这一件";
      // 这条反例专挑**旧口径分辨不出**的形状：`promoteToMain` 在那份判卷里出现多次（文件级判据因此放行），
      // 但我点名的这条用例只查工具表，不调它 ⇒ 判据收到**用例体内**才会拒收。
      const judge = testPaths.map((p, i) => [p, corpus[i] ?? ""] as const).find(([p]) => p.endsWith("sidechat-core.test.ts"));
      expect(judge, "取料里该有那份判卷").toBeTruthy();
      expect((judge?.[1] ?? "").split("promoteToMain").length - 1, "这条反例的前提：那份判卷**整文件**确实提到这个符号")
        .toBeGreaterThan(0);
      expect(files.some((x) => x.path === "src/agent/sidechat.ts"), "反例那份源文件不在取料面里 ⇒ 先换反例别改判据")
        .toBe(true);
      const r = bindClaimFaces({ unwitnessed: [realFace] }, [{
        face: realFace, symbol: "promoteToMain", testFile: judge![0],
        testCase: "三个写向工具不在 sidechat 工具表里", why: "夹具：挑一条同文件里不相关、听起来却很像的用例",
      }], {
        src: new Map(files.map((x) => [x.path, x.text])),
        tests: new Map(testPaths.map((p, i) => [p, corpus[i] ?? ""])),
      });
      expect(r.bound).toEqual([]);
      expect(r.bad.join("\n"), "符号在源文件里（第二件过），但那条用例体内没用它（第四件不过）：" + r.bad.join(" | "))
        .toContain("那条用例体内没引用 promoteToMain");
      expect(r.unwitnessed).toEqual([realFace]);
    });

    it("缺第三件：指的那个「用例」在那份判卷里根本不存在 ⇒ 报的是标题找不到，不是符号找不到", () => {
      const r = bindClaimFaces(owed, [{ ...b, testCase: "这一条标题在夹具那份判卷里不存在" }], material);
      expect(r.bound, "标题都不存在就不许把这一格销账").toEqual([]);
      expect(r.unwitnessed).toEqual([face]);
      expect(r.bad.join("\n"), "登记表自己的病要点名到是哪一件：" + r.bad.join(" | "))
        .toContain("这条**用例标题**");
    });

    it("缺第五件（区分度）：符号在太多份判卷里出现过 ⇒ 直接拒收，哪怕其余四件都成立", () => {
      // 这一格的取料方式在第 321 页换过一次：**不再从现读的欠证人清单里 `find` 一个 `#run`**。
      // 那一页给 `remember.ts#run` 与 `write_file.ts#run` 补了原句证人 ⇒ 两格离开清单 ⇒ 反例当场失去对象，
      // 红的是这条哨兵（它当时报「现读里没有 #run 那一格」）、不是绑定通道——认证 7bb95b7 那趟就是这么炸的。
      // 一句会随补证人漂移的清单不能当判据的输入面（同族教训见规则 398「耦合要在耦合处修尺」）。
      // ①由合成清单满足；②③④仍拿真材料（符号确在那份源文件里、那条用例真存在且体内用了它），只有⑤该拒。
      // 句子那一半用本文件惯用的「探针假句……」——`claimBindingDefects` 只按 `｜` 前的路径取源文件，
      // 抄真句反而会让这一格自己给自己当证人（第 311/317 页实测），还会把顶包候选抬高一条。
      const srcScope = trackedExistingFiles(ROOT, "src");
      const files = srcScope.files.map((p) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));
      const testPaths = trackedExistingFiles(ROOT, "tests").files;
      const corpus = testPaths.map((p) => readFileSync(join(ROOT, p), "utf8"));
      const genericFace = "src/tools/write_file.ts#run｜探针假句：这一格只用来测区分度这一件";
      const m = {
        src: new Map(files.map((x) => [x.path, x.text])),
        tests: new Map(testPaths.map((p, i) => [p, corpus[i] ?? ""])),
      };
      expect(m.src.get("src/tools/write_file.ts"), "反例那份源文件不在取料面里 ⇒ 面搬家了，先换反例别改判据")
        .toBeTruthy();
      // 反例的前提要出声：`run` 这个符号确实满屏都是（否则⑤拦不住任何东西）
      const colliding = corpus.filter((t) => /(^|[^A-Za-z0-9_])run([^A-Za-z0-9_]|$)/u.test(t)).length;
      expect(colliding, "反例的前提就是这个符号满屏都是：" + String(colliding))
        .toBeGreaterThan(BINDING_SYMBOL_MAX_JUDGE_FILES);
      const r = bindClaimFaces({ unwitnessed: [genericFace] }, [{
        face: genericFace, symbol: "run", testFile: "tests/action-fusion.test.ts",
        testCase: "write and edit preserve separate receipts, run only configured lint, no extra tool calls",
        why: "夹具：②③④ 都拿真材料满足（那条用例体内确实用到 run），只看区分度这一件能不能拦住",
      }], m);
      expect(r.bound, "没有区分度的符号能配上的话，绑定通道就是一张随便填的空头支票").toEqual([]);
      expect(r.bad.join("\n"), "要点名到「没有区分度」这一件：" + r.bad.join(" | ")).toContain("没有区分度");
    });

    it("缺第一件：登记的那一格根本不在欠证人清单里 ⇒ 报成登记表自己的病，而不是悄悄多绑上一格", () => {
      const r = bindClaimFaces(owed, [{ ...b, face: "src/__probe.ts#say｜那句话早就有原句证人了" }], material);
      expect(r.bound, "清单里没有这一格 ⇒ 没有东西可以移").toEqual([]);
      expect(r.unwitnessed).toEqual([face]);
      expect(r.bad.join("\n"), "登记表烂了要出声：" + r.bad.join(" | ")).toContain("欠证人清单里没有这一格");
    });

    it("反向对照：把通道关掉（空表），现读那两条就得回到欠证人 ⇒ 上一条不是恒真", () => {
      const srcScope = trackedExistingFiles(ROOT, "src");
      const files = srcScope.files.map((p) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));
      const testPaths = trackedExistingFiles(ROOT, "tests").files;
      const corpus = testPaths.map((p) => readFileSync(join(ROOT, p), "utf8"));
      const f = claimWitnessFindings(scanClaimSites(files), corpus);
      const m = {
        src: new Map(files.map((x) => [x.path, x.text])),
        tests: new Map(testPaths.map((p, i) => [p, corpus[i] ?? ""])),
      };
      const off = bindClaimFaces(f, [], m);
      const on = bindClaimFaces(f, CLAIM_BINDINGS, m);
      expect(on.bound.length, "通道开着却一条都没绑上＝没在工作").toBeGreaterThan(0);
      expect(on.bad, "登记表里每条绑定都要过得了四件事，过了就别再报自己的病：" + on.bad.join(" | ")).toEqual([]);
      expect(off.unwitnessed.length - on.unwitnessed.length, "绑上的条数必须正好等于欠证人少掉的条数").toBe(on.bound.length);
    });
  });

    it("整句收下后不许再按片段重复计数——共用 walker 时虚高会串到对面", () => {
    const src = "function t(v: string): string { return `本探针不会抄 " + "${v} 也不会替你翻页`; }";
    const claim = scanClaimSites([{ path: "src/__probe.ts", text: src }]);
    expect(claim.length, "一句话记成两条＝分母虚高：" + JSON.stringify(claim.map((c) => c.text))).toBe(1);
    expect(claim[0]!.runs, "同一句里的两处能力断言都要能各配证人：" + JSON.stringify(claim[0]!.runs))
      .toEqual(["本探针不会抄", "也不会替你翻页"]);
    // 对面那把网（承诺网）必须维持**按片段**收：整句开关只对能力断言开。
    const promise = scanPromiseSites([
      { path: "src/__probe.ts", text: "function p(v: string): string { return `原文已存 " + "${v}，可回取`; }" },
    ]);
    expect(promise.length, "承诺网按片段收，两处措辞各一条：" + JSON.stringify(promise.map((c) => c.text))).toBe(2);
    expect(promise.every((c) => !c.text.includes("${")), "整句原文不许漏进承诺网的读数").toBe(true);
  });

  it("反向对照：往真仓那份源码里凭空加一句无人判的能力断言 ⇒ 帽当场被顶破（证明上一条不是恒真）", () => {
    const srcScope = trackedExistingFiles(ROOT, "src");
    const files = srcScope.files.map((p) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));
    const corpus = trackedExistingFiles(ROOT, "tests").files.map((p) => readFileSync(join(ROOT, p), "utf8"));
    const one = files.find((f) => f.path === "src/tools/web-search.ts") ?? files[0]!;
    // 那句**新加的**能力断言不能在本案正文里连成一段：判卷自己就是证人语料的一部分，
    // 整句逐字写在这儿 ⇒ 它会给自己造的那条断言作证（第一次跑就是这么"没顶破帽"的）。
    const addedSentence = ["探针假句永远不会", "把密钥写进日志"].join("");
    const withExtra = files.map((f) => (f.path === one.path
      ? { path: f.path, text: `${f.text}\nfunction __addedClaim(): string { return "${addedSentence}"; }\n` }
      : f));
    const base = claimWitnessFindings(scanClaimSites(files), corpus);
    const added = claimWitnessFindings(scanClaimSites(withExtra), corpus);
    const ceil = claimWitnessCeiling(added, CLAIM_UNWITNESSED_CAP);
    expect(ceil.over, "加了新面而帽没被顶破 ⇒ 这条判据恒真").toBe(true);
    expect(added.unwitnessed.length, `现读该恰好多一条（基线 ${String(base.unwitnessed.length)}）`).toBe(base.unwitnessed.length + 1);
    expect(added.unwitnessed.join("\n"), "新加的那条必须被点名").toContain("__addedClaim");
  });
});
