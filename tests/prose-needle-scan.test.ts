/** 「诊断文案 ↔ 断言收料」这把尺的判卷面（第 92 页）。
 *  分两层：纯函数用合成夹具（每条判态各钉一格，含两格反控）；最后一条打**真仓**——
 *  它同时是本面的"不许空载"自检（挑不到料就是尺坏了，不是全绿）。 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  applyWaivers,
  agedInFlight,
  blankComments,
  classifyNeedles,
  collectNeedles,
  copyCount,
  copySites,
  emittedChunks,
  extractLiterals,
  isAnchorTable,
  ceilingBreaches,
  isBareNameNeedle,
  isInputRegistry,
  KNOWN_NON_DRIFT,
  levelVsCap,
  onlyTestSuppliedIntegers,
  scanRepo,
  SCOPE_CEILINGS,
  SELF_EXCLUDED_TESTS,
  sharesOneSentence,
  shadowFilesOf,
  splitByInFlight,
  STALE_IN_FLIGHT_MS,
  staticRuns,
  treeScopeOf,
  type CopySite,
  type ProseNeedle,
} from "../scripts/prose-needle-scan";

const src = (path: string, text: string) => ({ path, text });

describe("collectNeedles：只收『按诊断字段收字面量』那一类", () => {
  const t = [
    `expect(m.reason).toContain("不足两次同配置重复");`,
    `expect(v.why).toContain("诚实句=1");`,
    `expect(r.detail).includes("预算");`,
    `expect(p.note).toMatch("模型面预算");`,
    // 反向一侧：`.not.` 不要求存在 ⇒ 不许收（收了就会把健康的反向断言报成漂）
    `expect(v.why).not.toContain("无人照做");`,
    // 非诊断字段（被测内容/异常消息）⇒ 不收
    `expect(out.text).toContain("api_key");`,
    `expect(err.message).toContain("rate_limited");`,
    // 变量实参：没有字面量可对 ⇒ 不收
    `expect(d.reason).toContain(SHIP.sha);`,
  ].join("\n");
  const collected = collectNeedles("x.test.ts", t);
  const got = collected.needles;

  it("四个诊断字段各收一条，带行号与解出来的字面量", () => {
    expect(got.map((g) => [g.field, g.line])).toEqual([["reason", 1], ["why", 2], ["detail", 3], ["note", 4]]);
    expect(got[0]!.needle).toBe("不足两次同配置重复");
    expect(got.every((g) => g.via === "字段直取")).toBe(true);
    expect(collected.unresolved).toBe(0);
  });

  it("`.not.toContain`／非诊断字段／变量实参 三支都不收（各钉一格，免得哪天顺手放宽）", () => {
    expect(got.some((g) => g.needle.includes("无人照做"))).toBe(false);
    expect(got.some((g) => g.needle.includes("api_key"))).toBe(false);
    expect(got.some((g) => g.needle.includes("rate_limited"))).toBe(false);
    expect(got.some((g) => g.needle.includes("SHIP"))).toBe(false);
  });

  it("转义态要解成真字符再比（源码里写的是 \\\" 与 \\n）", () => {
    const esc = `expect(x.reason).toContain("读数里带 \\"引号\\" 和 \\n 换行");`;
    const one = collectNeedles("y.test.ts", esc).needles;
    expect(one).toHaveLength(1);
    expect(one[0]!.needle).toContain('"引号"');
    expect(staticRuns(one[0]!.needle).length).toBeGreaterThan(0);
  });
});

// 第 95 页的加宽。旧版把「`.字段` 紧跟闭括号」这一种写法编进正则，于是**同族换写法即静默绕过**
// （规则 122）：真仓里 `reasonOf(d)).toContain("轮次上限")`、`const reason = …; expect(reason)`
// 两种写法各有 7 条与 1 条，全面一条不认——水位读数因此一直停在"82 条，一切正常"。
describe("collectNeedles 加宽：认「取料来源」而不是认写法", () => {
  const wide = [
    `function reasonOf(d: GoalStop): string {`,
    `  if (d.kind !== "stop") throw new Error("形状不对");`,
    `  return d.reason;`,
    `}`,
    `expect(reasonOf(d)).toContain("已用尽而目标未达成");`,
    `const why = stops[0]?.detail ?? "";`,
    `expect(why).toContain("模型面预算已经花完");`,
    `expect(x.reason ?? "").toContain("美元闸本次不生效");`,
    `function labelOf(d: Thing) { return d.title }`,
    `expect(labelOf(d)).toContain("非诊断字段的内容");`,
  ].join("\n");
  const got = collectNeedles("w.test.ts", wide).needles;

  it("本地 helper／字段别名／字段后面还隔表达式 三族各收一条，并记下是**怎么**取到料的", () => {
    expect(got.map((g) => [g.via, g.field, g.needle])).toEqual([
      ["本地 helper", "reason", "已用尽而目标未达成"],
      ["字段别名", "detail", "模型面预算已经花完"],
      ["字段直取", "reason", "美元闸本次不生效"],
    ]);
  });

  it("helper 读的不是诊断字段 ⇒ 那一族不收（反向一侧：加宽不许变成什么都收）", () => {
    expect(got.some((g) => g.needle === "非诊断字段的内容")).toBe(false);
  });

  it("测试自己喂进去的标签被抄回文案 ⇒ `suppliedInTest`＝true（第五态的料）", () => {
    const echoFile = [
      `const g = stallGuard(60, "测试调用");`,
      `expect(String(g.signal.reason)).toContain("测试调用");`,
      `expect(String(g.signal.reason)).toContain("停滞超时");`,
    ].join("\n");
    const rows = collectNeedles("e.test.ts", echoFile).needles;
    expect(rows.map((r) => [r.needle, r.suppliedInTest])).toEqual([["测试调用", true], ["停滞超时", false]]);
  });
});

describe("classifyNeedles：五态各自点名，一条不许静默归进『没问题』", () => {
  const n = (needle: string, field = "reason", suppliedInTest = false): ProseNeedle => ({
    file: "a.test.ts", line: 1, field, via: "字段直取", needle, suppliedInTest,
  });

  it("① 生产侧逐字有（且出现在该字段名的邻域）⇒ verbatim，并点名是哪个文件", () => {
    const [v] = classifyNeedles([n("本格没有自己的噪声底")], [src("scripts/lib/x.ts", 'reason = "本格没有自己的噪声底"')]);
    expect(v!.kind).toBe("verbatim");
    expect(v!.detail).toBe("scripts/lib/x.ts");
  });

  // 这条钉的是**顶包风险的可见性**：造红实测第一版只问"仓里有没有这串字"，于是同模块另一句无关
  // 文案替被锚定的那一句喂饱了断言（错报 0 drift）。静态取料分不开"哪一句喂的"（那要数据流），
  // 但**副本数**分得开 ⇒ 出现两处就必须出声（`copies > 1` 进顶包候选清单）。
  it("①b 同一段落在**两个函数**的字面量里 ⇒ verbatim，但 copies=2（不许读成「只有一处在管」）", () => {
    const prod =
      'function magnitudeOfAb() {\n  reason = "不足两次同配置重复"\n}\n' +
      'function repRowLine() {\n  return "样本不足（不足两次同配置重复）"\n}';
    const [v] = classifyNeedles([n("不足两次同配置重复")], [src("scripts/lib/dup.ts", prod)]);
    expect(v!.kind).toBe("verbatim");
    expect(v!.copies).toBe(2);
  });

  it("①c 同一函数里出现两次 ⇒ copies 仍算 1（数的是「哪几处在管」，不是出现次数）", () => {
    const prod = 'function one() {\n  reason = "甲乙丙丁戊"\n  const tip = "（甲乙丙丁戊）"\n}';
    const [v] = classifyNeedles([n("甲乙丙丁戊")], [src("scripts/lib/a.ts", prod)]);
    expect(v!.copies).toBe(1);
  });

  it("①d 只有一处 ⇒ copies=1；单副本顶包要靠数据流才分得开，本面不假装能判（上限写明）", () => {
    const [v] = classifyNeedles([n("本格没有自己的噪声底")], [src("scripts/lib/one.ts", 'function f() { reason = "本格没有自己的噪声底" }')]);
    expect(v!.copies).toBe(1);
  });

  it("② 段都在同一文件、只是中间隔了插值 ⇒ across-interpolation（不是漂）", () => {
    // 真语料里就有这一格（replay-prune-promise 的「诚实句=1」）：断言收的是整串，
    // 生产侧写的是 `诚实句=${String(honest)}` ⇒ 静态段"诚实句"在，等号后面那个数是运行时值。
    const [v] = classifyNeedles(
      [n("诚实句=1")],
      [src("scripts/replay/prune-promise.ts", "why = `假承诺=${String(fake)} 诚实句=${String(honest)}`")],
    );
    expect(v!.kind).toBe("across-interpolation");
    expect(v!.detail).toBe("scripts/replay/prune-promise.ts");
  });

  it("③ 收的是算出来的值 ⇒ non-prose（不许报成 drift 制造噪声）", () => {
    const [v] = classifyNeedles([n("30001"), n("2506 / 2506")], [src("scripts/lib/z.ts", "x")]);
    expect(v!.kind).toBe("non-prose");
  });

  it("④ 有段在任何生产文件里都对不齐 ⇒ drift，并点名**那一段**（不是整串）", () => {
    const [v] = classifyNeedles(
      [n("本格没有同配置重复，也就没有自己的噪声底")],
      [src("scripts/lib/w.ts", "reason = `每臂可用样本 ${String(count)} 次 ⇒ 本格没有重复`")],
    );
    expect(v!.kind).toBe("drift");
    expect(v!.lostRun).toBe("本格没有同配置重复");
  });

  it("跨文件凑段不算 across（两半分别落在两个文件里 ⇒ 仍是 drift）", () => {
    const [v] = classifyNeedles(
      [n("前半段甲乙丙丁")],
      [src("a.ts", 'reason = "前半段"'), src("b.ts", 'reason = "甲乙丙丁"')],
    );
    expect(v!.kind).toBe("drift");
  });

  // 第五态是第 95 页加宽收料面时现形的：`stallGuard(60, "测试调用")` 之后断言 reason 里带「测试调用」——
  // 那句是测试自己给的标签被抄回文案，生产侧**本来就不该有**。四态模型里它只能落进 drift，
  // 于是这条健康的回显断言天天红（真仓实测 1 条），而"天天红的判据"下一个人就当噪声绕过去了。
  it("⑤ 生产侧一段都对不上、但测试自己就有一份 ⇒ echo-caller-text（回显，不是漂）", () => {
    const [v] = classifyNeedles(
      [n("测试调用", "reason", true)],
      [src("src/main/net.ts", 'reason = new Error("停滞超时：" + label)')],
    );
    expect(v!.kind).toBe("echo-caller-text");
  });

  it("反向一侧：测试自己有一份，但**另一段**在生产侧也对不齐 ⇒ 仍是 drift（echo 不许当逃生口）", () => {
    const [v] = classifyNeedles(
      [n("停滞超时 但后半句生产侧没有", "reason", true)],
      [src("src/main/net.ts", 'reason = new Error("停滞超时：" + label)')],
    );
    expect(v!.kind).toBe("drift");
    expect(v!.lostRun).toBe("但后半句生产侧没有");
  });

  // 第 116 页两棵树并排跑现形的**假红灯**：`tests/docs-check.test.ts:156` 断 `toContain("水位 30000")`，
  // 而生产那句是 `；存量水位 ${String(wa.upTo)}（…）`——散文段 `水位` 抽得到，缺的那个数是测试
  // 自己用 `w(30_000)` 喂进去的。`suppliedInTest` 只认「整串另有一处」，而 `30_000` 与 `"30000"`
  // 是同一个数、不是同一个字面量 ⇒ 旧写法一律落进 drift。主树里它被「在飞」按住，
  // 干净的 HEAD 树里它自己红（规则 58 的新变体：**跑一棵树 ≠ 跑那把尺**）。
  it("⑤b 缺的那半是测试自己给的整数（数字分隔符写法不同）⇒ echo，不是 drift", () => {
    const prod = src(
      "scripts/docs-check.ts",
      "kept.push({ detail: `；存量水位 ${String(wa.upTo)}（超出即新增违规）` });",
    );
    const testText = "const d = waive(over(30_001), w(30_000)).kept;\nexpect(d[0]!.detail).toContain(\"水位 30000\");";
    const [v] = classifyNeedles([n("水位 30000", "detail")], [prod], new Map([["a.test.ts", testText]]));
    expect(v!.kind).toBe("echo-caller-text");
    expect(v!.detail).toContain("测试自己喂进去的整数");
  });

  it("⑤b 反向一侧：生产侧改成带千位分隔的写法，而测试给的对不上 ⇒ 仍是 drift", () => {
    const prod = src(
      "scripts/docs-check.ts",
      "kept.push({ detail: `；存量水位 ${formatThousands(wa.upTo)}（超出即新增违规）` });",
    );
    const testText = "const d = waive(over(30_001), w(30_000)).kept;";
    const [v] = classifyNeedles([n("水位 30 000", "detail")], [prod], new Map([["a.test.ts", testText]]));
    expect(v!.kind).toBe("drift");
  });

  it("⑤b 只免「缺的全是值」那一格：散文段也没见证时不许当 echo（seen 空 ⇒ 仍走原路）", () => {
    const [v] = classifyNeedles(
      [n("压根没有的散文 30000", "detail")],
      [src("scripts/docs-check.ts", "kept.push({ detail: `；存量水位 ${String(wa.upTo)}` });")],
      new Map([["a.test.ts", "w(30_000)"]]),
    );
    expect(v!.kind).toBe("drift");
  });

  it("onlyTestSuppliedIntegers 的取值域：整数收、小数/带单位不收、空集不收", () => {
    expect(onlyTestSuppliedIntegers(["30000"], "const d = w(30_000);")).toBe(true);
    expect(onlyTestSuppliedIntegers(["0.1"], "const t = 0.1;")).toBe(false);
    expect(onlyTestSuppliedIntegers(["30000", "ms"], "30_000 ms")).toBe(false);
    expect(onlyTestSuppliedIntegers([], "30_000")).toBe(false);
    expect(onlyTestSuppliedIntegers(["30000"], "const d = w(31_000);")).toBe(false);
  });

  // 这条是第 95 页**我自己踩的**：在生产侧注释里写了「测试调用」，`tests/net.test.ts:54` 那条真 drift
  // 就被读成 verbatim，报告上写着 `drift 0`。取料面用正则找引号对，分不清那对引号在不在注释里
  // ——而"被提到 ≠ 被引用"是规则 190 记过的同一格方向。
  it("⑥ 那段文字在生产侧只躺在**注释**里 ⇒ drift（注释不是文案，别把提到当引用）", () => {
    const [v] = classifyNeedles(
      [n("只有注释提到它")],
      [src("scripts/lib/c.ts", '// 只有注释提到它\nfunction f() {\n  reason = "别的文案";\n}')],
    );
    expect(v!.kind).toBe("drift");
    expect(v!.lostRun).toBe("只有注释提到它");
  });

  // 第 95 页词法改造的靶：正则扫引号时，**正则字面量里的引号**会让扫描器错开一整段，
  // 于是它后面的真字面量整段读不到（`src/permissions/risk.ts` 的威胁表 `/echo\s+["']…/` 就是这样，
  // 实测该文件 127 段字面量只收到几条 ⇒ 生产侧被指认成"没有这段"）。
  it("⑦ 正则字面量里的引号不许吞掉后面的真字面量（词法取料，不是正则扫引号）", () => {
    const prod = "const PAT = /[\"']/;\nfunction f() {\n  reason = \"这段是生产文案\";\n}";
    const [v] = classifyNeedles([n("这段是生产文案")], [src("src/permissions/risk.ts", prod)]);
    expect(v!.kind).toBe("verbatim");
    expect(v!.copies).toBe(1);
  });
});

describe("blankComments：等长涂白，行号与偏移一律不漂", () => {
  const t = 'const a = 1; // 注释里的 "测试调用" 不是文案\n/* 块注释 "测试调用" */\nconst b = "真文案 测试调用";';

  it("长度不变、注释内容读不到、真字面量还在", () => {
    const blanked = blankComments(t);
    expect(blanked.length).toBe(t.length);
    expect(blanked.split("\n").length).toBe(t.split("\n").length);
    expect(blanked.slice(t.indexOf("const b")).includes("真文案")).toBe(true);
    expect(extractLiterals("x.ts", t).map((c) => c.chunk)).toEqual(["真文案 测试调用"]);
  });

  it("反向一侧：字符串里的 `//` 与引号不许被当成注释（涂过头会把真字面量抹掉⇒ 尺变瞎）", () => {
    const s = 'const u = "http://example.com/测试调用";';
    expect(extractLiterals("y.ts", s).map((c) => c.chunk)).toEqual(["http://example.com/测试调用"]);
  });
});

