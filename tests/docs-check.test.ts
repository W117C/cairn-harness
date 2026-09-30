// docs-check 判据的单元测试（spec §6 的 D-1/D-3/D-5，spec 在
// docs/superpowers/specs/2026-09-19-doc-layer-budget-design.md）。
//
// 判据一律是**纯函数**：输入内存里的文件表 / 文本，输出 findings，不触真实仓库——
// 这样每条 D 都能双向断言（红相命中 + 反相不误伤），且不依赖工作树状态。
// 真实文件读取只发生在该模块的 main()，由 `pnpm docs-check` 承担。
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  checkCredentialSources, CREDLEDGER_FILE, CRED_UNNAMED_PAGE_CAP, credentialPages, LEDGER_FILE, ledgerRevFace, ledgerRevTokens,
  credRunShas, CRED_WEAK_WITNESS_CAP, UNSOURCED_CRED_PAGES,
  LEDGER_NON_REV, runDocsCheck, sourcedReadings, UNSOURCED_READINGS,
} from "../scripts/docs-check";
import { REPLAY_READINGS, countInlineReplay, type ReplayReading } from "../scripts/replay-readings";
import {
  checkAppendOnlyCorrections,
  checkBudget,
  checkDocBinaries,
  checkLineCitations,
  checkObservedValues,
  checkReplay,
  checkStateRev,
  DOC_BUDGETS,
  LEGACY_WAIVERS,
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
    expect(d[0]!.detail).toContain("rev");
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
    expect(d[0]!.detail).toContain("pnpm facts");
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
    expect(d[0]!.detail).toContain("STATE.md");
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
    expect(Object.keys(LEDGER_NON_REV).length).toBe(3);
    const text = Object.keys(LEDGER_NON_REV).map((s) => `判卷 sha256 三件套（${s}…）`).join("\n");
    expect(ledgerRevFace(text, resolver([])).findings).toEqual([]);
    const stale = ledgerRevFace("第 1 页 凭证 @cccc333\n", resolver(["cccc333"]));
    // 断言**不抄生产那句句子**（规则 302：抄成品句＝判卷与被度量者一起改才响，`prose-needle-scan` 会把这种
    // 形状数成"顶包候选"——本笔就被它按帽挡过一次）。这里只问结构事实：每个被豁免的 sha 各出一条红、
    // 且红落在台账面上；措辞归生产端自己钉（本文件里只留一处措辞证人）。
    for (const sha of Object.keys(LEDGER_NON_REV)) {
      const hits = stale.findings.filter((f) => f.detail.includes(sha));
      expect(hits.length, `${sha} 不再在场，该有一条点名它的红`).toBe(1);
      expect(hits[0]?.rule).toBe("D-5");
      expect(hits[0]?.file).toBe(LEDGER_FILE);
    }
    expect(stale.findings.length, "红数恰等于豁免条数（多一条就是把别的格也算进来了）").toBe(3);
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
    expect(cred.registeredReadings, "登记页的读数条数要真从台账里抽出来（第 271 页现读＝19 条）").toBe(19);
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

  it("接线：主段把「未点名页」连同帽一起印出来，且判定真拿帽去比（只算不印＝这格永远没人看）", () => {
    const src = readFileSync(fileURLToPath(new URL("../scripts/docs-check.ts", import.meta.url)), "utf8");
    expect(src.length).toBeGreaterThan(0);
    expect(src).toMatch(/^ {2}const unnamedPageKeys = new Set<string>\(\);$/mu);
    expect(src).toMatch(/^ {2}if \(unnamedPageKeys\.size > cap\) \{$/mu);
    expect(src).toMatch(/^ {4}\+ `[^`\n]*未点名页 \$\{String\(cred\.unnamedPages\.length\)\} 页（帽 \$\{String\(CRED_UNNAMED_PAGE_CAP\)/mu);
    // 第 269 页新加的那半：弱证既要比帽、也要印出来，还得真的把按文件的取料面交给判定
    expect(src).toMatch(/^ {2}if \(weak\.length > weakCap\) \{$/mu);
    expect(src).toMatch(/^ {10}return \{ name: f, text \};$/mu);
    expect(src, "汇总行里弱证那一格要真取 cred.weak.length——印成常数就没人看得见").toMatch(/^ {4}\+ `｜弱证 \$\{String\(cred\.weak\.length\)\} 对（帽 \$\{String\(CRED_WEAK_WITNESS_CAP\)/mu);
    // 第 271 页的两态：登记要把页从『可行动』挪走，stale 检查与那列印数都得真接上
    expect(src).toMatch(/^ {6}if \(p\.key in pageWaivers\) \{$/mu);
    expect(src).toMatch(/^ {4}if \(namedKeys\.has\(key\)\) \{$/mu);
    expect(src).toMatch(/^ {4}\+ `｜已登记不可回查 \$\{String\(cred\.registeredPages\.length\)\} 页／\$\{String\(cred\.registeredReadings\)\} 条`\);$/mu);
    // 反向那一半：返回体丢了 unnamedPages／weak ⇒ 上面那些印不到，这一条先红
    expect(src).toMatch(/^ {2}return \{ findings: out, checked, unmatched, unnamed, unnamedPages: \[\.\.\.unnamedPageKeys\], registeredPages: \[\.\.\.registeredPageKeys\], registeredReadings, weak, weakUnjudged \};$/mu);
  });
});

