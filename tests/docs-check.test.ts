// docs-check 判据的单元测试（spec §6 的 D-1/D-3/D-5，spec 在
// docs/superpowers/specs/2026-09-19-doc-layer-budget-design.md）。
//
// 判据一律是**纯函数**：输入内存里的文件表 / 文本，输出 findings，不触真实仓库——
// 这样每条 D 都能双向断言（红相命中 + 反相不误伤），且不依赖工作树状态。
// 真实文件读取只发生在该模块的 main()，由 `pnpm docs-check` 承担。
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkCredentialSources, CREDLEDGER_FILE, CRED_UNNAMED_PAGE_CAP, credentialPages, credFaceFiles, LEDGER_FILE, ledgerRevFace, ledgerRevTokens,
  credRunShas, CRED_WEAK_WITNESS_CAP, UNSOURCED_CRED_PAGES,
  LEDGER_NON_REV, runDocsCheck, sourcedReadings, UNSOURCED_READINGS,
} from "../scripts/docs-check";
import { REPLAY_READINGS, countInlineReplay, type ReplayReading } from "../scripts/replay-readings";
import {
  checkAppendOnlyCorrections,
  checkBudget,
  checkDocBinaries,
  checkLineCitations,
  checkSourceLineCitations,
  checkObservedValues,
  checkPageNumberUniqueness,
  LEGACY_DUPLICATE_PAGES,
  checkReplay,
  checkStateRev,
  checkWitnessPaths,
  DOC_BUDGETS,
  LEGACY_SOURCE_CITATIONS,
  LEGACY_WAIVERS,
  LEGACY_WITNESS_REFS,
  ledgerWitnessRefs,
  ledgerPages,
  ANY_PAGE_HEAD,
  PAGE_HEAD_RE,
  trackedFilesAtHead,
  STATE_FILE,
  waive,
  waiverKey,
  type DocFile,
  type Finding,
  type SourceFile,
} from "../scripts/docs-check";

const f = (path: string, bytes: number): DocFile => ({ path, bytes });
const s = (path: string, text: string): SourceFile => ({ path, text });
const hit = (findings: readonly Finding[], rule: Finding["rule"]): Finding[] => findings.filter((x) => x.rule === rule);

describe("D-1 现行层字节预算", () => {
  it("超预算判红，且 detail 带实测字节数与预算值（红必须可诊断）", () => {
    const v = checkBudget([f("AGENTS.md", 9000)]);
    const d = hit(v, "D-1");
    expect(d).toHaveLength(1);
    expect(d[0]!.file).toBe("AGENTS.md");
    expect(d[0]!.detail).toContain("9000");
    expect(d[0]!.detail).toContain(String(DOC_BUDGETS["AGENTS.md"]));
  });

  it("恰好等于预算不判红（钉住「严格大于」——比较符翻成 >= 即红在此）", () => {
    expect(checkBudget([f("AGENTS.md", DOC_BUDGETS["AGENTS.md"]!)])).toHaveLength(0);
  });

  it("零字节判红（文件缺失不是合规，是空壳）", () => {
    expect(hit(checkBudget([f("STATE.md", 0)]), "D-1")).toHaveLength(1);
  });

  it("预算表只覆盖现行层：档案层与 archive/ 不在表内，故多大都不判红", () => {
    expect(Object.keys(DOC_BUDGETS).sort()).toEqual(["AGENTS.md", "STATE.md"]);
    expect(checkBudget([f("archive/progress.md", 10_000_000)])).toHaveLength(0);
  });
});

describe("D-3 文档指针禁用行号", () => {
  // 反例字面量集中在此：本文件本身就在 D-3 扫描面内，所以走**行级豁免标记**，
  // 不用字符串拼接把它拆开（本仓 theme.ts 的 DARK_QUERY 拆行躲 grep 是已归档的反面样例）。
  const CITE = "BLOCKED.md:432"; // docs-check:allow D-3 反例素材，此行不是文档指针
  const TWO = "PROGRESS.md:12 与 BLOCKED.md:7"; // docs-check:allow D-3 反例素材，同行两处命中

  it("源码引行号判红，file 报的是被扫描的源文件", () => {
    const v = checkLineCitations([s("scripts/core-check.ts", "// 已归档于 " + CITE + "。")]);
    const d = hit(v, "D-3");
    expect(d).toHaveLength(1);
    expect(d[0]!.file).toBe("scripts/core-check.ts");
    expect(d[0]!.detail).toContain(CITE);
  });

  it("标签式锚点不判红（改指法本身就是放行通道）", () => {
    expect(checkLineCitations([s("scripts/x.ts", "// 见 archive/blocked.md#sandbox-立案")])).toHaveLength(0);
  });

  it("代码文件的行号引用不判红（本判据只管文档指针）", () => {
    const v = checkLineCitations([s("scripts/y.ts", "// 口径见 app.js:1754 与 index.html:1498")]);
    expect(v).toHaveLength(0);
  });

  it("同一行两处各报一条（不得只报第一个）", () => {
    const v = checkLineCitations([s("scripts/z.ts", "// 见 " + TWO)]);
    expect(hit(v, "D-3")).toHaveLength(2);
  });

  it("空文本 / 无引用的真实源码不误伤", () => {
    expect(checkLineCitations([s("a.ts", ""), s("b.ts", 'export const x = 1;\n// README.md 里说明了')])).toHaveLength(0);
  });

  it("detail 带行号（红必须可定位）", () => {
    const text = "// l1\n// l2\n// l3\n// l4\n// l5\n// l6\n// 见 " + CITE + "\n";
    const d = hit(checkLineCitations([s("scripts/w.ts", text)]), "D-3");
    expect(d[0]!.detail).toContain("第 7 行");
  });

  // 反例素材类命中（本测试文件自己就是受害者）必须有**行级豁免标记**可走。
  // 不许靠拆字符串绕——本仓 theme.ts 的 DARK_QUERY 拆行躲 grep 是已归档的反面样例。
  it("同行带 docs-check:allow + 理由 → 放行", () => {
    const text = 'const bad = "BLOCKED.md:432"; // docs-check:allow 本文是 D-3 的反例素材\n';
    expect(checkLineCitations([s("tests/x.test.ts", text)])).toHaveLength(0);
  });

  // 反向那一格必须让"整份扫"真的能扫到：`ALLOW_MARK` 没有 `m` 旗标，`$` 只认输入末尾
  // ⇒ 标记写在**首行**时，`.exec(s.text)` 与 `.exec(line)` 在这份输入上等价（普查实测：那条锚点存活就是这原因）。
  // 所以标记要落在末行，且未豁免的引用留在它上面——这样"豁免整个文件"会少报两条，才是有分辨力的用例。
  it("豁免标记只保所在行，不豁免整个文件", () => {
    const text = 'const a = "BLOCKED.md:9";\nconst b = "STATE.md:3";\n// docs-check:allow 这只是文件末的一行标记，不该豁免上面两行';
    expect(hit(checkLineCitations([s("t.ts", text)]), "D-3")).toHaveLength(2);
  });

  it("标记后不写理由 → 不豁免（豁免必须可审计）", () => {
    const text = 'const b = "BLOCKED.md:9"; // docs-check:allow\n';
    expect(hit(checkLineCitations([s("t.ts", text)]), "D-3")).toHaveLength(1);
  });
});

describe("D-5 STATE.md 的 rev 必须是真提交", () => {
  const SHA = "c0a5dcf";
  const FULL = "208a456" + "0".repeat(33); // 40 位全 sha
  // 存在性判定注入成**谓词**：main() 用 git 解析（短 sha / 全 sha 都交给 git 定），
  // 纯函数本身不碰子进程——否则这条判据没法在单测里双向断言。
  const exists = (sha: string) => sha === SHA || sha === FULL;

  it("缺 rev 行 → 红（不静默放行）", () => {
    const d = hit(checkStateRev("# 现态\n正文", exists), "D-5");
    expect(d).toHaveLength(1);
    // 规则 302：断言的串必须是**生产者独有**的那半句。`"rev"` 这种短词在盘上有 41 个生产者
    // （`rev-parse`／`llm_review`…），换掉别处任何一句它都照绿 ⇒ 被 `prose-needle-scan` 数成
    // 顶包候选、把落库挡在帽外。取这句里只有 `checkStateRev` 产的那半截。
    expect(d[0]!.detail).toContain("首部必须写");
  });

  it("rev 指向不存在的提交 → 红（防伪引用，且 detail 带那个 sha）", () => {
    const d = hit(checkStateRev("rev: deadbeef", exists), "D-5");
    expect(d).toHaveLength(1);
    expect(d[0]!.detail).toContain("deadbeef");
  });

  it("rev 形状非法（非十六进制 / 短于 7 位）各判红", () => {
    expect(hit(checkStateRev("rev: ggggggg", exists), "D-5")).toHaveLength(1);
    expect(hit(checkStateRev("rev: c0a5dc", exists), "D-5")).toHaveLength(1);
  });

  it("合法且存在的 sha → 无 finding；带反引号与尾随空格也能认", () => {
    expect(checkStateRev("rev: " + SHA, exists)).toHaveLength(0);
    expect(checkStateRev("rev: `" + SHA + "`  \n", exists)).toHaveLength(0);
    expect(checkStateRev("rev: " + FULL, exists)).toHaveLength(0); // 全 sha 与短 sha 一视同仁
  });
});

describe("存量豁免棘轮（登记进门时不得顺手把老账全判红，但豁免必须会烂掉）", () => {
  const w = (upTo: number, reason = "存量，迁移时删") => ({ [waiverKey("D-1", "AGENTS.md")]: { upTo, reason } });
  const over = (bytes: number): Finding[] => checkBudget([f("AGENTS.md", bytes)]);

  it("D-1：实测在水位之内 → 不判红", () => {
    expect(waive(over(20_000), w(30_000)).kept).toHaveLength(0);
  });

  it("D-1：超过水位 → 红，且 detail 同时给实测与水位", () => {
    const d = waive(over(30_001), w(30_000)).kept;
    expect(d).toHaveLength(1);
    expect(d[0]!.detail).toContain("30001");
    expect(d[0]!.detail).toContain("水位 30000");
  });

  it("D-3：水位是**条数**——3 处命中配水位 3 全放，配水位 2 只放行前 2 处", () => {
    const three: Finding[] = [1, 2, 3].map((n) => ({ rule: "D-3", file: "scripts/x.ts", detail: `第 ${n} 行` }));
    const key = waiverKey("D-3", "scripts/x.ts");
    expect(waive(three, { [key]: { upTo: 3, reason: "存量" } }).kept).toHaveLength(0);
    const kept = waive(three, { [key]: { upTo: 2, reason: "存量" } }).kept;
    expect(kept).toHaveLength(1);
    expect(kept[0]!.detail).toContain("第 3 行");
    expect(kept[0]!.detail).toContain("超出存量豁免");
  });

  it("实测 0B（空壳）不被水位豁免——水位豁免的是存量违规的量，不是免死金牌", () => {
    const empty: Finding[] = [{ rule: "D-1", file: STATE_FILE, detail: "实测 0B", value: 0 }];
    const waived = waive(empty, { [waiverKey("D-1", STATE_FILE)]: { upTo: 6000, reason: "存量" } });
    expect(waived.kept).toHaveLength(1);
  });

  it("不写理由的豁免一律无效（豁免必须可审计）", () => {
    expect(waive(over(20_000), w(30_000, "  ")).kept).toHaveLength(1);
    expect(waive(over(20_000), {}).kept).toHaveLength(1);
  });

  it("水位已不再被命中 → 记 stale（豁免烂掉必须被清，不能静默留着）", () => {
    const r = waive([], w(30_000));
    expect(r.kept).toHaveLength(0);
    expect(r.stale).toEqual([waiverKey("D-1", "AGENTS.md")]);
  });

  it("本仓当前登记的存量豁免：每条都有理由、水位为正", () => {
    for (const [key, v] of Object.entries(LEGACY_WAIVERS)) {
      expect(v.reason.trim(), key + " 缺理由").not.toBe("");
      expect(v.upTo, key + " 水位必须为正").toBeGreaterThan(0);
    }
  });
});