describe("splitByInFlight：判据判已提交态，在飞的那一半必须单列点名", () => {
  const rows = [{ file: "tests/clean.test.ts" }, { file: "tests/flying.test.ts" }];
  const s = splitByInFlight(rows, new Set(["tests/flying.test.ts"]));

  it("干净文件的账算我的，在飞文件的账不算我的——但两边都要在清单上", () => {
    expect(s.committed.map((r) => r.file)).toEqual(["tests/clean.test.ts"]);
    expect(s.flying.map((r) => r.file)).toEqual(["tests/flying.test.ts"]);
    expect(s.committed.length + s.flying.length).toBe(rows.length);
  });

  it("在飞集合为空 ⇒ 全部计入（排除面不许把自己关小）", () => {
    const all = splitByInFlight(rows, new Set<string>());
    expect(all.committed.length).toBe(rows.length);
    expect(all.flying).toEqual([]);
  });
});

describe("影子池：登记表的引用与用例表的输入都不算生产者", () => {
  // 两条谓词都只看**内容**（成批 `expectFail:` / 成批导出的字符串数组常量），不写文件名清单——
  // 表改名、搬目录、换执行器都还认得（规则 122）。
  const anchorPath = "scripts/mutate-verify.mjs";
  const casePath = "scripts/lib/cases.ts";
  const realPath = "src/agent/goal.ts";
  const table = (times: number): string =>
    Array.from({ length: times }, (_, i) => `  { apply: (s) => s, expectFail: "用例 ${String(i)}" },`).join("\n");
  const registry = (lists: number): string =>
    Array.from({ length: lists }, (_, i) => `export const CASES_${String(i)}: string[] = [\n  "样本 ${String(i)}",\n];`).join("\n");
  const nd = (file: string, sought: string, suppliedInTest = false): ProseNeedle => ({
    file, line: 1, field: "reason", via: "字段直取", needle: sought, suppliedInTest,
  });
  const sources = [
    src(realPath, 'function gate() {\n  reason = "美元闸本次不生效";\n}'),
    src(anchorPath, table(60) + '\nfunction probe() {\n  why = "美元闸本次不生效";\n}'),
    src(casePath, registry(6) + '\nexport const CMD: string[] = [\n  "setsid 强推样本",\n];'),
  ];

  it("谓词两侧：登记表按 `expectFail:` 成批，用例表按'导出字符串数组常量＋零导出函数'", () => {
    expect(isAnchorTable(table(50))).toBe(50);
    expect(isAnchorTable(table(2))).toBe(0);
    expect(isInputRegistry(registry(6))).toBe(6);
    // 有导出函数就不是"只有数据的清单"——那条判据不许把生产者文件吸进影子池
    expect(isInputRegistry(registry(6) + "\nexport function f() {\n  return 1;\n}\n")).toBe(0);
    expect(shadowFilesOf(sources).map((s) => s.kind)).toEqual(["登记表", "用例表"]);
  });

  it("真生产者 ＋ 登记表引用 ⇒ verbatim、copies=1，而 rawCopies=2 一并交出", () => {
    const [v] = classifyNeedles([nd("tests/a.test.ts", "美元闸本次不生效")], sources);
    expect([v!.kind, v!.copies, v!.rawCopies]).toEqual(["verbatim", 1, 2]);
  });

  it("反向一侧 A：断言点名**登记表** ⇒ 那张表对它而言就是生产者（判卷面自己的 `.why` 就产自它）", () => {
    const [v] = classifyNeedles(
      [nd("tests/gates.test.ts", "美元闸本次不生效")], sources,
      new Map([["tests/gates.test.ts", 'import { main } from "../scripts/mutate-verify.mjs";']]),
    );
    expect(v!.copies).toBe(2);
  });

  it("反向一侧 B：点名**用例表**不算——那字面量是 import 进来的输入，被断言那句是判据插值的", () => {
    const [v] = classifyNeedles(
      [nd("tests/b.test.ts", "setsid 强推样本")], sources,
      new Map([["tests/b.test.ts", 'import { CMD } from "../scripts/lib/cases";']],),
    );
    expect(v!.kind).toBe("drift");
    expect(v!.copies).toBe(0);
  });

  it("同一串是测试自己喂进去的输入 ⇒ 落 echo（本轮 setsid 那格的真实态），既不算顶包也不算漂", () => {
    const [v] = classifyNeedles([nd("tests/c.test.ts", "setsid 强推样本", true)], sources);
    expect(v!.kind).toBe("echo-caller-text");
  });

  it("唯一副本就在登记表里、断言也没点名它 ⇒ drift（引用不许被读成 verbatim）", () => {
    const [v] = classifyNeedles(
      [nd("tests/d.test.ts", "只在锚点描述里的句子")],
      [src(anchorPath, table(60) + '\nfunction probe() {\n  desc = "只在锚点描述里的句子";\n}'), src(realPath, 'function gate() {\n  reason = "别的文案";\n}')],
    );
    expect(v!.kind).toBe("drift");
    expect(v!.copies).toBe(0);
  });

  // 点名豁免回灌那张表时，**只回灌它产出的字段**。登记表每条锚点都带一句 `desc:`（给人读的缺陷说明），
  // 它永远不流进任何输出，可它常常顺手抄着生产侧那句话——实测就是把一条本来唯一的针脚垫成"2 处副本＝顶包"。
  const proseTable =
    'function rowA() {\n  return { id: "a", desc: "只有散文栏有这句" };\n}\n' +
    'function rowB() {\n  return { id: "b", expectFail: "只有产出栏有那句" };\n}\n' +
    table(60);
  const proseSources = [
    src(realPath, 'function gate() {\n  reason = "只有散文栏有这句";\n}\nfunction gate2() {\n  reason = "只有产出栏有那句";\n}'),
    src(anchorPath, proseTable),
  ];
  const namedTable = new Map([["tests/e.test.ts", 'spawnSync("node", ["scripts/mutate-verify.mjs"])']]);

  it(`点名豁免分字段：表里 \`desc:\` 的散文不算生产者，\`expectFail:\` 那栏照算`, () => {
    const [prose] = classifyNeedles([nd("tests/e.test.ts", "只有散文栏有这句")], proseSources, namedTable);
    expect([prose!.kind, prose!.copies, prose!.rawCopies]).toEqual(["verbatim", 1, 2]);
    // 反向一侧（同一条豁免的另一边）：表**产出**的那栏仍然算——判卷面收的就是它
    const [emitted] = classifyNeedles([nd("tests/e.test.ts", "只有产出栏有那句")], proseSources, namedTable);
    expect([emitted!.kind, emitted!.copies]).toEqual(["verbatim", 2]);
  });

  it("字面量要带得上所在的属性键（豁免分字段靠它），且不因此多收/少收一段", () => {
    const got = extractLiterals("t.ts", 'const T = [{ note: "甲", desc: "乙" }];\nconst top = "丙";');
    expect(got.map((c) => [c.key, c.chunk])).toEqual([["note", "甲"], ["desc", "乙"], ["", "丙"]]);
    expect(emittedChunks(got).map((c) => c.chunk)).toEqual(["甲", "丙"]);
  });
});

