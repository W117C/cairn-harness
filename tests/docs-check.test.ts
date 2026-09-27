// docs-check 判据的单元测试（spec §6 的 D-1/D-3/D-5，spec 在
// docs/superpowers/specs/2026-09-19-doc-layer-budget-design.md）。
//
// 判据一律是**纯函数**：输入内存里的文件表 / 文本，输出 findings，不触真实仓库——
// 这样每条 D 都能双向断言（红相命中 + 反相不误伤），且不依赖工作树状态。
// 真实文件读取只发生在该模块的 main()，由 `pnpm docs-check` 承担。
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPLAY_READINGS, type ReplayReading } from "../scripts/replay-readings";
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

  it("豁免标记只保所在行，不豁免整个文件", () => {
    const text = '// docs-check:allow 只保这一行\nconst b = "BLOCKED.md:9";\n';
    expect(hit(checkLineCitations([s("t.ts", text)]), "D-3")).toHaveLength(1);
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
    const f = checkReplay([{ path: "docs/y.md", text: 'a\nnode --import tsx -e "$(cat <<TS\nx\nTS\n)"\nnode --import tsx -e 又一条' }], hasFile, []);
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain("2");
    expect(f[0]!.file).toBe("docs/y.md");
  });

  it("真登记表里每条脚本都真在盘上（防「表写了、文件没了」这一格没人看）", () => {
    const root = join(import.meta.dirname, "..");
    for (const r of REPLAY_READINGS) expect(existsSync(join(root, r.script)), r.script).toBe(true);
  });

  it("迁移后无存量豁免：内联复跑块直接判红", () => {
    expect(Object.keys(LEGACY_WAIVERS)).toHaveLength(0);
    const findings = checkReplay(
      [{ path: "docs/new.md", text: "node --import tsx -e x" }],
      () => false,
      [],
    );
    expect(waive(findings).kept.map((f) => f.file)).toEqual(["docs/new.md"]);
  });
});