describe("D-2 现行层禁手抄观测值", () => {
  const p = (path: string, ...lines: string[]): SourceFile => ({ path, text: lines.join("\n") });

  it("真实形状判红：~800s 的 test 门（这句不含任何「实测/耗时」字样也会漂 15 倍）", () => {
    const d = hit(checkObservedValues([p("AGENTS.md", "它紧接 ~800s 的 test 门，")]), "D-2");
    expect(d).toHaveLength(1);
    expect(d[0]!.detail).toContain("800");
    // 规则 302 同族：`"pnpm facts"` 有 2 个生产者（`scripts/facts.ts` 的说明句也含它）⇒ 取只有
    // `checkObservedValues` 产的那半截（`手抄了观测值` 全仓独此一处）。"给的是指针"那半由上一行
    // 800 与这一格共同钉住——指针字样归 `scripts/facts.ts` 自己证。
    expect(d[0]!.detail).toContain("手抄了观测值");
  });

  it("带比较符的规格阈值放行（≤1000ms 是契约不是观测）", () => {
    expect(checkObservedValues([p("AGENTS.md", "断言阈值（≤1000ms）一字未改")])).toHaveLength(0);
    expect(checkObservedValues([p("scripts/docs-check.ts", "L0 ≤8,000B、L1 ≤6,000B")])).toHaveLength(0);
  });

  it("配置规格值靠 [spec] 标记放行（CODE-WIKI 的「32KB 截断、60s 超时」就是这类）", () => {
    expect(checkObservedValues([p("docs/CODE-WIKI.md", "输出 32KB 截断、60s 超时强杀 [spec]")])).toHaveLength(0);
    expect(hit(checkObservedValues([p("docs/CODE-WIKI.md", "输出 32KB 截断、60s 超时强杀")]), "D-2")).toHaveLength(1);
  });

  it("只有受管现行页参与判定：archive/ 与 specs/ 与源码都不判", () => {
    const obs = "耗时 33s vs 全量链路 193s";
    expect(checkObservedValues([p("archive/progress.md", obs)])).toHaveLength(0);
    expect(checkObservedValues([p("docs/superpowers/specs/2026-09-19-x.md", obs)])).toHaveLength(0);
    expect(checkObservedValues([p("src/agent/loop.ts", obs)])).toHaveLength(0);
    expect(hit(checkObservedValues([p("AGENTS.md", obs)]), "D-2")).toHaveLength(1);
  });

  it("detail 带行号（可定位）", () => {
    const text = ["第一行", "第二行", "第三行", "第四行", "第五行", "第六行", "实测 251.8ms"].join("\n");
    expect(hit(checkObservedValues([p("AGENTS.md", text)]), "D-2")[0]!.detail).toContain("第 7 行");
  });
});

describe("D-4 现行层禁「就地追注代替改写」", () => {
  it("追注模式判红，并给出合规改法", () => {
    const d = hit(checkAppendOnlyCorrections([
      { path: "AGENTS.md", text: "上面那句已过期，但当日快照不得改写。\n" },
    ]), "D-4");
    expect(d).toHaveLength(1);
    // 规则 302 同族：`"STATE.md"` 在 `src/agent/compaction.ts` 里也产 ⇒ 取只有
    // `checkAppendOnlyCorrections` 产的那半截。
    expect(d[0]!.detail).toContain("过期字随写消失");
  });

  it("档案层正是这类字的归宿，不判红", () => {
    expect(checkAppendOnlyCorrections([
      { path: "archive/progress.md", text: "上面那句已过期（该日快照，改写即伪造历史）。\n" },
    ])).toHaveLength(0);
  });

  it("普通叙述不误伤（带日期不等于追注）", () => {
    expect(checkAppendOnlyCorrections([
      { path: "AGENTS.md", text: "这条规矩 2026-09-19 由领导裁决。\n" },
    ])).toHaveLength(0);
  });
});

describe("D-7 docs/ 不留二进制", () => {
  it("聚合成一条 finding，value = 文件数", () => {
    const d = hit(checkDocBinaries(["docs/a.png", "docs/sub/b.png", "docs/c.jpeg"]), "D-7");
    expect(d).toHaveLength(1);
    expect(d[0]!.value).toBe(3);
    expect(d[0]!.detail).toContain("3");
  });

  it("docs 之外的二进制不管（截图该落 outputs/ 或 archive/）", () => {
    expect(checkDocBinaries(["outputs/x.png", "archive/y.png", "src/z.svg"])).toHaveLength(0);
  });

  it("零文件不判红（否则等于要求 docs 里永远有图）", () => {
    expect(checkDocBinaries([])).toHaveLength(0);
  });
});

/* D-8 复跑面可信赖。四条判据各测正反两相：本判据的存在理由是「文档说有、盘上其实没有」，
   而这类腐在"全绿"里最难看见——所以每一条都要能红，也要能在正常形状上不误伤。 */
describe("D-8 复跑面登记表与引用对账", () => {
  const reg: readonly ReplayReading[] = [{ id: "ask-density", script: "scripts/replay/ask-density.ts", answers: "ask 密度" }];
  const hasFile = (rel: string): boolean => rel === "scripts/replay/ask-density.ts";

  it("引用了未登记的 id ⇒ 红，且 detail 点名那个 id", () => {
    const f = checkReplay([{ path: "docs/x.md", text: "跑 <!-- replay:no-such --> 这条" }], hasFile, reg);
    // 两条都是真红：① 那句引用无源；② 顺带暴露 ask-density 这次没人引用（陈旧登记）。
    // 只期望一条会把"同一页同时犯两种错"的形状吞掉——那是本判据最该看见的复合情形。
    expect(f).toHaveLength(2);
    const ref = f.find((x) => x.file === "docs/x.md");
    expect(ref?.detail).toContain("no-such");
    expect(ref?.rule).toBe("D-8");
    expect(f.find((x) => x.file === "scripts/replay/ask-density.ts")?.detail).toContain("没有任何文档引用");
  });

  it("登记的 id 被某页真引用 ⇒ 不报（反向：判据不能只认红）", () => {
    const f = checkReplay([{ path: "docs/x.md", text: "node --import tsx scripts/replay/ask-density.ts <!-- replay:ask-density -->" }], hasFile, reg);
    expect(f).toHaveLength(0);
  });

  it("登记了却没人引用 ⇒ 红（陈旧登记，与上一条反向）", () => {
    const f = checkReplay([{ path: "docs/x.md", text: "一句普通话，没引用也没 heredoc" }], hasFile, reg);
    expect(f.map((x) => x.file)).toEqual(["scripts/replay/ask-density.ts"]);
  });

  it("登记项指向的脚本不在盘上 ⇒ 红（改名/删文件忘撤表）", () => {
    const f = checkReplay([{ path: "docs/x.md", text: "<!-- replay:ask-density -->" }], () => false, reg);
    expect(f.some((x) => x.detail.includes("不在盘上"))).toBe(true);
  });

  it("内联 heredoc 复跑块按文件出一条（不过编译 ⇒ 形状一 drift 就静默失效）", () => {
    // **这两条必须带 fences**：D-8 问的是「文档教人粘的那一串」。旧尺是裸全文匹配，
    // 于是正文里**引用**一句 `node --import tsx -e` 也被判成块——2026-09-28 `PROGRESS.md`
    // 上就是一条这种引用把闸打红的（那页全文 0 个真块）。尺改成围栏感知后，
    // 下面这条若不补 fences 就会转绿，而它**不该**转绿：真块还得抓得到。
    const fenced = '```bash\nnode --import tsx -e "$(cat <<TS\nx\nTS\n)"\nnode --import tsx -e 又一条\n```';
    const f = checkReplay([{ path: "docs/y.md", text: fenced }], hasFile, []);
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain("2");
    expect(f[0]!.file).toBe("docs/y.md");
  });

  it("正文里**提到**那条命令不算复跑块，一字不差搬进围栏才算（同一句、两种语境，结论换人）", () => {
    // 病灶原文（抄自 PROGRESS.md 那次误报本体——2026-09-28 它把 docs-check 打红的就是这一句）。
    // 不写行号：行号随重排漂掉，D-3 正是为这件事立的。
    const mentioned = "⇒ 计数一律从**对象**取（我随后那条 `node --import tsx -e` 直接 import `REPLAY_READINGS` 逐条印）";
    expect(countInlineReplay(mentioned), "正文里的引用被算成块 = 旧尺那个误报").toBe(0);
    // 对照支：**同一个字符串**包一层 fences ⇒ 结论必须翻过来，否则这把尺等于废了。
    expect(countInlineReplay("```bash\n" + mentioned + "\n```")).toBe(1);
  });

  it("围栏扫描的边界：闭合须同类且不短于开启的那条；未闭合的块照样算（fences 写坏时判卷不许跟着瞎）", () => {
    expect(countInlineReplay("~~~\nnode --import tsx -e 一条\n```\n")).toBe(1); // ~~~ 不被 ``` 闭合 ⇒ 延伸到文末
    expect(countInlineReplay("````\nnode --import tsx -e 一条\n```\n")).toBe(1); // 四反引号里，三反引号是**内容**不是闭合（CommonMark）
    expect(countInlineReplay("```\nnode --import tsx -e 一条\n``` 收尾\n")).toBe(1); // 闭合围栏后有正文 ⇒ 不是闭合
    // 反相：块在四反引号里真的闭合了，块外那行不算——否则「关掉围栏就不算」这条会被人反着用。
    expect(countInlineReplay("````\n````\nnode --import tsx -e 块外\n")).toBe(0);
  });

  it("真登记表里每条脚本都真在盘上（防「表写了、文件没了」这一格没人看）", () => {
    const root = join(import.meta.dirname, "..");
    for (const r of REPLAY_READINGS) expect(existsSync(join(root, r.script)), r.script).toBe(true);
  });

  it("迁移后无存量豁免：内联复跑块直接判红", () => {
    expect(Object.keys(LEGACY_WAIVERS)).toHaveLength(0);
    // 输入带 fences（尺改成围栏感知之后）：这里要证的是「没有存量豁免、真块直接红」，
    // 断言一个字没动。上面那条已证「正文里的引用不算块」，两支合起来才是这把尺的完整形状。
    const findings = checkReplay(
      [{ path: "docs/new.md", text: "```bash\nnode --import tsx -e x\n```" }],
      () => false,
      [],
    );
    expect(waive(findings).kept.map((f) => f.file)).toEqual(["docs/new.md"]);
  });
});

/* ── 第 227 页（#32）：D-5 的第二张面——台账里的 sha 引用指不指得到一笔真提交。
      `STATE.md` 迁移前那条面整条不跑，于是这仓里几百条 sha 引用一个证人都没有。 ── */