describe("copySites：计数要点得出名（两把尺互检）", () => {
  const pool = [
    // f1 里故意放**两段**同样的字面量：同一函数只算一处（否则"同一句里出现两次"会被读成两处）
    ...extractLiterals("src/a.ts", 'function f1() {\n  reason = "这一句出现了两次";\n  note = "这一句出现了两次";\n}\nfunction f2() {\n  reason = "这一句出现了两次";\n}'),
    ...extractLiterals("scripts/b.ts", 'function main() {\n  const s = "这一句出现了两次";\n}'),
    ...extractLiterals("scripts/c.ts", 'function g() {\n  const t = "别的文案";\n}'),
    // 第四处是**故意**加的：少于 4 处时，"只交前 3 个名字"这种截断骗得过下面那条互检（3==3 也成立）。
    ...extractLiterals("scripts/d.ts", 'function h() {\n  const u = "这一句出现了两次";\n}'),
  ];
  it("同一函数的两段算一处、不同函数各算一处，顺序＝取料顺序", () => {
    expect(copySites(pool, "这一句出现了两次").map((s) => s.site))
      .toEqual(["src/a.ts#f1", "src/a.ts#f2", "scripts/b.ts#main", "scripts/d.ts#h"]);
  });

  // 光有名字仍会误判：第 101 页我就是只读 `path#fn`，把"共享一个词的两句话"记成了"脚本抄了产品文案"。
  // 所以每一处还要交出**那一处的句子**——同句抄写 ⇒ 修代码；同词两句 ⇒ 换针脚。
  it("每一处都交出句子：同句抄写与同词两句分得开（两侧各一条）", () => {
    expect(new Set(copySites(pool, "这一句出现了两次").map((s) => s.text))).toEqual(new Set(["这一句出现了两次"]));
    const mixed = copySites(
      [...pool, ...extractLiterals("scripts/e.ts", 'function k() {\n  const v = "这一句出现了两次，可这里还有半句";\n}')],
      "这一句出现了两次",
    );
    expect(new Set(mixed.map((s) => s.text)).size).toBe(2);
    // 分族谓词两侧：同句 ⇒ true（夹具四处一句）；各处句子不同 ⇒ false
    expect(sharesOneSentence(copySites(pool, "这一句出现了两次"))).toBe(true);
    expect(sharesOneSentence([
      { site: "src/a.ts#one", text: "第一句里也有这个词" },
      { site: "src/b.ts#two", text: "第二句里也有这个词" },
    ])).toBe(false);
  });
  // `copyCount` 与 `copySites` 是**两份独立实现**（不互相委托）：一份按 NUL 分隔、一份按 `#`。
  // 哪天口径漂了（比如某个路径里出现 `#`），这一条会响——计数与名字必须互为对账，不同源（规则 184）。
  it("与 `copyCount` 对得上（同口径互检）", () => {
    for (const needle of ["这一句出现了两次", "别的文案", "根本没有的句子"])
      expect(copySites(pool, needle).length).toBe(copyCount(pool, needle));
  });
});

// 第三族（第 105 页）：针脚收的是**一个名字**时，那 N 处"副本"里大多是 import 路径与别处的工具清单，
// 一条都流不进被断言的字段 ⇒ 这一族既不能靠"改代码"也不能靠"换一句"摘掉，只能改成派生断言。
// 所以它不是软列表而是**红**；红就得两侧钉住：漏认（这一族永远空）与误收（把整句收进来）都要响。
describe("isBareNameNeedle：裸名字的针脚不是『再挑一个词』能修的", () => {
  it("一个名字 ⇒ 是；句子里的一个词 ⇒ 不是（两侧）", () => {
    for (const t of ["grep", "read_file", "/pol:sec", "STATE.md"]) expect(isBareNameNeedle(t)).toBe(true);
    for (const t of ["从可见工具表摘除", "pnpm facts", "参数一字不变=0", "——匹配按完整 token 为界"])
      expect(isBareNameNeedle(t)).toBe(false);
    // 长度上限是这条谓词唯一的"软"处：12 个字符以内才算名字。两侧各钉一格，
    // 免得哪天有人把上限放宽到能装下一句人话——那会让"整句"也落进这一族、永远不红。
    expect(isBareNameNeedle("0123456789ab")).toBe(true);
    expect(isBareNameNeedle("0123456789abc")).toBe(false);
    expect(isBareNameNeedle("")).toBe(false); // 空针脚不算名字（它是 non-prose，另一族）
  });
});