describe("D-5 台账 sha 面：三档分开印（可达／不可达／读不到）", () => {
  /** 假 git：名单里给了什么就是什么可达——纯函数不许碰子进程，双向断言靠这里喂。 */
  const resolver = (reachable: readonly string[]) => (toks: readonly string[]): Map<string, boolean> | null =>
    new Map(toks.map((t) => [t, reachable.includes(t)]));

  it("可达不报；不可达且没有豁免 ⇒ 红，且 detail 带行号与 sha", () => {
    const text = ["第 1 页 凭证 @aaaa111 已过", "第 2 页 引用 bbb2222 那笔", ""].join("\n");
    const face = ledgerRevFace(text, resolver(["aaaa111"]));
    expect(face.checked, "分母＝抽到的候选数（不是 findings 数）").toBe(2);
    expect(face.skipped, "读得到面就不许报『未检』").toBeNull();
    // 这份合成台账里没有那三个哈希 ⇒ stale 那三条也在 findings 里，正是下面那条用例专门钉的东西。
    const reds = face.findings.filter((f) => f.detail.includes("指向不存在的提交"));
    expect(reds.map((f) => f.detail)).toEqual(["第 2 行引用的 sha 指向不存在的提交：bbb2222"]);
    expect(reds[0]?.rule).toBe("D-5");
    expect(reds[0]?.file).toBe(LEDGER_FILE);
  });

  it("形状修法：跟在 `=` 后面的数字不算候选（`--budget-ms=2400000` 曾被读成假 sha）", () => {
    const toks = ledgerRevTokens("第一次我写的是 `--budget-ms=2400000`，机器退 2\n").map((t) => t.sha);
    expect(toks).toEqual([]);
    // 反向那一半：同一个 7 位串独立成词时必须仍是候选（否则"排除 ="会变成吞掉一切）
    expect(ledgerRevTokens("凭证 2400000 那笔\n").map((t) => t.sha)).toEqual(["2400000"]);
  });

  it("豁免只挡名单里那三个；名单里不再命中的那条要报 stale 红（不许静默留着）", () => {
    // 条数**跟着表走**，不写死某个数字：豁免表是逐条带理由增删的（只准调低、不再命中即报 stale），
    // 把条数钉成 3 等于让「新增一条合法豁免」必须来改判卷——那是判据与判卷的虚假耦合，
    // 而且会让下一个人以为「豁免表应该永远是三条」。本格要问的是**逐条机制**，不是某条目的数量。
    const waived = Object.keys(LEDGER_NON_REV);
    expect(waived.length, "豁免表空了 ⇒ 那条 stale 机制就没人验了").toBeGreaterThan(0);
    const text = waived.map((s) => `判卷 sha256 三件套（${s}…）`).join("\n");
    expect(ledgerRevFace(text, resolver([])).findings).toEqual([]);
    const stale = ledgerRevFace("第 1 页 凭证 @cccc333\n", resolver(["cccc333"]));
    // 断言**不抄生产那句句子**（规则 302：抄成品句＝判卷与被度量者一起改才响，`prose-needle-scan` 会把这种
    // 形状数成"顶包候选"——本笔就被它按帽挡过一次）。这里只问结构事实：每个被豁免的 sha 各出一条红、
    // 且红落在台账面上；措辞归生产端自己钉（本文件里只留一处措辞证人）。
    for (const sha of waived) {
      const hits = stale.findings.filter((f) => f.detail.includes(sha));
      expect(hits.length, `${sha} 不再在场，该有一条点名它的红`).toBe(1);
      expect(hits[0]?.rule).toBe("D-5");
      expect(hits[0]?.file).toBe(LEDGER_FILE);
    }
    expect(stale.findings.length, "红数恰等于豁免条数（多一条就是把别的格也算进来了）").toBe(waived.length);
  });

  it("git 读不到（或行数对不上）⇒ 记未检并带着分母，不记通过（规则 261）", () => {
    const face = ledgerRevFace("凭证 @dddd444 与 @eeee555\n", () => null);
    expect(face.findings.filter((f) => f.detail.includes("指向不存在"))).toEqual([]);
    expect(face.skipped).toContain("未检，不等于通过");
    expect(face.skipped).toContain("2");
    expect(face.checked).toBe(2);
  });

  it("抽到 0 条候选同样记未检——『一条都没有』与『都没有问题』不许同形", () => {
    const face = ledgerRevFace("# 台账\n这页没有一个 sha。\n", resolver([]));
    expect(face.checked).toBe(0);
    expect(face.skipped).toContain("一个 sha 候选都没抽到");
  });

  it("真机：吃真 PROGRESS.md 与真 git ⇒ 分母 ≥ 200 且除豁免外零红", () => {
    const text = readFileSync(fileURLToPath(new URL("../PROGRESS.md", import.meta.url)), "utf8");
    const face = ledgerRevFace(text, (toks) => {
      const out = execFileSync("git", ["cat-file", "--batch-check=%(objecttype)"], {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        input: toks.map((t) => t + "^{commit}").join("\n") + "\n",
        encoding: "utf8",
      });
      const lines = out.split("\n").filter((l) => l !== "");
      if (lines.length !== toks.length) return null;
      return new Map(toks.map((t, i) => [t, lines[i]!.trim() === "commit"]));
    });
    expect(face.checked, `台账只抽到 ${String(face.checked)} 条 ⇒ 取料面或正则坏了`).toBeGreaterThanOrEqual(200);
    expect(face.skipped).toBeNull();
    expect(face.findings.map((f) => f.detail)).toEqual([]);
  });
});

/* ── 第 228 页（#46）：D-9 凭证页 ↔ 取料面对账。立它的现读：26 张能对上目录的凭证页里，严格式抽到 59 个读数，
      其中 4 个（第 155 页 3 个、第 207 页 1 个）在页自己点名的目录里找不到原文 ⇒ 凭证回查不了就等于没凭证。 ── */