describe("treeScopeOf：帽挂在树的形状上，不挂在『今天扫的是哪棵树』的心情上（第 108 页）", () => {
  it("两侧各有格：有 renderer ⇒ 含桌面层，没有 ⇒ core-only（恒真＝永远拿宽帽，恒假＝HEAD 验跑红在别人的账上）", () => {
    expect(treeScopeOf(true)).toBe("含桌面层");
    expect(treeScopeOf(false)).toBe("core-only");
  });

  it("帽表两行都要在，且窄帽不许比宽帽松（否则分树等于没分）", () => {
    expect(Object.keys(SCOPE_CEILINGS).sort()).toEqual(["core-only", "含桌面层"].sort());
    for (const k of ["multiCopy", "bareName"] as const) {
      expect(SCOPE_CEILINGS["core-only"][k]).toBeLessThanOrEqual(SCOPE_CEILINGS["含桌面层"][k]);
    }
    // 分歧格：两行必须**不一样**，完全相同的两行＝这条分层是装饰（判据在，但没有它会红的输入）。
    expect(SCOPE_CEILINGS["core-only"]).not.toEqual(SCOPE_CEILINGS["含桌面层"]);
  });
});

describe("levelVsCap：棘轮比的是『盘上有就算』的总数，不是『已入库多少』（第 118 页改的判据位置）", () => {
  it("在飞那一半必须算账：全格子都在飞文件里 ⇒ 照样超帽（旧写法比 committed，这一格永远绿着＝落库当天必红）", () => {
    const l = levelVsCap(0, 5, 3);
    expect(l.total).toBe(5);
    expect(l.over).toBe(true);
  });

  it("两半相加＝比的那个数；等于帽不算涨（『只准降』的边界是 >，不是 >=）", () => {
    expect(levelVsCap(3, 6, 10)).toEqual({ total: 9, over: false });
    expect(levelVsCap(7, 3, 10)).toEqual({ total: 10, over: false });
    expect(levelVsCap(7, 4, 10).over).toBe(true);
  });

  // 反向一侧：两半全零必须算"一致且不涨"，不许被读成异常（同第 115 页"全零那侧交空串且算一致"那一族）。
  it("两半全零＝正常空载，over 为 false（不许把 0 读成取料面有洞）", () => {
    expect(levelVsCap(0, 0, 0)).toEqual({ total: 0, over: false });
  });
});