describe("D-9 凭证对账：三档（可比对／未点名＝未检／取不到＝未检）不许同形", () => {
  const page = (dirs: string[], nums: string[]): string =>
    `### 2026-09-30 · 第 900 页 凭证：测试页\n\n取料：${dirs.map((d) => `outputs/${d}/`).join("、")}\n`
      + nums.map((n) => `Test Files ${n} passed`).join("｜") + "\n";

  /** 假取料面：目录名 → 目录里的文件；null／缺失表示"目录读不到"。
   *  第 269 页起契约是**按文件**交（从前交一整块拼好的文本）——弱证那一档要问「是哪份文件替这个数作的证」，
   *  拼完就问不出来了。这里的单文件没有身份行 ⇒ 走「证人无身份行＝无从判」那一态。 */
  const face = (map: Record<string, string | null>) => (dir: string): { name: string; text: string }[] | null => {
    const text = map[dir];
    return text === undefined || text === null ? null : [{ name: "face.log", text }];
  };

  it("点了名且数在面里 ⇒ 可比对计数涨、零红", () => {
    const r = checkCredentialSources(credentialPages(page(["x-2026-09-30"], ["253"])), face({ "x-2026-09-30": "Test Files 253 passed" }), {});
    expect(r.checked).toBe(1);
    expect(r.findings).toEqual([]);
  });

  it("取料目录名按 `YYYY-MM-DD` 认，月份不许钉死（第 257 页：跨月那天整类凭证静默失检）", () => {
    /* 分辨力全在 10 月那一条上：正则从前是 `[A-Za-z0-9._-]+-2026-09-\d{2}`，跨过 9 月之后凡是点名
       `outputs/<主题>-2026-10-XX/` 的凭证页都抽不到目录 ⇒ 整页被归进「未点名取料目录＝未检」，
       而门照旧印「红 0」。本仓既有 D-9 判卷清一色喂 `-2026-09-30` 的假件，所以这个盲区是结构上注定的
       （规则 237/242：计数尺要先喂真机、合成输入要显式跑出两态不同形）。 */
    const oct = credentialPages(page(["x-2026-10-01"], ["253"]));
    expect(oct[0]?.dirs, "10 月点名的取料目录抽不到 ⇒ 这一页一个字都不回查，而门不会为此出声").toEqual(["x-2026-10-01"]);
    expect(checkCredentialSources(oct, face({ "x-2026-10-01": "Test Files 253 passed" }), {}).checked).toBe(1);
    // 同一句式在 9 月名下也要成立——只把常量从 09 换成 10 的话，这一条当场红
    expect(credentialPages(page(["x-2026-09-30"], ["253"]))[0]?.dirs).toEqual(["x-2026-09-30"]);
    // 负控：没有日期后缀的目录**不该**被当取料面（`outputs/notes/` 那类是脚本/说明目录，
    // 把它算进来会拿不相干内容凑出"找到了"，把真缺原文的读数读成绿）
    expect(credentialPages(page(["notes"], ["253"]))[0]?.dirs).toEqual([]);
  });

  it("点了名而面里找不到 ⇒ 红，且 detail 带页号、缺的数与点名的目录", () => {
    const r = checkCredentialSources(credentialPages(page(["x-2026-09-30"], ["253"])), face({ "x-2026-09-30": "Test Files 999 passed" }), {});
    expect(r.checked).toBe(1);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.rule).toBe("D-9");
    expect(r.findings[0]?.file).toBe(CREDLEDGER_FILE);
    expect(r.findings[0]?.detail).toContain("253");
    expect(r.findings[0]?.detail).toContain("x-2026-09-30");
  });

  it("数位边界：面里只有 2410 时，读数 241 不算找到（本笔第一版就是拿 `includes` 比的，三条误判成「已入库」）", () => {
    const r = checkCredentialSources(credentialPages(page(["x-2026-09-30"], ["241"])), face({ "x-2026-09-30": "Test Files 2410 passed" }), {});
    expect(r.findings).toHaveLength(1);
    // 反向那一半：位数一样的真原文必须算找到（否则这条边界会把整面判成红海）
    const ok = checkCredentialSources(credentialPages(page(["x-2026-09-30"], ["241"])), face({ "x-2026-09-30": "Test Files 241 passed" }), {});
    expect(ok.findings).toEqual([]);
  });

  it("页没点名目录＝未检：不红，但要进那一只分母；同页的豁免不许被误报成 stale", () => {
    const pages = credentialPages(page([], ["241"]));
    // 帽显式给 9：本笔把现读帽降到 0，而这条测的是「未检那一档不红、豁免不误报 stale」，不是帽。
    const r = checkCredentialSources(pages, face({}), { "第 900 页|241": "迁移前的老页" }, 9);
    expect(r.findings, "未检这一档不该产出红，也不该把仍然用得上的豁免报成该删").toEqual([]);
    expect(r.unnamed).toBe(1);
    expect(r.checked).toBe(0);
  });

  it("点了名但目录读不到＝取不到：同样不红、同样进分母（与「没有对不上」分开）", () => {
    const r = checkCredentialSources(credentialPages(page(["gone-2026-09-30"], ["7"])), face({}), {});
    expect(r.findings).toEqual([]);
    expect(r.unmatched).toBe(1);
    expect(r.checked).toBe(0);
  });

  it("豁免只挡它自己那一条；同页另一个没登记的数照样红；已被取料面顶住的那条要报该删", () => {
    const pages = credentialPages(page(["x-2026-09-30"], ["241", "999"]));
    const r = checkCredentialSources(pages, face({ "x-2026-09-30": "nothing here" }), { "第 900 页|241": "登记过的不可回查" });
    expect(r.checked).toBe(2);
    expect(r.findings.map((f) => f.detail)).toEqual([expect.stringContaining("999")]);
    const sourced = checkCredentialSources(pages, face({ "x-2026-09-30": "Test Files 241 passed" }), { "第 900 页|241": "已经入库了" });
    expect(sourced.findings.map((f) => f.detail).join("\n")).toContain("已被取料面顶住");
    expect(sourced.findings).toHaveLength(2);   // 一条"该删"＋一条 999 的真红
  });

  it("真仓：可比对分母 ≥ 50、红只剩登记过的那些（三档各有多少要印出来）", () => {
    /* 第 271 页起这条走**生产接线**（`runDocsCheck` 里那一次注入登记表与两张帽）：
       从前这里自带一个取料器＝判卷多开了一条消费者，登记表加一页它就整体红（第 271 页实测 10 条红全这么来的）。 */
    const cred = runDocsCheck().cred;
    expect(cred.checked, `可比对只有 ${String(cred.checked)} 个 ⇒ 取料面塌了`).toBeGreaterThanOrEqual(50);
    expect(cred.findings.map((f) => f.detail)).toEqual([]);
    expect(Object.keys(UNSOURCED_READINGS).length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("未点名要按页记名：同一页的两个段合成一页，点名的页不许混进这一档", () => {
    const twoSections = "### 2026-10-01 · 第 900 页补 凭证：第一段\n\nTest Files 1 passed\n\n"
      + "### 2026-10-01 · 第 900 页补 凭证：第二段\n\nTest Files 2 passed\n\n"
      + "### 2026-10-01 · 第 901 页补 凭证：点名的那页\n\n取料：outputs/y-2026-10-01/\nTest Files 3 passed\n";
    const pages = credentialPages(twoSections);
    expect(pages).toHaveLength(3);
    const r = checkCredentialSources(pages, face({ "y-2026-10-01": "Test Files  3 passed" }), {});
    expect(r.unnamedPages, "按页＝第 900 页只算一次；按段＝两次 ⇒ 帽要量的是「有几页没点名」，不是「有几段」").toEqual(["第 900 页"]);
    expect(r.unnamed, "条数那一档口径不动（两页各一条 ⇒ 2）").toBe(2);
    expect(r.checked, "点名的页照常进体检").toBe(1);
  });

  it("帽只在超出那一格出声：等于现读不红、多一页就红，且 detail 点名是哪一页", () => {
    const pages = credentialPages(page([], ["241"]));
    const atCap = checkCredentialSources(pages, face({}), {}, 1);
    expect(atCap.findings, "帽登记＝现读；等于现读就红的话这一格永远红，没人能把它降下来").toEqual([]);
    const overCap = checkCredentialSources(pages, face({}), {}, 0);
    expect(overCap.findings, "多出一页（写了凭证却没点名取料面）必须让这一格出声，否则它只会安静地长在未检那一档里").toHaveLength(1);
    expect(overCap.findings[0]?.rule).toBe("D-9");
    expect(overCap.findings[0]?.detail).toContain("第 900 页");
    expect(overCap.findings[0]?.detail).toContain("CRED_UNNAMED_PAGE_CAP");
  });

  /* ── 第 269 页：数对上了，还要问「是哪份文件替它作的证、那一趟是不是本页的」。
        立它的现读：真仓 179 个可比对读数里，8 对的证人属于别趟（第 226 页 `real 158.55s`＝合法跨趟引用没写 sha；
        第 255 页声称认证 `10bf910`，可面上唯一的日志印的是 `目标提交：3b3d001`）。 ── */
  it("弱证三态：证人身份与本页对上＝强证；对不上＝弱证并点名文件与那一趟；证人没有身份行＝第三态", () => {
    const foreign = [{ name: "head-cert-abcdef1.log", text: "目标提交：abcdef1\nTest Files 253 passed" }];
    const weak = checkCredentialSources(credentialPages(page(["x-2026-09-30"], ["253"])), () => foreign, {}, 99, 8);
    expect(weak.weak, `数在面上确有原文，但证人那一趟不属于本页 ⇒ 该出声，实际：${JSON.stringify(weak.weak)}`).toHaveLength(1);
    expect(weak.weak[0]?.files).toEqual(["x-2026-09-30/head-cert-abcdef1.log"]);
    expect(weak.weak[0]?.runs).toEqual(["abcdef1"]);
    expect(weak.checked, "弱证照样进可比对分母（这一档问的是证人身份，不是有没有原文）").toBe(1);

    const own = [{ name: "head-cert-abcdef1.log", text: "目标提交：abcdef1\nTest Files 253 passed" }];
    const strong = checkCredentialSources(
      credentialPages("### 2026-09-30 · 第 900 页 凭证：本笔（`abcdef1`）认证 253 文件\n\n取料：outputs/x-2026-09-30/\nTest Files 253 passed\n"),
      () => own, {}, 99, 0);
    expect(strong.weak, "证人就是本页那一趟 ⇒ 强证，不该占用弱证的帽").toEqual([]);

    const noId = checkCredentialSources(credentialPages(page(["x-2026-09-30"], ["253"])), () => [{ name: "judges.log", text: "Test Files 253 passed" }], {}, 99, 0);
    expect(noId.weak, "判不出来就当弱证 ⇒ 帽会被没有身份行的日志灌满").toEqual([]);
    expect(noId.weakUnjudged, "第三态要单独出声，不许被读成『都已核对』").toBe(1);
  });

  it("未点名要拆两态：登记过的页离开『可行动』，没登记的才受帽管", () => {
    const long = "2026-09-27 那趟汇总只落 /tmp，没随页入库；10-01 扫 814 份 dated 文件零证人。";
    const pages = credentialPages(page([], ["241"]));
    const open = checkCredentialSources(pages, face({}), {}, 0, 0, {});
    expect(open.unnamedPages, "没登记＝可行动，必须留在帽那一档").toEqual(["第 900 页"]);
    expect(open.unnamed, "条数也跟着只算可行动那一半").toBe(1);
    const registered = checkCredentialSources(pages, face({}), {}, 0, 0, { "第 900 页": long });
    expect(registered.unnamedPages, "登记之后不许再占可行动那一档，否则这一格永远降不到 0").toEqual([]);
    expect(registered.registeredPages).toEqual(["第 900 页"]);
    expect(registered.registeredReadings, "登记页的读数要单列报数，不许静默消失").toBe(1);
    expect(registered.findings, "理由够长、登记有效 ⇒ 不该红").toEqual([]);
  });

  it("页级登记的两半 stale 都要出声：这页真点名了目录、或整段没了；理由太短也算没登记", () => {
    const short = "理由太短";
    const long = "当轮日志只落 /tmp；2026-10-01 用 sweep 扫全仓 dated 面零证人，故登记不可回查。";
    const named = credentialPages("### 2026-09-30 · 第 900 页 凭证：测试页\n\n取料：outputs/x-2026-09-30/\nTest Files 241 passed\n");
    const stillNamed = checkCredentialSources(named, face({ "x-2026-09-30": "Test Files 241 passed" }), {}, 0, 0, { "第 900 页": long });
    expect(stillNamed.findings.map((f) => f.detail).join("\n"), "登记页后来真的点名了 ⇒ 登记该删（双向棘轮，规则 302）").toContain("已被它自己点名的取料目录顶住");
    const gone = checkCredentialSources(credentialPages(page([], ["241"])), face({}), {}, 0, 0, { "第 901 页": long });
    expect(gone.findings.map((f) => f.detail).join("\n"), "登记的页在台账里已经不命中 ⇒ 不许静默留着").toContain("在台账里已不再命中（没有读数或整段没了），该删");
    const thin = checkCredentialSources(credentialPages(page([], ["241"])), face({}), {}, 0, 0, { "第 900 页": short });
    expect(thin.findings.map((f) => f.detail).join("\n"), "空话式登记等于没登记").toContain("理由只有");
  });

  it("弱证不许过度主张：面上既有别趟的原文、也有没印身份行的原文 ⇒ 这一格算『无从判』", () => {
    /* 第 270 页把这条判据收紧了一格。从前只要"有任何带身份行的证人不属于本页"就记弱证，
       于是本页最可能的出处（判卷日志、needles 日志——它们压根不印提交号）被别趟的 cert 日志顶掉了：
       现读 8 对弱证里有 3 对是这个形状。改完 8→5，再补上跨趟引用的提交号才归零。 */
    const mixed = () => [
      { name: "judges.log", text: "Test Files 253 passed" },
      { name: "head-cert-abcdef1.log", text: "目标提交：abcdef1\nTest Files 253 passed" },
    ];
    const r = checkCredentialSources(credentialPages(page(["x-2026-09-30"], ["253"])), mixed, {}, 99, 0);
    expect(r.weak, `那条没身份的日志本来就是最可能的出处，拿别趟的日志指控它＝尺的过度主张：${JSON.stringify(r.weak)}`).toEqual([]);
    expect(r.weakUnjudged, "第三态要接住这种混合面，否则它哪儿都不去、静默消失").toBe(1);
  });

  it("弱证帽只在超出时出声，且 detail 点名是哪一页、哪个数、哪份证人", () => {
    const faceFn = () => [{ name: "head-cert-abcdef1.log", text: "目标提交：abcdef1\nTest Files 253 passed" }];
    const pages = credentialPages(page(["x-2026-09-30"], ["253"]));
    expect(checkCredentialSources(pages, faceFn, {}, 99, 1).findings, "帽＝现读；等于现读就红的话这一格永远红，没人能降下来").toEqual([]);
    const over = checkCredentialSources(pages, faceFn, {}, 99, 0);
    expect(over.findings).toHaveLength(1);
    expect(over.findings[0]?.rule).toBe("D-9");
    expect(over.findings[0]?.detail).toContain("第 900 页");
    expect(over.findings[0]?.detail).toContain("CRED_WEAK_WITNESS_CAP");
    expect(over.findings[0]?.detail).toContain("head-cert-abcdef1.log");
  });

  it("身份只认门自己印的两行结构化形状（带 ANSI 也要认）；散文里提到 sha 不算身份", () => {
    const ESC = String.fromCharCode(27);
    expect(credRunShas("目标提交：2068d6c（--at=HEAD）")).toEqual(["2068d6c"]);
    expect(credRunShas("已核：TREE=" + "d".repeat(40) + "｜判卷四面在飞 0 项")).toEqual(["ddddddd"]);
    expect(credRunShas(`${ESC}[1m目标提交：${ESC}[0mabcdef1`), "入库日志的转义正好夹在关键词与 sha 之间").toEqual(["abcdef1"]);
    expect(credRunShas("隔壁那笔 1748ca7 的 H7 没登记"), "散文里的 sha 不能冒充这份工件的身份（第 268 页：我自己的探针日志原样印出台账 sha 过一次）").toEqual([]);
  });

  it("页侧提交号从段体抽：本笔那个要进集合，日期与短 token 不算", () => {
    const p = credentialPages("### 2026-10-01 · 第 902 页 凭证：本笔（`12b1931`）认证 259 文件\n\n取料：outputs/x-2026-10-01/\nTest Files 5 passed\n")[0]!;
    expect(p.shas).toContain("12b1931");
    expect(p.shas, "日期各段都短于 7 位，不该被当成 sha；否则每个页都自带一堆假身份").toEqual(["12b1931"]);
  });

  it("严格式要认 vitest 的列对齐形状：两个空格与一个空格的汇总行都得抽到数", () => {
    /* 真机上 vitest 印的是 `Test Files  1 passed (1)`（两个空格），从前正则写死一个空格 ⇒
       真读数一条都抽不到，页里那些数只能靠回查端的裸数位边界偶然兜住（第 265 页现读：4 条）。
       反向那一半在下面：一空格形状照样要抽到，否则把 `\s+` 退回一个空格这一条不会红。 */
    const twoSpace = credentialPages("### 2026-10-01 · 第 902 页 凭证\n\nTest Files  253 passed (253)\nTests  102 passed (102)\n");
    expect(twoSpace[0]?.numbers).toEqual(["102", "253"]);
    const oneSpace = credentialPages("### 2026-10-01 · 第 902 页 凭证\n\nTest Files 253 passed\n");
    expect(oneSpace[0]?.numbers).toEqual(["253"]);
  });

  it("严格式认「本趟墙钟」那一档：门自己报的那一格要能进对账面，散文里说墙钟不算（第 267 页）", () => {
    const got = credentialPages("### 2026-10-01 · 第 903 页 凭证\n\n本趟墙钟 182.57s（同一进程 hrtime 实测）\n");
    expect(got[0]?.numbers).toEqual(["182.57"]);
    // 负控：同一支数换个说法就不算——把抽取端放宽成"看到秒就当读数"会把叙述顶成证据（规则 265）
    const prose = credentialPages("### 2026-10-01 · 第 903 页 凭证\n\n上次墙钟 182.57s 是别人那趟的\n");
    expect(prose[0]?.numbers).toEqual([]);
  });

  it("真仓：未点名页数跟着现读走——涨了要红，凭空把帽调低也要红（只有真把页点名了才允许降）", () => {
    const cred = runDocsCheck().cred;
    expect(cred.unnamedPages.length, `现读 ${String(cred.unnamedPages.length)} 页 ≠ 帽 ${String(CRED_UNNAMED_PAGE_CAP)} ⇒ 帽要跟着现读改，别只改数`).toBe(CRED_UNNAMED_PAGE_CAP);
    expect(cred.registeredPages.length, `登记表 ${String(Object.keys(UNSOURCED_CRED_PAGES).length)} 页，可现读『已登记』只有 ${String(cred.registeredPages.length)} 页 ⇒ 有一页既没点名也没登记，或登记表里的 key 认不出页`).toBe(Object.keys(UNSOURCED_CRED_PAGES).length);
    expect(cred.registeredReadings, "登记页的读数条数要真从台账里抽出来（第 275 页现读＝20 条；第 271 页那批是 19，加进来的第 228 页那一页贡献一条）").toBe(20);
    expect(cred.weak.length, `弱证现读 ${String(cred.weak.length)} 对 ≠ 帽 ${String(CRED_WEAK_WITNESS_CAP)} ⇒ 这一格同样只准跟着现读降（补 sha 或补工件），不许凭空调`).toBe(CRED_WEAK_WITNESS_CAP);
    expect(cred.checked, "可比对分母塌了就不是这一格的账").toBeGreaterThanOrEqual(50);
  }, 60_000);

  it("回查端与抽取端同一把谓词：带 ANSI 的真汇总行要算找到，散文里出现同一个数不算", () => {
    /* ESC 用 fromCharCode 现拼，不写转义字面量：这文件里的 `\x1b` 曾在编辑中被改写过（本仓老事故）。
       两半都必要——只补正向那一半，「摘掉剥色」与「退化成裸数位」两种坏法各有一种不红。 */
    const ESC = String.fromCharCode(27);
    const colored = `Test Files ${ESC}[22m ${ESC}[1m${ESC}[32m253 passed (253)`;
    const found = checkCredentialSources(
      credentialPages(page(["x-2026-10-01"], ["253"])),
      face({ "x-2026-10-01": colored }),
      {},
    );
    expect(found.findings, `带色的真原文被判成悬空＝假红海（面里这句就是 vitest 印的那一行）：${JSON.stringify(colored)}`).toEqual([]);
    expect(found.checked).toBe(1);
    // 负控：面上只在散文里出现过这个数（没有严格式整句）⇒ 必须红，否则「读数」这格永远绿着
    const prose = checkCredentialSources(
      credentialPages(page(["x-2026-10-01"], ["253"])),
      face({ "x-2026-10-01": `说明：帽 253 台，另见 253 页` }),
      {},
    );
    expect(prose.findings, "散文里提到同一个数就顶住读数 ⇒ 这一格退化成『面非空』，红永远不来").toHaveLength(1);
    expect(prose.findings[0]?.detail).toContain("253");
  });

  it("sourcedReadings 自己：剥色、只认严格式整句、数位边界由精确成员给", () => {
    const ESC = String.fromCharCode(27);
    const text = `前言说 253 台\nTest Files ${ESC}[22m ${ESC}[1m${ESC}[32m253 passed (253)\nTests  102 passed (102)\nreal 182.12\n针脚体检：1148 条\n跑了 6/6 条\n`;
    const got = [...sourcedReadings(text)].sort();
    expect(got, "面上每个严格式各贡献一个数；散文里那个 253 不额外算，捕获组取的是数本身而不是整句").toEqual(["102", "1148", "182.12", "253", "6"]);
    // 数位边界这一半现在由集合的精确成员给：面上只有 2410 时，241 不在集合里
    expect(sourcedReadings("Test Files  2410 passed (2410)").has("241"), "把语境式退化成子串查找就会在这里翻绿").toBe(false);
    expect(sourcedReadings("Test Files  241 passed (241)").has("241"), "反向那一半：位数一样的真原文必须算找到").toBe(true);
  });

  it("接线：回查走 sourcedReadings、它内部真剥色（算出谓词却不接进判定＝这一格永远不响）", () => {
    const src = readFileSync(fileURLToPath(new URL("../scripts/docs-check.ts", import.meta.url)), "utf8");
    /* 第 269 页把面上的读数集合改成**按文件**再并集（弱证要问是哪份文件作的证），所以这里钉的行跟着换：
       从前那句 `const found = sourcedReadings(face);` 在 HEAD 里已经不在了，钉着它只会永远红。 */
    expect(src).toMatch(/^ {4}const found = new Set<string>\(perFile\.flatMap\(\(f\) => \[\.\.\.f\.nums\]\)\);$/mu);
    expect(src).toMatch(/^ {6}const sourced = found\.has\(num\);$/mu);
    expect(src).toMatch(/^ {8}const witnesses = perFile\.filter\(\(f\) => f\.nums\.has\(num\)\);$/mu);
    expect(src).toMatch(/^ {8}if \(identified\.some\(\(f\) => f\.runs\.some\(\(r\) => p\.shas\.includes\(r\)\)\)\) \{$/mu);
    expect(src).toMatch(/^ {2}const clean = stripAnsi\(face\);$/mu);
    expect(src).toMatch(/^import \{ stripAnsi \} from "\.\/lib\/vitest-summary";$/mu);
  });

  /* 第 275 页①：把门自己印的那一行（`可比对 N 个读数`／`证人无身份行 N 对`）纳进严格式。
     动因不是"覆盖面广一点"，是我两天里**三次**把这行的分母写成推的（`111`／`222`／`116`，现读 110／221／114）。
     两半都要有：没原文的那页必须红，有原文的那页必须绿且**两个数都真被抽到**（少抽一式＝我写错的那半没人查）。 */
  it("新增那两式要真有分辨力：页里的『可比对 N 个读数』在点名的面上找不到原文就红，找得到就两个数都记账", () => {
    const faceFn = () => [{ name: "docs-check.log", text: "凭证对账面：可比对 260 个读数（红 0）｜证人无身份行 149 对＝这一格无从判" }];
    const bad = checkCredentialSources(
      credentialPages("### 2026-10-01 · 第 901 页补 凭证：测试页\n\n取料：outputs/x-2026-10-01/\n凭证对账面：可比对 500 个读数（红 0）｜证人无身份行 501 对\n"),
      faceFn, {}, 0, 0,
    );
    const dets = bad.findings.map((f) => f.detail).join("｜");
    expect(dets, "两个数都要各自点名（只报一个＝抽取端漏了一式）").toContain("500");
    expect(dets).toContain("501");
    expect(bad.checked, "页里两个数都进了对账，只是都没原文").toBe(2);
    const good = checkCredentialSources(
      credentialPages("### 2026-10-01 · 第 901 页补 凭证：测试页\n\n取料：outputs/x-2026-10-01/\n凭证对账面：可比对 260 个读数（红 0）｜证人无身份行 149 对\n"),
      faceFn, {}, 0, 0,
    );
    expect(good.findings.map((f) => f.detail)).toEqual([]);
    expect(good.checked).toBe(2);
  });

  /* 第 275 页②：页 key 只取「第 NNN 页」，而**同号可以有两段**——第 228 页既有落地页（标题里『凭证』二字是在说这件事）
     又有补凭证页。从前 stale 用一只 Set 记「这个 key 点过名」，于是另一页一点名就把这条登记判死。
     改成计数之后：只要该 key 下还有一页没点名，登记就仍然有效；每一页都点了名才该删。 */
  it("同一 key 有两页时，登记只在『每一页都点了名』时才算过期", () => {
    const landing = "### 2026-09-30 · 第 228 页 · 落地：D-9 把凭证页与它自己点名的取料面对账\n\nTest Files 59 passed\n";
    const cred = "### 2026-09-30 · 第 228 页补 凭证：测试\n\n取料：outputs/x-2026-09-30/\nTest Files 60 passed\n";
    const faceFn = () => [{ name: "a.log", text: "目标提交：abcdef1\nTest Files 60 passed" }];
    const both = credentialPages(landing + cred);
    expect(both.length, "选择判据故意宽：两段都该被收到").toBe(2);
    expect(new Set(both.map((p) => p.key)).size, "而它们的 key 相同——这正是本条要钉的那个撞").toBe(1);
    const one = checkCredentialSources(both, faceFn, {}, 0, 0, { "第 228 页": "落地页不点名目录，那句 59 的原文不在它点名的面上" });
    expect(one.findings.map((f) => f.detail).join("｜"), "一页没点名 ⇒ 登记仍有效，不许让另一页替它说话").not.toContain("已被它自己点名的取料目录顶住");
    const named = checkCredentialSources(credentialPages(cred + cred), faceFn, {}, 0, 0, { "第 228 页": "两段都自己点了名 ⇒ 这条登记就是过期" });
    expect(named.findings.map((f) => f.detail).join("｜")).toContain("已被它自己点名的取料目录顶住");
  });

  it("接线：主段把「未点名页」连同帽一起印出来，且判定真拿帽去比（只算不印＝这格永远没人看）", () => {
    const src = readFileSync(fileURLToPath(new URL("../scripts/docs-check.ts", import.meta.url)), "utf8");
    expect(src.length).toBeGreaterThan(0);
    expect(src).toMatch(/^ {2}const unnamedPageKeys = new Set<string>\(\);$/mu);
    expect(src).toMatch(/^ {2}if \(unnamedPageKeys\.size > cap\) \{$/mu);
    expect(src).toMatch(/^ {4}\+ `[^`\n]*未点名页 \$\{String\(cred\.unnamedPages\.length\)\} 页（帽 \$\{String\(CRED_UNNAMED_PAGE_CAP\)/mu);
    // 第 269 页新加的那半：弱证既要比帽、也要印出来，还得真的把按文件的取料面交给判定
    expect(src).toMatch(/^ {2}if \(weak\.length > weakCap\) \{$/mu);
    // 第 284 页改指：按文件的取料面从 CLI 里的内联闭包搬进导出函数 `credFaceFiles`（探针要与门共用同一份构造器），
    // 所以这一行锚定的缩进从 10 空格变成 4——针脚跟着实现走，不是把断言删掉（规则 217/255）。
    expect(src).toMatch(/^ {6}return \{ name: f, text \};$/mu);
    expect(src, "汇总行里弱证那一格要真取 cred.weak.length——印成常数就没人看得见").toMatch(/^ {4}\+ `｜弱证 \$\{String\(cred\.weak\.length\)\} 对（帽 \$\{String\(CRED_WEAK_WITNESS_CAP\)/mu);
    // 第 271 页的两态：登记要把页从『可行动』挪走，stale 检查与那列印数都得真接上
    expect(src).toMatch(/^ {6}if \(p\.key in pageWaivers\) \{$/mu);
    // 第 275 页改形：`namedKeys`（一只 Set）换成「该 key 下总页数 vs 点了名的页数」两个计数，
    // 于是 stale 只在**每页都点了名**时出声——同号两页时不再替另一页说话。
    expect(src).toMatch(/^ {4}if \(total > 0 && named === total\) \{$/mu);
    expect(src, "两个计数必须真在预轮里累加，不是拿 Set 换个名字").toMatch(/^ {4}keyTotal\.set\(p\.key, \(keyTotal\.get\(p\.key\) \?\? 0\) \+ 1\);$/mu);
    expect(src).toMatch(/^ {4}if \(p\.dirs\.length > 0\) keyNamed\.set\(p\.key, \(keyNamed\.get\(p\.key\) \?\? 0\) \+ 1\);$/mu);
    expect(src).toMatch(/^ {4}\+ `｜已登记不可回查 \$\{String\(cred\.registeredPages\.length\)\} 页／\$\{String\(cred\.registeredReadings\)\} 条`\);$/mu);
    // 反向那一半：返回体丢了 unnamedPages／weak ⇒ 上面那些印不到，这一条先红
    expect(src).toMatch(/^ {2}return \{ findings: out, checked, unmatched, unnamed, unnamedPages: \[\.\.\.unnamedPageKeys\], registeredPages: \[\.\.\.registeredPageKeys\], registeredReadings, weak, weakUnjudged \};$/mu);
  });
});


// 第 279 页：D-10——台账里的**源码**行号引用要追得到东西。
// 判据只问"追不追得到"（可解析路径 ∧ HEAD 里存在），因为"行号还在总行数范围内"不是证人：
// 文件只会变长，旧行号通常还在范围内，指的内容却已经换了。存量按**集合**登记，不按数量——
// 数量水位拦不住"修掉一条又添一条"的净零交换。
describe("D-10 源码行号引用面：两半都钉，存量按集合登记", () => {
  const tracked = new Set(["src/a.ts", "scripts/b.mts"]);

  it("可解析的引用不红；裸文件名与 HEAD 里没有的路径各红一条，同一条只算一次", () => {
    const ledger = [
      "`src/a.ts:12` 与 `src/a.ts:12` 同一条只算一次",
      "`agent.ts:7` 只写了裸文件名",
      "`src/gone.ts:9` 这个文件在 HEAD 里没有",
      "`scripts/b.mts:1` 也追得到",
    ].join("\n");
    const f = checkSourceLineCitations(ledger, tracked, []);
    expect(f.map((x) => x.rule)).toEqual(["D-10", "D-10"]);
    expect(f.every((x) => x.file === LEDGER_FILE)).toBe(true);
    // 反向一侧（别把追得到的也喊红）：同一份台账把两条坏引用换成好路径 ⇒ 一条不红
    const clean = "`src/a.ts:12`\n`scripts/b.mts:1`\n";
    expect(checkSourceLineCitations(clean, tracked, [])).toEqual([]);
  });

  it("登记是集合不是数量：净零交换（销掉一条存量＋新添一条坏引用）要报两条", () => {
    // 台账里 `agent.ts:7` 被改好了（存量那条不再命中），同时新写了一条 `src/gone.ts:9`
    const ledger = "`src/a.ts:1`\n`src/gone.ts:9`\n";
    const f = checkSourceLineCitations(ledger, tracked, ["agent.ts:7"]);
    expect(f.length).toBe(2);
    expect(f.map((x) => x.rule)).toEqual(["D-10", "D-10"]);
    // 同一条存量仍命中时不该出声（否则登记会自己变红，逼人去删真登记）
    expect(checkSourceLineCitations("`agent.ts:7`\n", tracked, ["agent.ts:7"])).toEqual([]);
  });

  it("登记不再命中时要点名该删——只印不判的那一半也要出声（否则存量会静默烂在这儿）", () => {
    // 台账里一条坏引用都没有，但登记表里那条已经追不到了：这必须红，且不依赖"有没有新增坏引用"。
    const f = checkSourceLineCitations("`src/a.ts:1`\n", tracked, ["gone.ts:1"]);
    expect(f.map((x) => x.rule)).toEqual(["D-10"]);
  });

  it("真仓那一趟：74 条存量今天仍全部命中，所以 D-10 现在是绿的（登记不是凭空写的）", () => {
    expect(LEGACY_SOURCE_CITATIONS.length).toBeGreaterThan(0);
    const face = runDocsCheck();
    expect(hit(face.findings, "D-10").length).toBe(0);
  });
});

/* ── 第 413 页 D-13：页号唯一面。台账的引用单位是「第 N 页」，而这个号一直是各会话自己数出来的——
    现读 455 张页标题里 106 个号在同一天的两位作者手里撞过（跨日期 0 个）。
    这几条各钉一种坏法：探测器被摘（撞号静默）、取号面写宽（小节头冒充页）、登记空转不出声、
    以及接线（门自己再算一份分页面，与 D-11 分母不同）。── */
describe("D-13 页号唯一面：撞号要出声、登记不许空转、取号面只认页标题", () => {
  const pagesOf = (text: string) => ledgerPages(text, ANY_PAGE_HEAD);

  it("两张同名页标题报一条；只有一张时一条不红（别把正常的页也喊成撞）", () => {
    const two = [
      "## 2026-10-08 · 第 500 页：甲", "正文甲",
      "## 2026-10-08 · 第 500 页：乙", "正文乙",
      "## 2026-10-08 · 第 501 页：丙", "正文丙",
    ].join("\n");
    const r = checkPageNumberUniqueness(pagesOf(two), []);
    expect(r.titles).toBe(3);
    expect(r.dups).toBe(1);
    expect(r.unregistered).toEqual(["第 500 页"]);
    expect(r.findings.map((x) => x.rule)).toEqual(["D-13"]);
    // 反向一侧：同一份台账把乙改成别的号 ⇒ 一条不红，但页数还是三张
    const ok = two.replace("第 500 页：乙", "第 502 页：乙");
    const r2 = checkPageNumberUniqueness(pagesOf(ok), []);
    expect(r2.findings).toEqual([]);
    expect(r2.titles).toBe(3);
  });

  it("小节头正好以页号开头不算第二页：按标题形状取号，不吃 key 的退化路径", () => {
    const text = [
      "## 2026-10-08 · 第 500 页：甲", "正文甲",
      "### 第 500 页 那一节的补充", "正文丁",
    ].join("\n");
    const r = checkPageNumberUniqueness(pagesOf(text), []);
    // 按 key 数会把这条小节头也算成一页（key 的来历是"标题里第一个 第 N 页 子串"），
    // 于是它既虚增 titles、又凭空造出一个"撞号"。这一格钉的就是那两个假读数都得是 0。
    expect(r.titles).toBe(1);
    expect(r.dups).toBe(0);
    expect(r.findings).toEqual([]);
    expect(r.sections).toBe(1);
  });

  it("h3 写的老页标题也算一页（308 页之前整本是 h3；只认 `## ` 会把面写窄）", () => {
    const text = [
      "### 2026-09-12 · 第 7 页：老甲", "正文",
      "### 2026-09-12 · 第 7 页：老乙", "正文",
    ].join("\n");
    const r = checkPageNumberUniqueness(pagesOf(text), []);
    expect(r.titles).toBe(2);
    expect(r.unregistered).toEqual(["第 7 页"]);
  });

  it("登记是集合不是豁免：命中登记不红，登记不再命中要点名该删", () => {
    const two = ["## 2026-10-08 · 第 500 页：甲", "## 2026-10-08 · 第 500 页：乙"].join("\n");
    expect(checkPageNumberUniqueness(pagesOf(two), ["第 500 页"]).findings).toEqual([]);
    // 空转那一半必须独立出声：台账里没撞号了，登记表还留着一条 ⇒ 红，且不依赖"有没有新撞号"
    const single = ["## 2026-10-08 · 第 500 页：甲"].join("\n");
    const f = checkPageNumberUniqueness(pagesOf(single), ["第 500 页"]);
    expect(f.findings.map((x) => x.rule)).toEqual(["D-13"]);
    // 第 447 页：原来断的是**插值之后**的整句（「…「第 500 页」在台账里已不再重复」），而生产端那是一枚
    // 模板串 ⇒ 判卷比的是连续字面量，对不上就报 drift（`prose-needle-scan` 当场红）。
    // 改成模板中段独有的那半截：既在连续字面量里，又只有这一句产它。
    expect(f.findings[0]!.detail).toContain("在台账里已不再重复");
  });

  it("净零交换要报两条：销掉一条存量、同时新撞一个号", () => {
    const text = ["## 2026-10-08 · 第 600 页：甲", "## 2026-10-08 · 第 600 页：乙"].join("\n");
    const f = checkPageNumberUniqueness(pagesOf(text), ["第 500 页"]);
    expect(f.findings.length).toBe(2);
  });

  it("next＝现读最大页号+1；空台账时是 1（「没有页」与「页号是 0」不许同形）", () => {
    expect(checkPageNumberUniqueness(pagesOf(["## 2026-10-08 · 第 412 页：甲"].join("\n")), []).next).toBe(413);
    const empty = checkPageNumberUniqueness([], []);
    expect(empty.titles).toBe(0);
    expect(empty.next).toBe(1);
    expect(empty.findings).toEqual([]);
  });

  it("接线：门吃的是 D-11 那批页（`witnessPages`），不在这里重算一份分页面", () => {
    const src = readFileSync(join(REPO, "scripts/docs-check.ts"), "utf8");
    expect(src).toContain("checkPageNumberUniqueness(witnessPages)");
    // 调用点必须在 `witnessPages` 赋值之后——写在它前面就是一路拿着空数组，读数恒绿而什么都没判
    expect(src.indexOf("witnessPages = ledgerPages")).toBeLessThan(src.indexOf("checkPageNumberUniqueness(witnessPages)"));
  });

  it("真仓那一趟：106 条存量今天仍全部命中，所以 D-13 现在是绿的（登记不是凭空写的）", () => {
    expect(LEGACY_DUPLICATE_PAGES.length).toBeGreaterThan(0);
    const face = runDocsCheck();
    expect(hit(face.findings, "D-13").length).toBe(0);
    // 面不能是空的：空取料的读数恒 0 不是"没问题"（第 392 页第 9 条同一族）
    expect(face.pageNum === null ? 0 : face.pageNum.titles).toBeGreaterThan(400);
  });
});


    /* ── 第 284 页：D-9 的取料面收成**一个导出的构造器**，门与复现它的探针共用。
    动因是一条已入库探针抄了门的旧形状（一整块字符串），第 269 页把面改成按文件之后它静默烂掉——
    没人重跑就没人知道，直到本笔现跑才抛 `x.list.map is not a function`。
    这三条各钉一种坏法：三态被抹平（`null` 换成 `[]`＝"没有"与"取不到"同形）、排除面写宽（`.mjs` 进了面）、
    接线掉（门不再调用这个构造器，探针与门又分成两份形状）。 ── */
describe("credFaceFiles：门与探针共用同一份取料面（第 284 页）", () => {
  const makeFace = (): { root: string; cleanup: () => void } => {
    const root = mkdtempSync(join(tmpdir(), "dsh-credface-"));
    mkdirSync(join(root, "outputs", "d"), { recursive: true });
    writeFileSync(join(root, "outputs", "d", "a.log"), "可比对 318 个读数（红 0）");
    writeFileSync(join(root, "outputs", "d", "b.txt"), "第二份证人：208.12s");
    writeFileSync(join(root, "outputs", "d", "probe.mjs"), "脚本自己不算证人 318");
    return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  };

  it("目录不存在 ⇒ 交 null（取不到），不是空数组（面可取且为空）——三态不许被抹平", () => {
    const { root, cleanup } = makeFace();
    try {
      expect(credFaceFiles(root, "no-such-dir"), "交 [] 会让门把「取不到」读成「没有证人」⇒ 假绿").toBeNull();
      expect(credFaceFiles(root, "d"), "目录在时要交出文件").not.toBeNull();
    } finally { cleanup(); }
  });

  it("排除 `.mjs`（那是探针脚本自己），其余逐文件交回 {name,text}；读不到的文件不许被丢掉", () => {
    const { root, cleanup } = makeFace();
    try {
      const files = credFaceFiles(root, "d") ?? [];
      expect(files.map((f) => f.name).sort()).toEqual(["a.log", "b.txt"]);
      expect(files.reduce((a, f) => a + f.text.length, 0), "两份证人的文本都要进面（少一份＝分母悄悄变小）").toBeGreaterThan(10);
      // 反向证人：把 `.mjs` 也收进来的那份实现会让这一格多出一个名字
      expect(files.some((f) => f.name.endsWith(".mjs")), "探针脚本进了面 ⇒ 它自己写下的数字给自己作证").toBe(false);
    } finally { cleanup(); }
  });

  it("接线：门那半真的调这个构造器，且「拼一整块字符串」的老写法在取料面这一段里不再存在", () => {
    const src = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "..", "scripts", "docs-check.ts"), "utf8");
    expect(/^ {4}\(dir\) => credFaceFiles\(ROOT, dir\),$/mu.test(src), "CLI 没接进共用构造器 ⇒ 形状还会再漂一次").toBe(true);
    // 行锚定的正向断言（规则 247）：老写法是 readdirSync(...).map(...).join("\n") 直接返回字符串
    expect(/^ {4}return readdirSync\(abs\)\.filter\(\(f\) => !f\.endsWith\("\.mjs"\)\)\.map\(\(f\) => \{$/mu.test(src)).toBe(true);
  });
});

/* ── 第 285 页：D-11「凭证页点名的 dated 证人必须追得到 HEAD」。
    立它的两起现读事故：① 第 281 页凭证引的三份日志没随页入库 ⇒ 主树 docs-check 绿、干净树判卷红，
    这条洞唯一的检测器是一次 210s 的全量认证；② 第 284 页声称「第一版 `needles-before.log` 的原文留着」，
    而那份日志已被同名覆盖 ⇒ D-9 只抽目录、看不见文件名（证人 `outputs/witness-filename-blindspot-2026-10-01/probe.log`）。
    这六条各钉一种坏法：点名到不存在的文件／整个目录没入库／登记位漂了／取料面把中文文件名截断（第一版普查真犯过）／
    接线掉／未检与红 0 同形。 ── */
describe("D-11 证人点名面：文件与目录两半都要追得到，登记位双向出声", () => {
  const cred = (key: string, body: string): string => `### 2026-09-30 · ${key} 凭证：测试页\n\n${body}\n`;

  it("文件点名：在清单里不红；同一条从清单里去掉就红一条，且点名到页", () => {
    const pages = credentialPages(cred("第 900 页", "取料 `outputs/x-2026-09-30/witness.log`｜另一份 `outputs/y-2026-09-30/other.md`"));
    expect(pages[0]?.refs).toEqual(["outputs/x-2026-09-30/witness.log", "outputs/y-2026-09-30/other.md"]);
    const both = new Set(["outputs/x-2026-09-30/witness.log", "outputs/y-2026-09-30/other.md"]);
    const ok = checkWitnessPaths(pages, both, []);
    expect(ok.findings).toEqual([]);
    expect(ok.refs).toBe(2);
    // 反向一侧（规则 272 说「A＝B」必配「A≠旧值」）：把其中一份证人从清单里抽掉 ⇒ 恰好红一条
    const lost = checkWitnessPaths(pages, new Set(["outputs/y-2026-09-30/other.md"]), []);
    expect(lost.findings.length).toBe(1);
    expect(lost.findings[0]?.rule).toBe("D-11");
    expect(lost.findings[0]?.detail).toContain("第 900 页");
    expect(lost.findings[0]?.detail).toContain("outputs/x-2026-09-30/witness.log");
  });

  it("目录点名（以 / 结尾）：目录里有任一工件就不红，整个目录没入库才红", () => {
    const pages = credentialPages(cred("第 901 页", "取料：outputs/x-2026-09-30/"));
    expect(pages[0]?.refs).toEqual(["outputs/x-2026-09-30/"]);
    expect(checkWitnessPaths(pages, new Set(["outputs/x-2026-09-30/a.log"]), []).findings).toEqual([]);
    const gone = checkWitnessPaths(pages, new Set(["outputs/z-2026-09-30/a.log"]), []).findings;
    expect(gone.length).toBe(1);
    expect(gone[0]?.detail).toContain("那个 dated 目录一件工件都没入库");
  });

  it("登记位两半：仍命中的登记安静，不再命中的登记报 stale；净零交换报两条", () => {
    const named = credentialPages(cred("第 902 页", "取料 `outputs/x-2026-09-30/gone.log`"));
    // 登记仍命中 ⇒ 不许出声（否则登记表自己变红，逼人去删真登记）
    expect(checkWitnessPaths(named, new Set(), ["outputs/x-2026-09-30/gone.log"]).findings).toEqual([]);
    // 那条点名被换掉了，同时新写了一条没入库的：一老一新各一条
    const swapped = credentialPages(cred("第 902 页", "取料 `outputs/x-2026-09-30/renamed.log`"));
    const f = checkWitnessPaths(swapped, new Set(), ["outputs/x-2026-09-30/gone.log"]).findings;
    expect(f.length).toBe(2);
    expect(f.some((x) => x.detail.includes("已不再被任何凭证页点名"))).toBe(true);
    expect(f.some((x) => x.detail.includes("renamed.log"))).toBe(true);
  });

  it("取料面的形状：中文文件名不许被截断、模式串跳过、裸目录算目录、非 dated 目录不管", () => {
    const text = [
      "点名 `outputs/x-2026-09-30/01-针脚收的是一个名字时那35处副本没有一处能替它作证.md`，后面紧跟中文。",
      "模式不算：outputs/_audit-*.md 与 outputs/a-2026-09-30/{b,c}.log",
      "裸目录：outputs/y-2026-09-30/ 里的东西",
      "非 dated 不管：outputs/plain-dir/file.log",
    ].join("\n");
    const refs = ledgerWitnessRefs(text);
    expect(refs).toContain("outputs/x-2026-09-30/01-针脚收的是一个名字时那35处副本没有一处能替它作证.md");
    expect(refs).toContain("outputs/y-2026-09-30/");
    expect(refs.some((r) => /[*{}]/u.test(r))).toBe(false);
    expect(refs.some((r) => r.includes("plain-dir"))).toBe(false);
    // 反向哨兵（规则 237 那一族）：第一版普查把字符集限成 ASCII，中文名会在第一个汉字处截断成 `…/01-`
    // 那条假红形状今天没回来——断言它回来的形状：任何一条点名都不许以 `-` 结尾
    expect(refs.some((r) => /-/u.test(r.slice(-1)) && !r.endsWith("/"))).toBe(false);
  });

  it("真仓那一趟：分母非零、红 0，且「未检」与「红 0」不同形（这条走的是门自己的接线）", () => {
    const face = runDocsCheck();
    expect(face.witness, "未检（取不到 HEAD 跟踪清单）⇒ 这一趟不构成读数").not.toBeNull();
    expect(face.witness!.refs, "分母为 0 的绿不算绿").toBeGreaterThanOrEqual(200);
    expect(face.witness!.pages).toBeGreaterThan(0);
    expect(hit(face.findings, "D-11").map((x) => x.detail)).toEqual([]);
    // 第 290 页补⑴：取值域换成整本台账，登记位从 0 涨到**现读的 12 条**（整目录已不在盘上的老账，09-12～09-23）。
    // 这条是**恰好 12 的等式**，不是下限：多一条要交代、少一条（原件被找回并入库）就必须删（规则 241/248）。
    expect(LEGACY_WITNESS_REFS.length).toBe(12);
    // 守恒那一半（规则 351）：整本台账点名的条数必须 ≥ 凭证页自己点名的条数——分面变窄时这条会响
    const credRefs = new Set(credentialPages(readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "..", "PROGRESS.md"), "utf8")).flatMap((p) => p.refs));
    expect(face.witness!.refs).toBeGreaterThanOrEqual(credRefs.size);
    expect(credRefs.size).toBeGreaterThan(0);
  });

  it("接线：门真的调这条判据；「取不到清单」走未检而不是拿空集合当判据", () => {
    const src = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "..", "scripts", "docs-check.ts"), "utf8");
    expect(/^ {2}const witness = ledgerTracked === null \? null : checkWitnessPaths\(witnessPages, ledgerTracked\);$/mu.test(src),
      "判据写了没接进门 ⇒ 只有单测在跑").toBe(true);
    expect(/^ {4}ledgerTracked = trackedFilesAtHead\(\);$/mu.test(src)).toBe(true);
    // 取值域那一半也必须钉在门里：D-11 吃 `witnessPages`（整本台账），不是 `credPages`
    expect(/^ {4}witnessPages = ledgerPages\(ledgerText, ANY_PAGE_HEAD\);$/mu.test(src)).toBe(true);
    // 凭证页只构造一次（D-9 吃它）：老写法在调用点里现造，如今那一行该没了
    expect(src.includes("existsSync(ledgerAbs) ? credentialPages(readFileSync(ledgerAbs, \"utf8\")) : []")).toBe(false);
  });

  it("取值域换成整本台账：非凭证页点名的证人也要红一条，且 `ANY_PAGE_HEAD` 与凭证面是同一份抽法", () => {
    const text = [
      "### 2026-09-30 · 第 950 页 · 普通页：原件见 outputs/plain-2026-09-30/witness.log",
      "",
      "### 2026-09-30 · 第 951 页 凭证：原件见 outputs/cred-2026-09-30/witness.log",
      "",
    ].join("\n");
    const all = ledgerPages(text, ANY_PAGE_HEAD);
    expect(all.map((p) => p.key)).toEqual(["第 950 页", "第 951 页"]);
    const credOnly = credentialPages(text);
    expect(credOnly.map((p) => p.key)).toEqual(["第 951 页"]);
    // 两页的证人都不在清单里 ⇒ 整本台账报 2 条，凭证面只报 1 条（这一格从前是漏的：普通页引的证人没人守）
    expect(checkWitnessPaths(all, new Set<string>(), []).findings.length).toBe(2);
    expect(checkWitnessPaths(credOnly, new Set<string>(), []).findings.length).toBe(1);
    // 反向一侧：把普通页那份证人补进清单 ⇒ 只剩凭证页那条红（证明 2 条不是把同一件事数了两遍）
    const backed = new Set<string>(["outputs/plain-2026-09-30/witness.log"]);
    expect(checkWitnessPaths(all, backed, []).findings.map((f) => f.detail).join()).toContain("第 951 页");
    expect(checkWitnessPaths(all, backed, []).findings.length).toBe(1);
  });
});

describe("HEAD 取料面必须吃得到中文文件名（第 290 页：`git ls-tree --name-only` 默认把非 ASCII 路径转义）", () => {
  // 真机哨兵：这条不是合成输入——本仓 HEAD 里那 164 条中文证人只有 `-z` 才进得来。
  // 从前 `trackedFilesAtHead()` 按 `\n` 切默认输出，于是每一条中文证人都「不在清单里」⇒ D-10/D-11 假红，
  // 而 `dirs` 那道折目录的正则也因行首多了引号一起落空（规则 237：取值域要按真机形状量，不按「大概都是 ASCII」量）。
  const CJK_PROBE = "没尺这一态";
  const CJK_PATH = "outputs/anchor-no-ruler-face-2026-09-26/01-没尺这一态被算出来又扔掉.md";

  it("哨兵：盘上真有、HEAD 真有 ⇒ 清单里必须真有（这条不可能靠空面变绿）", () => {
    const tracked = trackedFilesAtHead();
    expect(tracked).not.toBeNull();
    const set = tracked as Set<string>;
    expect(set.has(CJK_PATH)).toBe(true);
    // 反向一侧：拿一条确实不在 HEAD 里的中文名当负控，别让它因为「集合里有引号形状的邻居」而误绿
    expect(set.has("outputs/anchor-no-ruler-face-2026-09-26/01-这一条不存在.md")).toBe(false);
  });

  it("清单里不许出现 git 的转义形状（行首引号，或反斜杠加三位八进制）", () => {
    const tracked = trackedFilesAtHead();
    const set = tracked as Set<string>;
    const escaped = [...set].filter((p) => p.startsWith(String.fromCharCode(34)) || /\\\d{3}/u.test(p));
    expect(escaped).toEqual([]);
    expect(set.size).toBeGreaterThan(1000);
  });

  it("目录点名那一半也认中文：整个目录只有中文工件时不红，抽掉才红", () => {
    const pages = credentialPages(
      "### 2026-09-30 · 第 977 页 凭证：测试页\n\n取料：outputs/anchor-no-ruler-face-2026-09-26/\n",
    );
    expect(pages[0]?.refs).toEqual(["outputs/anchor-no-ruler-face-2026-09-26/"]);
    const tracked = trackedFilesAtHead() as Set<string>;
    expect(checkWitnessPaths(pages, tracked, []).findings).toEqual([]);
    // 同一页喂一份「只有转义形状」的清单（＝修之前的取料面）⇒ 必须报红，证明这条判卷量的就是那一格
    const escapedOnly = new Set<string>([
      '"outputs/anchor-no-ruler-face-2026-09-26/01-\\346\\262\\241.md"',
    ]);
    expect(checkWitnessPaths(pages, escapedOnly, []).findings.length).toBe(1);
  });
});

describe("#61 的一半：认证产物那种 `<名字>-<日期>-<HHMM>` 目录，全名要引得到", () => {
  // 本仓自己的认证产物目录就长 `head-cert-<sha7>-<日期>-<HHMM>`，而旧正则止于日期
  // ⇒ 只吃到日期那段、把 `-HHMM` 留在窗外 ⇒ 台账里**写不得这种全名**（写了自己点名的取料面
  // 就解析不到）。这一格钉的是"写得进去"，且钉住**不截断**（截断正是原缺陷）。
  it("带 -HHMM 后缀的目录被整段收下（不截断）", () => {
    const refs = ledgerWitnessRefs("见 `outputs/head-cert-513d4d7-2026-10-04-1739/summary.txt`。");
    expect(refs).toEqual(["outputs/head-cert-513d4d7-2026-10-04-1739/summary.txt"]);
  });

  it("目录名单独出现（结尾斜杠）也收整段", () => {
    expect(ledgerWitnessRefs("取料在 `outputs/head-cert-8a82df1-2026-10-04-1748/`。"))
      .toEqual(["outputs/head-cert-8a82df1-2026-10-04-1748/"]);
  });

  it("反向守卫：不带 -HHMM 的老形状一字不变（扩张不许把老面改掉）", () => {
    expect(ledgerWitnessRefs("`outputs/cert-window-2026-10-04/headcert4-summary.txt`"))
      .toEqual(["outputs/cert-window-2026-10-04/headcert4-summary.txt"]);
    expect(ledgerWitnessRefs("`outputs/claims-no-needle-2026-10-03/`"))
      .toEqual(["outputs/claims-no-needle-2026-10-03/"]);
  });

  it("反向守卫：截断过的那一段绝不出现在结果里（否则就是原来那条缺陷）", () => {
    const refs = ledgerWitnessRefs("`outputs/head-cert-513d4d7-2026-10-04-1739/provenance.md`");
    expect(refs.some((r) => r.includes("2026-10-04/provenance.md"))).toBe(false);
  });
});

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const ledgerText = (): string => readFileSync(join(REPO, "PROGRESS.md"), "utf8");

/* ── ⑴ 分页点：h2 页与 h3 页各钉一条 ───────────────────────────────────────
   合成页用台账的真实两态：`## 2026-09-30 · 第 N 页 …`（第 308 页起）与 `### …`（308 页以前）。
   两种坏法各对应一条：只钉 h3 ⇒ 页标题再换一级又没人响；只钉 h2 ⇒ 把 h3 缝收窄也没人响。 */
describe("分页点谓词 PAGE_HEAD_RE：h2 页与 h3 页各钉一条（#61②，第 350 页）", () => {
  const h3Page = (n: number, body: string): string => `### 2026-09-30 · 第 ${String(n)} 页 凭证：标题\n\n${body}\n`;
  const h2Page = (n: number, body: string): string => `## 2026-09-30 · 第 ${String(n)} 页 凭证：标题\n\n${body}\n`;

  it("h3 两页 ⇒ 两条页，各带各的证人（这一格是既有口径，收窄掉就红在这里）", () => {
    const pages = ledgerPages(h3Page(900, "原件 outputs/h3a-2026-09-30/a.log") + h3Page(901, "原件 outputs/h3b-2026-09-30/b.log"), ANY_PAGE_HEAD);
    expect(pages.map((p) => p.key)).toEqual(["第 900 页", "第 901 页"]);
    expect(pages.map((p) => p.refs)).toEqual([["outputs/h3a-2026-09-30/a.log"], ["outputs/h3b-2026-09-30/b.log"]]);
  });

  it("h2 两页 ⇒ 两条页（从前只认 `^### ` 时它们整段落进别人的体里，key 还是上一条 h3 的）", () => {
    const pages = ledgerPages(h2Page(902, "原件 outputs/h2a-2026-09-30/a.log") + h2Page(903, "原件 outputs/h2b-2026-09-30/b.log"), ANY_PAGE_HEAD);
    expect(pages.map((p) => p.key)).toEqual(["第 902 页", "第 903 页"]);
    expect(pages.map((p) => p.refs)).toEqual([["outputs/h2a-2026-09-30/a.log"], ["outputs/h2b-2026-09-30/b.log"]]);
    // 标题剥标记跟着认 2～3 级：`title` 进 D-9 的红话术，留着 `## ` 就是给读者看 markdown 记号
    expect(pages.every((p) => !p.title.startsWith("#"))).toBe(true);
  });

  it("跨页顶包那一格：h2 页点名的证人要红在 h2 页自己头上，不许被邻页的分母吃掉", () => {
    const text = h2Page(960, "原件 outputs/h2only-2026-09-30/a.log") + h3Page(961, "原件 outputs/h3only-2026-09-30/b.log");
    const w = checkWitnessPaths(ledgerPages(text, ANY_PAGE_HEAD), new Set<string>(), []);
    expect(w.findings.length).toBe(2);
    expect(w.refs).toBe(2);
    // 合并态这两条会一起写成同一个 key——第 349 页我写的「原件在 …」被报成「第 307 页 点名」就是这个形状
    expect(w.findings.map((f) => /第 \d+ 页/u.exec(f.detail)?.[0])).toEqual(["第 960 页", "第 961 页"]);
  });

  it("真仓哨兵：h2 那两千多行必须各自成页，第 350 页点名的证人要挂在「第 350 页」头上", () => {
    const pages = ledgerPages(ledgerText(), ANY_PAGE_HEAD);
    const mine = pages.filter((p) => p.key === "第 350 页");
    expect(mine.length, "台账第 350 页要独立成段").toBeGreaterThan(0);
    expect(
      mine.some((p) => p.refs.some((r) => r.includes("d11-page-seam-2026-10-04"))),
      "本页自己点名的证人必须算在本页头上（合并态它们整片挂在「第 307 页」身上）",
    ).toBe(true);
    // 伪页那一格：合并态「第 307 页」一条挂 118 条 refs（本轮现读），逐页化之后只剩它自己的两条
    for (const p of pages.filter((x) => x.key === "第 307 页")) {
      expect(p.refs.length, `第 307 页又在替别人挂账：${String(p.refs.length)} 条`).toBeLessThanOrEqual(2);
    }
  });

  it("接线：切页与剥标记都吃 `PAGE_HEAD_RE` 这一份，源文件里第二份 `/^### /u` 字面量不许回来", () => {
    const src = readFileSync(join(REPO, "scripts", "docs-check.ts"), "utf8");
    expect(/\.filter\(\(\[l\]\) => PAGE_HEAD_RE\.test\(l\)\)/u.test(src), "分页点没收成一份谓词").toBe(true);
    expect((src.match(/\/\^### \//gu) ?? []).length, "同一形状写两遍＝两个会各自漂的决策点（规则 348）").toBe(0);
    // 谓词自己两态：h2 **页标题**算缝，台账开头那些普通 `## ` 章节标题不算（`## 任务清单` 不是一页）
    expect(PAGE_HEAD_RE.test("## 2026-10-03 · 第 308 页：正文")).toBe(true);
    expect(PAGE_HEAD_RE.test("## 任务清单（全部完成）")).toBe(false);
    expect(PAGE_HEAD_RE.test("### 2026-09-30 · 第 307 页补 凭证（1/1）")).toBe(true);
  });
});

/* ── ⑵ 证人形状：`<rev>-<date>-<HHMM>` 与普通 dated 目录各钉一条 ────────────
   坏法（第 349 页现读）：`DATED_DIR_RE` 的捕获止于日期且**没有右边界** ⇒ 贪婪回溯把时刻四位留在捕获外，
   `ledgerWitnessRefs` 见后续字符不是 `/` 就走「目录点名」那一支 ⇒ ref＝截断名＋`/`＝一个从来没存在过的目录，
   而这形状偏偏是 `scripts/head-cert.ts` 自己产出的（`head-cert-<rev7>-<YYYY-MM-DD>-<HHMM>`）。 */
describe("dated 证人取料面：head-cert 的 `-HHMM` 目录名不许被截断（#61①，第 349/350 页）", () => {
  const FULL = "outputs/head-cert-55ce164-2026-10-04-0402/provenance.md";

  it("两种形状各钉一条：普通 `outputs/<主题>-<date>/` 与 `head-cert-<rev>-<date>-<HHMM>`", () => {
    // ① 既有形状（这一笔不许把它改坏）
    expect(ledgerWitnessRefs("取料：`outputs/topic-2026-09-30/a.log`，另一页裸目录 `outputs/topic-2026-10-01/`")).toEqual([
      "outputs/topic-2026-09-30/a.log",
      "outputs/topic-2026-10-01/",
    ]);
    // ② 认证原件那一格：全名必须完整进分母（旧尺在这一条红：它交回 `outputs/head-cert-55ce164-2026-10-04/`）
    expect(ledgerWitnessRefs(`原件在 \`${FULL}\``)).toEqual([FULL]);
    // ③ 第三态：没有时刻的普通形状照旧——`-HHMM` 是**可选**，不是新增必填段
    expect(ledgerWitnessRefs("原件在 `outputs/head-cert-55ce164-2026-10-04/provenance.md`")).toEqual([
      "outputs/head-cert-55ce164-2026-10-04/provenance.md",
    ]);
  });

  it("分组号不许漂：时刻那组必须是非捕获 `(?:…)`——写成捕获组的话 `m[2]` 成了 `0402`、文件名整段错位", () => {
    expect(ledgerWitnessRefs("见 `outputs/head-cert-55ce164-2026-10-04-0402/`（裸目录点名）")).toEqual([
      "outputs/head-cert-55ce164-2026-10-04-0402/",
    ]);
    expect(ledgerWitnessRefs(`见 \`${FULL}\``)).toEqual([FULL]);
    const src = readFileSync(join(REPO, "scripts", "docs-check.ts"), "utf8");
    // 派生关系还在（`WITNESS_REF` 从 `DATED_DIR_RE.source` 派生＝不在那里第二次写日期），不许改成第二份手抄实现
    expect(src.includes("new RegExp(DATED_DIR_RE.source"), "派生关系被改成手抄第二份实现").toBe(true);
  });

  it("D-9 那一半同一个形状：目录名完整 ⇒ 读数进「可比对」；被截断 ⇒ 退成「取不到」而红数照旧 0（假绿形状）", () => {
    const page = "### 2026-10-04 · 第 999 页 凭证：标题\n\n本趟墙钟 257.32s｜原件 " + FULL + "\n";
    const pages = credentialPages(page);
    expect(pages[0]?.dirs).toEqual(["head-cert-55ce164-2026-10-04-0402"]);
    const face = (dir: string) => (dir === "head-cert-55ce164-2026-10-04-0402" ? [{ name: "provenance.md", text: "本趟墙钟 257.32s" }] : null);
    const ok = checkCredentialSources(pages, face, {}, 0, 0, {});
    expect(ok.checked).toBe(1);
    expect(ok.unmatched).toBe(0);
    expect(ok.findings).toEqual([]);
    // 反向（正控，规则 242）：面上只有**截断名**那一格时，读数不许被算成已回查——它进「取不到」那一档
    const truncatedOnly = (dir: string) => (dir === "head-cert-55ce164-2026-10-04" ? [{ name: "x.log", text: "本趟墙钟 257.32s" }] : null);
    expect(checkCredentialSources(pages, truncatedOnly, {}, 0, 0, {}).unmatched).toBe(1);
  });

  it("D-11 两态：清单里是全名 ⇒ 0 红；清单里只有截断目录的邻居 ⇒ 恰好红一条（断言不是恒真）", () => {
    const pages = credentialPages("### 2026-10-04 · 第 999 页 凭证：标题\n\n原件 " + FULL + "\n");
    expect(checkWitnessPaths(pages, new Set([FULL]), []).findings).toEqual([]);
    const wrongFace = checkWitnessPaths(pages, new Set(["outputs/head-cert-55ce164-2026-10-04/provenance.md"]), []);
    expect(wrongFace.refs).toBe(1);
    expect(wrongFace.findings.length).toBe(1);
    expect(wrongFace.findings[0]?.detail).toContain(FULL);
  });
});

/* ── ⑶ A 臂哨兵：复刻被度量方的那一臂，第一件事是复现被度量方的读数 ─────────
   第 351 页第 3 条的实录：第一版三臂探针没立这条哨兵，`dirs` 抽法写错 ⇒ **同一个 A 臂**自报红 65，
   而门在同一份文本上报红 0。是「A 必须等于门」把那 65 判成**探针缺陷**，而不是「台账今天真有 65 条红」。
   ⇒ 本仓纪律：任何「另跑一臂」的判卷/探针，取料面与登记表都要**从尺 import**（不是抄字面量、不是抄口径描述），
     然后逐项等值断言；不相等就作废全部差值。 */
describe("A 臂哨兵：独立重跑的凭证对账面与证人点名面必须逐字等于门自己印的读数", () => {
  it("门（`runDocsCheck`）↔ 臂（`credentialPages`／`ledgerPages` ＋ 构造器）：D-9 八项、D-11 三项全部相等", () => {
    const face = runDocsCheck();
    const tracked = trackedFilesAtHead();
    expect(tracked, "取不到 HEAD 清单 ⇒ 未检，这一趟不构成读数").not.toBeNull();
    const text = ledgerText();
    const arm = checkCredentialSources(
      credentialPages(text),
      (dir) => credFaceFiles(REPO, dir),
      UNSOURCED_READINGS,
      CRED_UNNAMED_PAGE_CAP,
      CRED_WEAK_WITNESS_CAP,
      UNSOURCED_CRED_PAGES,
    );
    expect(arm.checked, "可比对读数：臂 ≠ 门").toBe(face.cred.checked);
    expect(arm.findings.length, "D-9 红数：臂 ≠ 门").toBe(face.cred.findings.length);
    expect(arm.unnamed).toBe(face.cred.unnamed);
    expect([...arm.unnamedPages].sort()).toEqual([...face.cred.unnamedPages].sort());
    expect([...arm.registeredPages].sort()).toEqual([...face.cred.registeredPages].sort());
    expect(arm.registeredReadings).toBe(face.cred.registeredReadings);
    expect(arm.unmatched).toBe(face.cred.unmatched);
    expect(arm.weak.length).toBe(face.cred.weak.length);
    expect(arm.weakUnjudged).toBe(face.cred.weakUnjudged);
    // D-11 同一口径（分面宽度由调用点决定，所以臂这里也要吃 `ANY_PAGE_HEAD`）
    const w = checkWitnessPaths(ledgerPages(text, ANY_PAGE_HEAD), tracked as Set<string>);
    expect(w.refs, "证人点名条数：臂 ≠ 门").toBe(face.witness?.refs);
    expect(w.pages, "点名页数：臂 ≠ 门").toBe(face.witness?.pages);
    expect(w.findings.length).toBe(face.witness?.findings.length);
  });
});