describe("ceilingBreaches：帽的两处比较收成**一个**决策点，判卷与 CLI 吃同一份（第 118 页）", () => {
  const row = (file: string): { file: string; line: number; field: string; needle: string } => ({
    file,
    line: 7,
    field: "detail",
    needle: "x",
  });
  const none = { scope: "core-only" as const, committedMultiCopy: 0, inFlightMultiCopy: 0, bareName: [], inFlightBareName: [] };

  // 这一条就是造红 M0 的克星：把比较退回"只数已提交态"，`在飞 11` 就不出声，两条断言同时红。
  it("在飞那一半超帽必须出声，且文案交出两半各自的数", () => {
    const b = ceilingBreaches({ ...none, inFlightMultiCopy: 11 });
    expect(b.multi).toContain("顶包候选 11");
    expect(b.multi).toContain("在飞 11");
    expect(b.bare).toBe("");
  });

  it("裸名字两半之和超帽 ⇒ 逐格点名（只给总数＝本仓点过名的逃生口）", () => {
    const b = ceilingBreaches({
      ...none,
      bareName: [row("tests/a.test.ts")],
      inFlightBareName: [row("tests/b.test.ts"), row("tests/c.test.ts")],
    });
    expect(b.bare).toContain("裸名字的顶包格 3");
    expect(b.bare).toContain("tests/c.test.ts:7");
  });

  it("帽内输入两条都交空串（空串＝没有红，不是缺读数）；帽按 scope 取宽窄两行", () => {
    expect(ceilingBreaches(none)).toEqual({ multi: "", bare: "" });
    // 同一组格子在宽帽那行不红、在窄帽那行红 ⇒ 证明帽真的按 scope 取，不是写死一个数
    const wide = ceilingBreaches({ ...none, scope: "含桌面层", inFlightBareName: [row("t1"), row("t2"), row("t3")] });
    const narrow = ceilingBreaches({ ...none, scope: "core-only", inFlightBareName: [row("t1"), row("t2"), row("t3")] });
    expect(wide.bare).toBe("");
    expect(narrow.bare).toContain("裸名字的顶包格 3");
  });

  // 纯函数钉不住接线：只钉上面三条时，把 CLI 换回内联比较仍然 60 条全绿（本轮 M0 实跑过）。
  it("接线钉：CLI 里调 `ceilingBreaches(r)` 恰好一次，且旧的内联比较在**代码行**里已绝迹", () => {
    const raw = readFileSync(new URL("../scripts/prose-needle-scan.ts", import.meta.url), "utf8");
    // 只留代码行：注释里为了讲清"为什么换"必须抄一遍旧写法，拿全文匹配会把叙述当成缺陷（本仓老账：命中≠问题）。
    const code = raw
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect((code.match(/ceilingBreaches\(r\)/g) ?? []).length).toBe(1);
    for (const dead of ["r.committedMultiCopy > cap", "r.bareName.length > cap"]) {
      expect(code.includes(dead)).toBe(false);
    }
    // 反向钉，防这条针脚空转：旧写法应当**只**活在注释里——全文命中、代码行不命中。
    expect(raw.includes("r.committedMultiCopy > cap")).toBe(true);
  });
});

describe("agedInFlight：「在飞」有两种，年龄只作读数不作判据（第 113 页）", () => {
  const H = 60 * 60 * 1000;
  it("两侧各有格：25h 前进名单、1h 前不进；恰好 24h 算过期（>=）", () => {
    const now = 1_700_000_000_000;
    const r = agedInFlight(
      [
        { file: "src/old.ts", mtimeMs: now - 25 * H },
        { file: "src/fresh.ts", mtimeMs: now - 1 * H },
        { file: "src/edge.ts", mtimeMs: now - STALE_IN_FLIGHT_MS },
      ],
      now,
    );
    expect(r).toEqual(["src/old.ts", "src/edge.ts"]);
  });

  it("空输入交空名单（不许把「没有在飞文件」读成「全都在飞」，也不许造一个假名字）", () => {
    expect(agedInFlight([], Date.now())).toEqual([]);
  });

  it("阈值可传（默认 24h 是**登记值**，不是写在调用点的一个数）", () => {
    const now = 1_700_000_000_000;
    expect(agedInFlight([{ file: "a", mtimeMs: now - 3 * H }], now)).toEqual([]);
    expect(agedInFlight([{ file: "a", mtimeMs: now - 3 * H }], now, 2 * H)).toEqual(["a"]);
  });
});

describe("applyWaivers：豁免要带理由，且不许静默烂在这儿", () => {
  const drift = (file: string, lostRun: string) => ({
    file, line: 1, field: "reason", via: "字段直取" as const, needle: lostRun, suppliedInTest: false,
    kind: "drift" as const, detail: "", lostRun, copies: 0, rawCopies: 0, copySites: [] as CopySite[],
  });

  it("名单内的 drift 被压住（但单列 waived，不折进 verbatim）", () => {
    const r = applyWaivers([drift("tests/docs-check.test.ts", "30000")], { "tests/docs-check.test.ts|30000": "夹具值" });
    expect(r.rows[0]!.waived).toBe(true);
    expect(r.stale).toEqual([]);
  });

  it("登记了却不再命中 ⇒ stale-waiver 点名（逼人删掉它）", () => {
    const r = applyWaivers([], { "tests/gone.test.ts|那段": "旧理由" });
    expect(r.stale).toEqual(["tests/gone.test.ts|那段"]);
  });

  it("名单外新增的 drift 压不住（棘轮：不许靠改登记表蒙过去）", () => {
    const r = applyWaivers([drift("tests/new.test.ts", "新的漂了")], { "tests/docs-check.test.ts|30000": "夹具值" });
    expect(r.rows[0]!.waived).toBe(false);
  });
});

describe("真仓扫：这把尺自己不许空载", () => {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const r = scanRepo(root);
  // 帽不再在这里手抄：真仓那条直接调 `ceilingBreaches(r)`（判卷与 CLI 同一份），
  // 自己 `SCOPE_CEILINGS[r.scope]` 取一次＝把判据抄第二遍，第 108 页那族错误的正身。

  it("挑得到收料断言（0 条＝尺坏了，不是全绿）", () => {
    expect(r.needles).toBeGreaterThan(20);
    expect(r.sourceFiles).toBeGreaterThan(50);
  });

  it("报告那行「树＝」必须真是这棵树的形状（换一把原语互检接线）", () => {
    // 纯函数用例只钉得住谓词，钉不住"接线读的是哪个路径"：`src/renderer` 写成 `src/renderers`
    // 时谓词依旧正确，只是恒假 ⇒ 帽永远取窄的那行，HEAD 验跑红在别人的账上（第 108 页那 4 格就是这个形状）。
    const hasRenderer = readdirSync(resolve(root, "src")).includes("renderer");
    expect(r.scope).toBe(treeScopeOf(hasRenderer));
    expect(Object.keys(SCOPE_CEILINGS)).toContain(r.scope);
  });

  // 加宽之后新增的两格读数。都是**结构性**的：`viaCounts` 三分法之和必须等于总条数（少一条＝
  // 有一条断言我不知道它是哪族写法），而 `unresolvedMatcher` 必须是 0（括号回走走不通＝本面看不见
  // 那条断言，与「没有那条断言」是两个数——不许混）。
  it("取料写法的分布必须把每条断言归到一族，且走不通的格子＝0", () => {
    const sum = r.viaCounts["字段直取"] + r.viaCounts["本地 helper"] + r.viaCounts["字段别名"];
    expect(sum).toBe(r.needles);
    expect(r.unresolvedMatcher).toBe(0);
    // 本轮实录：直取 86／helper 7／别名 1——后两族第 95 页以前整面看不见。
    // 掉回 0 只可能是取料面自己漂了，不会是无辜的分布变化。
    expect(r.viaCounts["本地 helper"] + r.viaCounts["字段别名"]).toBeGreaterThan(0);
  });

  it("未登记的 drift（已提交态）＝ 0；豁免表为空 ⇒ stale 也必须为空（登记烂在这儿要红）", () => {
    expect(r.drift.map((d) => `${d.file}:${d.lostRun}`)).toEqual([]);
    expect(r.stale).toEqual([]);
    // 本轮实录：曾登记过两条（docs-check 的「30000」「no-such」），登记后不到一小时被别人的在飞改动
    // 解掉 ⇒ stale-waiver 机制自己点名、我删登记。这条断言保证"清空"不是我把表抹了。
    expect(Object.keys(KNOWN_NON_DRIFT)).toEqual([]);
    // 在飞那一半不算我的账，但必须**分得清**：两半之和＝全部 drift 条数（漏一半＝排除面悄悄关小）
    expect(r.drift.length + r.inFlightDrift.length).toBe(r.counts.drift);
    expect(r.counts["echo-caller-text"]).toBe(r.echo.length);
  });

  it("真仓读数必须在帽内——判卷直接吃 CLI 那个函数，不许自己再算一遍", () => {
    expect(ceilingBreaches(r)).toEqual({ multi: "", bare: "" });
    // 两半之和＝名单总数：分面漏一半（只数已提交／只数在飞）会在这儿红，且与树脏净无关。
    expect(r.committedMultiCopy + r.inFlightMultiCopy).toBe(r.multiCopy.length);
  });

  // 计数要点得出名：一格说"3 处"就得交出是哪三处，否则这张表还是得人回仓里猜（第 101 页）。
  // 名字之外还要交出**那一处的句子**：第 101 页我只看 `path#fn`，把"共享一个词的两句话"（`compaction`「膨胀」）
  // 记成了"读数脚本抄了产品文案"——只有句子能分开这两种账（修法相反：换针脚 vs 改代码）。
  it("顶包名单每一格都点得出名与句子，且两族今天都真有货", () => {
    for (const v of r.multiCopy) {
      expect(v.copySites.length).toBe(v.copies);
      expect(v.copies).toBeGreaterThan(1);
      for (const s of v.copySites) {
        expect(s.site).toContain("#");
        expect(s.text.length).toBeGreaterThan(0);
      }
    }
    const crossFile = r.multiCopy.filter(
      (v) => new Set(v.copySites.map((s) => s.site.slice(0, s.site.lastIndexOf("#")))).size > 1,
    );
    expect(crossFile.length).toBeGreaterThan(0);
    // 两族今天都真有货，而且分族是**字段**（不是读报告的人自己判断）：
    // 同一句抄 ≥2 处 ⇒ 修代码；各句只是共享一个词 ⇒ 换针脚。第 101 页我把两族混成一族记过账。
    expect(r.multiCopy.some((v) => sharesOneSentence(v.copySites))).toBe(true);
    expect(r.multiCopy.some((v) => !sharesOneSentence(v.copySites))).toBe(true);
    expect(r.maskedSameSentence + r.maskedSharedWord).toBe(r.multiCopy.length);
    expect(r.maskedSameSentence).toBeGreaterThan(0);
    expect(r.maskedSharedWord).toBeGreaterThan(0);
    // 第三族（裸名字）：①它是顶包名单的**子集**，不许另开一条清单外的路；②两半不许重叠（红的那半 vs 在飞那半）；
    // ③两半之和＝按谓词挑出的全部（分面漏一半会在这儿红，且这一条**与树的脏净无关**）；
    // ④帽按 scope 取，且**两半都算账**（第 118 页改的就是这一处口径）：core-only 那行登记落库后重测的 2、
    //   含桌面层 3——多出的那 1 格住在将被删的桌面测试里。"谓词不空转"的活证是两半之和 > 0（与树脏净无关）。
    expect(r.bareName.every((v) => r.multiCopy.includes(v))).toBe(true);
    expect(r.inFlightBareName.every((v) => r.multiCopy.includes(v))).toBe(true);
    expect(r.bareName.filter((v) => r.inFlightBareName.includes(v))).toEqual([]);
    expect(r.bareName.length + r.inFlightBareName.length).toBe(
      r.multiCopy.filter((v) => isBareNameNeedle(v.needle)).length,
    );
    // 「谓词不空转」的活证＝两半之和 > 0（帽内与否由上面那条真仓用例判，这里不再自己算一遍）
    expect(r.bareName.length + r.inFlightBareName.length).toBeGreaterThan(0);
  });

  // 「在飞」那一半只给个数＝逃生口（第 93 页给 drift 立的规矩，这页补到顶包候选上）。
  it("在飞那一半点得出名，并且已提交那一半里不许混进在飞文件（两侧配对）", () => {
    expect(r.flyingMultiCopy.length).toBe(r.inFlightMultiCopy);
    expect(r.flyingMultiCopy.every((v) => r.inFlightFiles.includes(v.file))).toBe(true);
    expect(r.multiCopy.filter((v) => !r.inFlightFiles.includes(v.file)).length).toBe(r.committedMultiCopy);
    // 年龄那一格只作读数（第 113 页）：不许把判据挂上去，但两半的**包含关系**必须成立——
    // 过期名单里冒出一个不在在飞清单的名字 ＝ 分诊面自己造假；分母大于总数 ＝ 把盘上不存在也算进了年龄。
    expect(r.inFlightStale.every((f) => r.inFlightFiles.includes(f))).toBe(true);
    expect(r.inFlightAgeChecked).toBeLessThanOrEqual(r.inFlightFiles.length);
    // 「今天有没有人在飞」是盘上的状态，不是这把尺的标准 ⇒ 不许拿它当活证（HEAD-only 认证跑就在干净树上，
    //   那一支这里必须读到 0 且不红）。活证改成**互斥配对**：在飞清单为空 ⇒ 所有 flying* 必须同时归 0，
    //   否则"排除在飞"是在凭空抹格子（第 108 页：原断言 `> 0` 在同 HEAD 隔离树上必红，把别人的没提交当成我的尺坏）。
    if (r.inFlightFiles.length === 0) {
      expect(r.inFlightMultiCopy).toBe(0);
      expect(r.inFlightDrift.length).toBe(0);
      expect(r.inFlightBareName.length).toBe(0);
      expect(r.committedMultiCopy).toBe(r.multiCopy.length);
    } else {
      expect(r.inFlightFiles.some((f) => f.startsWith("tests/") || f.startsWith("src/"))).toBe(true);
    }
  });

  // 影子排除是"把判据关小一格"的动作，所以它自己必须有观测者：
  // ①一张表都没认出 ⇒ 谓词失效（排除面在悄悄改副本数却无人作证）；
  // ②每一格都要能说出差额（`rawCopies > copies`）；而**只要还判 verbatim，就必须留着生产者**（`copies ≥ 1`）。
  //   落到 echo/drift 的格子 copies 归 0 是对的——那两态的意思本来就是"生产侧没有这句"
  //   （本轮 `setsid` 就走这条路：它是测试自己喂进去的命令，被断言的那句是判据插值出来的）。
  it("影子池的排除面自己要有名字：认出几张表、免计了哪几格、verbatim 那几格还留着生产者", () => {
    expect(r.anchorTables.length).toBeGreaterThan(0);
    for (const v of r.shadowCleared) {
      expect(v.rawCopies).toBeGreaterThan(v.copies);
      if (v.kind === "verbatim") expect(v.copies).toBeGreaterThanOrEqual(1);
    }
    // 本轮实录：登记表 `scripts/mutate-verify.mjs`（804 条 `expectFail:`）＋ 用例表
    // `scripts/lib/shell-bypass-cases.ts`（14 条导出样本常量）。两条谓词都要在真仓里有货，
    // 少一族＝那一族的排除悄悄失效了。
    expect(r.anchorTables.some((a) => a.entries > 100)).toBe(true);
    expect(new Set(r.anchorTables.map((a) => a.kind))).toEqual(new Set(["登记表", "用例表"]));
    // 第三格观测者，来自本轮造红（把 `isInputRegistry` 阈值抬到 999＝关掉这条谓词，跑完即删）：
    // 水位**不弹**——用例表免计的那格本来就只剩 1 份副本，关掉谓词后它变成"verbatim 1 处"，
    // 既不进顶包名单也不进 drift ⇒ `SCOPE_CEILINGS[scope].multiCopy` 对它零分辨力，只有"态"会动。
    // ⇒ 排除面若只作用在"掉不进判卷名单"的格子上，就必须钉住那个态本身（本轮＝ echo 那一格）。
    expect(r.shadowCleared.some((v) => v.kind === "echo-caller-text")).toBe(true);
    // 第 98 页那条收窄（点名豁免分字段）今天在真仓里**有没有货**：登记表散文栏挡下的字面量条数。
    // 读成 0 ＝ 它在空转（不代表判据错，但不许把那份绿读成"已在起作用"）。
    expect(r.proseHeldBack).toBeGreaterThan(0);
  });

  it("本面自己的夹具不算断言（不排就是量自己写的字符串），且排除必须列出来", () => {
    expect(r.selfExcluded).toEqual([...SELF_EXCLUDED_TESTS]);
    expect(r.drift.concat(r.multiCopy).some((v) => v.file === "tests/prose-needle-scan.test.ts")).toBe(false);
  });

  it("被跳过的文件只可能是『已跟踪但盘上没有』（他人的在飞删除），且这条读数必须报出来", () => {
    for (const p of r.missingOnDisk) expect(p.startsWith("tests/") || p.startsWith("src/") || p.startsWith("scripts/")).toBe(true);
    // 此刻真实形状：桌面层那笔删除未入库 ⇒ 非空是本面的**已知状态**，不是 bug；空了也不许当成改善来庆祝
    expect(r.missingOnDisk.length).toBeGreaterThanOrEqual(0);
  });
});
