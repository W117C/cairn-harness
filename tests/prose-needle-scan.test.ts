/** 「诊断文案 ↔ 断言收料」这把尺的判卷面（第 92 页）。
 *  分两层：纯函数用合成夹具（每条判态各钉一格，含两格反控）；最后一条打**真仓**——
 *  它同时是本面的"不许空载"自检（挑不到料就是尺坏了，不是全绿）。 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyWaivers,
  agedInFlight,
  blankComments,
  classifyNeedles,
  collectNeedles,
  copyCount,
  copySites,
  DOC_PROSE_KEYS,
  emittedChunks,
  extractLiterals,
  isAnchorTable,
  ceilingBreaches,
  isBareNameNeedle,
  isFaceRefChunk,
  isInputRegistry,
  KNOWN_NON_DRIFT,
  levelVsCap,
  onlyTestSuppliedIntegers,
  scanRepo,
  SCOPE_CEILINGS,
  SELF_EXCLUDED_TESTS,
  sharesOneSentence,
  shadowFilesOf,
  splitAged,
  splitByInFlight,
  STALE_IN_FLIGHT_MS,
  staticRuns,
  treeScopeOf,
  gitOthersArgs,
  untrackedFaceReading,
  untrackedHeldOutOf,
  type CopySite,
  type ProseNeedle,
  type ScanReport,
} from "../scripts/prose-needle-scan";

const src = (path: string, text: string) => ({ path, text });

/** 两支重钩子共用的预算（第 291 页）。为什么这一格要写在代码里而不是靠缺省：
 *  第 287 页把真仓那趟全扫从 describe 体搬进 `beforeAll`，省下的是**每条锚点 spawn** 的 8.9s，
 *  换来的是一次「文件级、且吃 vitest 缺省 10s 钩子时限」的活——`scanRepo(真仓)` 冷缓存实测 8.9～9.5s，
 *  空闲刚好过、隔壁起一套判卷就炸（`e42b4af` 那趟认证就是这一形状：`Hook timed out in 10000ms.`）。
 *  只给这两支声明，**不调 config 的缺省**：那会把 `tests/` 里全部 210 支钩子一起放宽。
 *
 *  第 472 页补一笔（本页的动因就是这里红过一次）：**这一格预算不动，改的是单价**——
 *  `enclosingFn` 从「每收一条字面量重扫一遍前缀」改成「函数头索引一次＋二分」，真仓整趟
 *  13 631 ms → 1 432 ms（本机实测，见 `outputs/prose-scan-perf-472-2026-10-13/`）。
 *  CI 上它贴着天花板也是真的：`aa6b6c9d` 那趟本文件 27 938 ms／上限 30 000 ms，前一趟当场超时。
 *  ⇒ 谁再看到这支尺变慢，先看单价那三格判卷，别先来动这个数（动它只会把红推后，不会修红）。 */
const HOOK_BUDGET_MS = 30_000;

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

  // 第 277 页：这条计数器从前**只被断言为 0**（`:65`、`:667` 两格都是 0），所以把 `unresolved += 1;`
  // 改成永不累加照样全绿——"看不见"这一格没有正向证人。三个形状各自实测过（探针见本页凭证引用的
  // `outputs/unresolved-face-277-2026-10-01/probe-277.log`）：走得通＝收料且不涨；括号回走撞不到
  // 左括号＝一条不收但必须点名；看得到调用却认不出取料族＝既不收也不点名（把后两格焊在一起，
  // 读数照样是 0，而这正是本面最该说"我看不见"的地方）。
  it("括号回走走不通的那一条要单列进 unresolved（三侧：收到料／走不通／认不出族）", () => {
    const ok = collectNeedles("u1.test.ts", `expect(String(g.reason)).toContain("基准那条料");`);
    expect([ok.needles.length, ok.unresolved]).toEqual([1, 0]);
    const dead = collectNeedles("u2.test.ts", `probeArg).toContain("裸括号那条料");`);
    expect([dead.needles.length, dead.unresolved]).toEqual([0, 1]);
    const unknown = collectNeedles("u3.test.ts", `expect(w).toContain("没有字段那条料");`);
    expect([unknown.needles.length, unknown.unresolved]).toEqual([0, 0]);
  });
});

/* ── 第 472 页：`extractLiterals` 的单价。动因是一次**假红**——
   CI（runner 38367542940 / `c551455b`）上本文件的整仓扫越过了 30s 钩子预算（`Hook timed out in 30000ms`），
   而隔一天那趟绿灯读 27 938 ms／上限 30 000 ms：本来就贴着天花板，负载一动就翻。
   分阶段实测（证人：`outputs/prose-scan-perf-472-2026-10-13/stage-profile.log`）整趟 13 949 ms 的去向：
   `classifyNeedles` 7 109 ＋「散文栏」那格 4 845 ＋ 测试侧收料 1 739 ＋ git 与读盘 210。
   根因不在解析（`lex` 90 ms）：`enclosingFn` **每收一条字面量**都把 `[0, at)` 切一份再 `matchAll(FN_HEAD)`
   一遍——单价 = 条数 × 文件长。`scripts/mutate-verify.mjs`（723 KB／12 103 条）上 5 257 ms，
   而「函数头索引一次＋二分」在同一批 12 103 个位置上是 1 ms，逐位比对**零处不一致**。
   ⇒ 三格判卷：单价回到线性、函数名逐条对得上、以及右边界那条**切片语义**（下面第二条）。 ── */
describe("extractLiterals 的单价：函数头索引一次，不随『条数 × 文件长』二次方", () => {
  /** F 支函数 × P 条字面量。二次方那版：每条字面量都把 `[0, 位置)` 切一份再扫一遍正则。 */
  const synth = (funcs: number, per: number): string => {
    let out = "";
    for (let i = 0; i < funcs; i += 1) {
      out += "export function fn" + String(i) + "(): string {\n";
      for (let j = 0; j < per; j += 1) {
        out += "  const s" + String(i) + "_" + String(j) + ' = "第 ' + String(i) + "-" + String(j) + ' 句生产文案，用来量单价";\n';
      }
      out += '  return "";\n}\n';
    }
    return out;
  };

  it("505 KB／12 000 条：整份抽料的墙钟在预算内（二次方那版 4 635 ms，索引版不到 1 s）", () => {
    const text = synth(600, 20);
    const t0 = performance.now();
    const chunks = extractLiterals("synth.ts", text);
    const ms = performance.now() - t0;
    // 预算按**实测**给（第 241 页那条规矩），两侧各留 ≥2 倍：索引版本机 0.2 s ⇒ 1 s 是 5 倍余量；
    // 二次方那版 4.6 s ⇒ 越过预算 4.6 倍。所以这一格既不假红，也不会在二次方回来时安静地绿。
    expect(ms, "抽料单价回到二次方：" + String(Math.round(ms)) + " ms 越过了 1 s 预算").toBeLessThan(1000);
    // 配对的正确性：条数与前后的函数名都要对（只量时长＝一个不区分"抽到什么"的读数）
    expect([chunks.length, chunks[0]!.fn, chunks[chunks.length - 1]!.fn]).toEqual([12_000, "fn0", "fn599"]);
  });

  it("六种形状逐条对得上确切函数名（空字面量不落格、外层里嵌内层）", () => {
    const file = [
      `const top = "顶层那句";`,
      `export function decl(): string {`,
      `  return "声明里那句";`,
      `}`,
      `export const arrow = () => "箭头那句";`,
      `function outer(): string {`,
      `  const first = "外层先那句";`,
      `  function inner(): string { return "内层那句"; }`,
      `  return first;`,
      `}`,
    ].join("\n");
    expect(extractLiterals("shapes.ts", file).map((c) => [c.fn, c.chunk])).toEqual([
      ["(top)", "顶层那句"],
      ["decl", "声明里那句"],
      ["arrow", "箭头那句"],
      ["outer", "外层先那句"],
      ["inner", "内层那句"],
    ]);
  });

  it("右边界算进切片：const f = (“…”) 那条字面量归 f，不是 (top)", () => {
    // 老实现切的是 `text.slice(0, at)`＝**整条**匹配必须落在 at 之前 ⇒ 边界是「≤ at」而不是「< at」。
    // 而 `const f = (` 这条函数头的匹配**正好**止于字面量起点：严一格它就被丢掉、退回 (top)。
    expect(extractLiterals("boundary.ts", `const f = ("参数位上的那句");`).map((c) => [c.fn, c.chunk]))
      .toEqual([["f", "参数位上的那句"]]);
  });

  it("索引建在涂白后的文本上：只在注释里的函数头不是一段代码，不许顶掉 (top)", () => {
    // 形状要按真机量（第 472 页被变异门当场抓过一次）：**行**注释里的 `function ghost() {` 原文也匹配不上
    // FN_HEAD（模式要 `^`／`\n` 后跟空白，而 `//` 顶在那儿）⇒ 那种夹具对这一格零分辨力。
    // 有分辨力的是**块**注释里另起一行的那条：原文命中 `ghost`、涂白后命中空（探针
    // `outputs/prose-scan-perf-472-2026-10-13/ghost-shape-probe.log` 三种形状并排量过）。
    const ghost = [`const before = "涂白之前那句";`, `/*`, `function ghost() {`, `*/`, `const after = "涂白之后那句";`].join("\n");
    expect(extractLiterals("ghost.ts", ghost).map((c) => [c.fn, c.chunk])).toEqual([
      ["(top)", "涂白之前那句"],
      ["(top)", "涂白之后那句"],
    ]);
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
    // 上面四格都不经过真正的消费者：`extractLiterals` 自己直接 `lex`，所以把 `blankComments`
    // 改成原样返回时它们照样绿（第 276 页写锚点时实测存活）。涂白唯一被读到的地方是
    // `collectNeedles` 的取料面 ⇒ 判据钉在那儿，两侧同夹具：注释里那条被划掉的不算料、
    // 没注释的那条才算——只留后一半的话，谓词写反了也照样绿。
    const both = [
      `expect(String(g.reason)).toContain("涂白前后都该收到的料");`,
      `// expect(String(g.why)).toContain("注释里划掉的那条料");`,
    ].join("\n");
    expect(collectNeedles("z.test.ts", both).needles.map((v) => [v.field, v.needle])).toEqual([
      ["reason", "涂白前后都该收到的料"],
    ]);
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

// 第三族影子（第 318 页）：能力断言的**绑定登记表**整行都是数据——`face` 逐字带着另一把尺产出的那句（它是匹配键），
// `why` 给人读。两者按定义流不到任何受众面前，却恰好是最容易把「唯一的真生产者」垫成「2 处副本＝顶包」的东西：
// 实测登记 6 条绑定，顶包候选从 10 涨到 11，把另一把尺的「只准下调」顶红。
// 这条豁免只能开在**行**上：按文件开会吃掉同一份 probe 里真给模型看的句子（第 96 页那笔账），
// 按 `why:` 这个键名开会吃掉 `src/agent/worker-shell-tools.ts:188`、`scripts/lib/eval-retry.ts:70` 两个真生产者。
describe("配对行豁免：绑定登记表整行是数据，不是文案的生产者", () => {
  const producerPath = "src/agent/prune.ts";
  const bindingPath = "scripts/probe-claims.ts";
  const nd = (sought: string): ProseNeedle => ({
    file: "tests/prune.test.ts", line: 1, field: "detail", via: "字段直取", needle: sought, suppliedInTest: false,
  });
  const rowText = (needle: string): string =>
    "export const BINDINGS = [\n" +
    "  {\n" +
    '    face: "src/agent/prune.ts#knob｜' + needle + '",\n' +
    '    symbol: "knob",\n' +
    '    testFile: "tests/prune.test.ts",\n' +
    '    testCase: "每轮都落盘的那一支",\n' +
    '    why: "那句话只在红的一支拼进 detail：' + needle + '",\n' +
    "  },\n" +
    "];\n" +
    "export function bind() {\n  return 1;\n}\n";
  const pairSources = (needle: string) => [
    src(producerPath, 'function f() {\n  detail = "' + needle + '";\n}'),
    src(bindingPath, rowText(needle)),
  ];

  it("整行都挡：匹配键与给人读的说明一起出去，真生产者那一处还在（copies 与 rawCopies 并排）", () => {
    const needle = "门槛拨到多低都不落盘";
    const [v] = classifyNeedles([nd(needle)], pairSources(needle));
    // raw 是 2 而不是 3：副本按「文件＋函数」数一处（face 与 why 同在这份文件的顶层），
    // 与 `copyCount` 既有口径一致——这里钉的是「挡完只剩真生产者那一处」。
    expect([v!.kind, v!.copies, v!.rawCopies]).toEqual(["verbatim", 1, 2]);
  });

  it("反向 A：face 的值是**对象**（工具规格那一族）⇒ 行不豁免——行里的 description 是真给模型看的", () => {
    const needle = "只跑哪一类";
    const [v] = classifyNeedles([nd(needle)], [
      src("src/tools/diagnose.ts", 'function spec() {\n  return {\n    face: { type: "string", description: "' + needle + '" },\n  };\n}\n'),
      src(producerPath, 'function f() {\n  detail = "' + needle + '";\n}'),
    ]);
    expect([v!.kind, v!.copies, v!.rawCopies]).toEqual(["verbatim", 2, 2]);
  });

  it("反向 B：face 的值是枚举词（没有那段「file#fn｜」形状）⇒ 那是取值，不是配对键，行不豁免", () => {
    const needle = "缺省没装这一档";
    const [v] = classifyNeedles([nd(needle)], [
      src("scripts/lib/knobs.ts", 'export const K = [\n  { face: "off-here", note: "' + needle + '" },\n];\nexport function g() {\n  return 1;\n}\n'),
      src(producerPath, 'function f() {\n  detail = "' + needle + '";\n}'),
    ]);
    expect(v!.copies).toBe(2);
  });

  it("键名不是判据：why 是**会发出去的字段**，不在配对行里的 why 照算生产者（也不许进散文栏名单）", () => {
    const needle = "超出可等待上限";
    const [v] = classifyNeedles([nd(needle)], [
      src("scripts/lib/eval-retry.ts", 'function plan() {\n  return { why: "' + needle + '" };\n}\n'),
      src(producerPath, 'function f() {\n  detail = "' + needle + '";\n}'),
    ]);
    expect(v!.copies).toBe(2);
    // 上面那条若哪天因为有人把 why 顺手加进散文栏而变绿，这一条要当场说出是谁改的口径。
    expect(DOC_PROSE_KEYS).not.toContain("why");
  });

  it("只剩配对行当出处时不许读成 verbatim：那格要么漂、要么由测试自己点名（豁免不制造证人）", () => {
    const needle = "只有登记表里有的一句";
    const [v] = classifyNeedles([nd(needle)], [
      src(producerPath, 'function f() {\n  detail = "别的文案";\n}'),
      src(bindingPath, rowText(needle)),
    ]);
    // 后半句是这条用例的哨兵：先证明那句话**确实**躺在行里（副本按文件＋函数数＝1 处），
    // 否则上面那个 drift 只是"夹具没写进去"的另一种说法（恒真判据，第 4 步拦的就是它）。
    expect(copyCount(extractLiterals(bindingPath, rowText(needle)), needle), "行内出处本身要先成立").toBe(1);
    // drift 那一支带的是 `zero`（raw 不补数）：豁免把池子清空后，不许再拿"影子也在"制造一个 verbatim。
    expect([v!.kind, v!.copies, v!.rawCopies]).toEqual(["drift", 0, 0]);
  });

  it("豁免只到行、不到文件：含配对行的那份文件不许整份进影子池（同文件里的真文案还在面内）", () => {
    const needle = "门槛拨到多低都不落盘";
    // 夹具这一侧：这份文件既不是登记表也不是用例表 ⇒ 影子池认不出它
    expect(shadowFilesOf(pairSources(needle))).toEqual([]);
    // 同一份文件里、行外的那句必须**还在生产者池**——「按文件豁免」一旦开出来，先掉的是这一格
    // （第 96 页那笔账的两种形状之一：另一种是整份 probe 被认成影子文件，见下面真仓那一半）。
    const outside = "行外那句才是真文案";
    const sameFile = [src(bindingPath, rowText(needle) + 'function out() {\n  note = "' + outside + '";\n}\n')];
    const [v] = classifyNeedles([nd(outside)], sameFile);
    expect([v!.kind, v!.copies]).toEqual(["verbatim", 1]);
    // 真仓那一侧：绑定登记表住的那份 probe 也不许被认成影子文件
    const here = resolve(fileURLToPath(import.meta.url), "../..");
    const realBinding = "scripts/probe-promise-recall.ts";
    expect(shadowFilesOf([src(realBinding, readFileSync(join(here, realBinding), "utf8"))])).toEqual([]);
  });

  it("形状谓词两侧：带「file#fn｜」的才算配对键，别的字符串不算", () => {
    expect(isFaceRefChunk({ chunk: "src/a.ts#fn｜那句" })).toBe(true);
    expect(isFaceRefChunk({ chunk: "off-here" })).toBe(false);
    expect(isFaceRefChunk({ chunk: "src/a.ts#fn" })).toBe(false);
  });

  it("真仓现读：登记表那些行确实被认出来（且不是整文件豁免），两个近似物一个都没被误伤", () => {
    const here = resolve(fileURLToPath(import.meta.url), "../..");
    const realBinding = "scripts/probe-promise-recall.ts";
    const chunks = extractLiterals(realBinding, readFileSync(join(here, realBinding), "utf8"));
    const rows = chunks.filter((c) => c.pairRow === true);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect([...new Set(rows.map((c) => c.key))].sort()).toEqual(["face", "symbol", "testCase", "testFile", "why"]);
    // 整文件豁免没开：同一份 probe 里仍有大量行外字面量（真给受众看的句子照旧算生产者）
    expect(chunks.some((c) => c.pairRow !== true)).toBe(true);
    for (const p of ["src/tools/diagnose.ts", "scripts/lib/eval-assembly.ts", "src/agent/prune-batching.ts"]) {
      expect(extractLiterals(p, readFileSync(join(here, p), "utf8")).some((c) => c.pairRow === true), p).toBe(false);
    }
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

describe("untrackedHeldOutOf：取料面的第三态必须有名字（第 119 页）", () => {
  it("面里已有的不许再算成「被挡」；重复去掉；顺序稳定（不然两个数没法比）", () => {
    expect(
      untrackedHeldOutOf(["tests/a.test.ts"], ["tests/z.test.ts", "tests/a.test.ts", "tests/z.test.ts"]),
    ).toEqual(["tests/z.test.ts"]);
  });

  it("两份都空 ⇒ 交空数组；空数组只有配上 `unavailable=false` 才允许说「确实没有」", () => {
    expect(untrackedHeldOutOf([], [])).toEqual([]);
  });

  it("取未跟踪清单的 argv：`--exclude-standard` 必须在，前缀要跟在 `--` 之后", () => {
    // 造红实测：把旗标去掉，今天**没有任何别的用例会红**（那三个前缀下暂无被 ignore 的源码文件）
    // ⇒ 这条针脚是给"哪天 .gitignore 多了规则"准备的，不是给今天准备的。
    expect(gitOthersArgs(["tests"])).toEqual(["ls-files", "-z", "--others", "--exclude-standard", "--", "tests"]);
  });
});

describe("untrackedFaceReading：「没有」与「取不到」是两个意思，混着说＝把 fail-open 写进文案", () => {
  it("三态各有自己的说法，且 unavailable 压过计数（拿 0 冒充「确实没有」就是这一格）", () => {
    expect(untrackedFaceReading(0, false)).toContain("没有");
    expect(untrackedFaceReading(17, false)).toBe("17 支");
    expect(untrackedFaceReading(0, true)).toContain("取不到");
    expect(untrackedFaceReading(17, true)).toContain("取不到");
  });

  it("接线钉：CLI 的第三态那行必须吃这个函数（自己拼字符串＝第二份口径，第 118 页同一坑）", () => {
    const raw = readFileSync(new URL("../scripts/prose-needle-scan.ts", import.meta.url), "utf8");
    const code = raw
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    // 针脚要收**调用形状**：`untrackedFaceReading(` 连定义行一起命中（2 次），那样这条永远不红。
    expect((code.match(/untrackedFaceReading\(r\./g) ?? []).length).toBe(1);
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

// 第 278 页：这段切法从前长在 `scanRepo` 里，而真仓现读 `inFlightAgeChecked` ＝ `inFlightFiles.length`
// （一个"盘上不存在"都没有）⇒ 任何等式／`≤` 断言在此刻都不分辨（规则 340 的第三格）。
// 抽成 `splitAged` 之后，"有一个读不到 mtime"这一态才造得出来，两支锚点才各有自己的证人。
describe("splitAged：年龄分母只算盘上真有的那一半（判卷与 CLI 吃同一个决策）", () => {
  const H = 3_600_000;
  const now = 1_700_000_000_000;
  const mixed = (mt: Map<string, number | null>) =>
    splitAged(["新鲜的那一个", "过期的那一个", "盘上没有的那一个"], (f) => mt.get(f) ?? null, now);
  const full = new Map<string, number | null>([
    ["新鲜的那一个", now - H],
    ["过期的那一个", now - 100 * H],
    ["盘上没有的那一个", null],
  ]);

  it("读不到 mtime 的那一半要单列点名，不许静默丢弃（混合与全读不到两态）", () => {
    // 这一条只钉 `missing` 那一半：把它改成 `continue`（丢弃）就红，而分母那一格不动——
    // 两支锚点各有各的证人，别焊成一条（第 277 页同一族）。
    expect(mixed(full).missing).toEqual(["盘上没有的那一个"]);
    // 全读不到的那一态：三个都要点名，否则"邻居把文件删了"与"清单本来空"同形。
    const gone = splitAged(["a", "b", "c"], () => null, now);
    expect(gone.missing).toEqual(["a", "b", "c"]);
  });

  it("分母只数有 mtime 的那一半，过期也只在这一半里挑（空清单不许冒格）", () => {
    const r = mixed(full);
    expect(r.checked).toBe(2);
    expect(r.stale).toEqual(["过期的那一个"]);
    // 反向一侧：空清单交全空——不许把"没有在飞文件"读成"全都在飞但都很新"。
    const e = splitAged([], () => null, now);
    expect([e.checked, e.stale.length, e.missing.length]).toEqual([0, 0, 0]);
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
  // 现读：这一趟扫真仓要 8.9s（`outputs/anchor-unit-price-attribution-287-2026-10-01/probe-scan-cost.log`）。
  // 写在 describe 体里＝它属于**收集期**（vitest 打印的 `import 98%`），于是 `-t` 只选中合成面那条时也得付一遍；
  // 放进 beforeAll ⇒ 本 suite 一条没被选中就不跑（第 287 页把锚点 spawn 单价从 9.7s 打到合成面的量级）。
  let r: ScanReport;
  beforeAll(() => {
    r = scanRepo(root);
  }, HOOK_BUDGET_MS);
  // 帽不再在这里手抄：真仓那条直接调 `ceilingBreaches(r)`（判卷与 CLI 同一份），
  // 自己 `SCOPE_CEILINGS[r.scope]` 取一次＝把判据抄第二遍，第 108 页那族错误的正身。

  it("挑得到收料断言（0 条＝尺坏了，不是全绿）", () => {
    expect(r.needles).toBeGreaterThan(20);
    expect(r.sourceFiles).toBeGreaterThan(50);
  });

  it("同一对账在真仓上跑一遍，且 `across` 那一格今天到底有没有数——读数当场印出来", () => {
    // 合成树那两条守恒在这里必须**非恒真**地成立：真仓 `needles` 是几百条，某一族归类漏了就会在这里露。
    expect(Object.values(r.viaCounts).reduce((a, n) => a + n, 0)).toBe(r.needles);
    expect(r.counts["across-interpolation"]).toBe(r.across.length);
    // 这一条不是判据、是**自报门面的读数**：等式两侧同为 0 时那一格分不出东西（规则 340），
    // 所以把它印出来，谁改坏了 `across` 的接线会在上一行红，而"今天它本来就有几格"由这一行说话。
    console.log(`  ｜真仓门面自报：across＝${String(r.across.length)}｜viaCounts 三档＝${JSON.stringify(r.viaCounts)}`);
  });

  /* 第 282 页：`testFiles` 这个数印在报告第一行（`扫 N 个 test 文件`），而第 282 页的观测者普查读到的
     是**判卷里零次提及**——收料面的分母此前没有证人。这里不写"非空就行"，写两条等式，
     左边用**另一把原语**（判卷自己调 `git ls-files`，不借尺的 `trackedFiles`）枚举。
     为什么要两条：只把"排除过滤器"焊死，第一条照样成立（两边一起涨），第二条才红；
     只把"扩展名写宽"，第二条可能仍成立而第一条红——两种坏法各掉在不同那条上。 */
  it("取料面的分母与 `git ls-files` 独立枚举对账：收料＋自排除＋盘上缺失＝清单全量，且自排除名单要数得着", () => {
    const listed = execFileSync("git", ["ls-files", "--", "tests"], { cwd: root, encoding: "utf8" })
      .split("\n").filter((l) => l.endsWith(".test.ts"));
    const missingTests = r.missingOnDisk.filter((p) => listed.includes(p)).length;
    expect(r.testFiles + r.selfExcluded.length + missingTests, "三者之和 ≠ 独立枚举 ⇒ 面漂了（少读、多读或静默跳过）").toBe(listed.length);
    expect([...r.selfExcluded].sort(), "自排除点名的名单与那份常量对不上（光看数量不够，要看是哪几支）")
      .toEqual(SELF_EXCLUDED_TESTS.filter((p) => listed.includes(p)).sort());
    // 反向证人：等式在两侧同为 0 时会恒真，所以这里配一条"面非空"的下界（本仓 259 支 test 文件，现读）。
    expect(listed.length, "独立枚举读到 0 支 ⇒ 这条用例自己就是空的").toBeGreaterThan(50);
    expect(r.testFiles).toBeGreaterThan(50);
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

  // 第三态（未跟踪∧盘上有）要与**另一把原语**对账：少报＝静默少算（第 118 页那 1 格的成因），
  // 多报＝把 .gitignore/本地 exclude 的东西算进面外名单。两边都是集合相等，不是"非空就行"。
  it("未跟踪清单与 `git status --porcelain -uall` 互检，且列出的每支都真在盘上", () => {
    expect(r.untrackedListUnavailable).toBe(false); // 命令写坏了 ⇒ 这里红，而不是静默读成「没有」
    const out = execFileSync("git", ["status", "--porcelain", "-uall", "--", "tests", "src", "scripts"], {
      cwd: root,
      encoding: "utf8",
    });
    const viaStatus = [
      ...new Set(
        out
          .split("\n")
          .filter((l) => l.startsWith("?? "))
          .map((l) => l.slice(3).trim())
          .filter(
            (p) =>
              p.endsWith(".test.ts") ||
              ((p.startsWith("src/") || p.startsWith("scripts/")) && /\.(?:ts|mts|mjs)$/.test(p)),
          ),
      ),
    ].sort();
    expect([...r.untrackedHeldOut].sort()).toEqual(viaStatus);
    for (const p of r.untrackedHeldOut) expect(existsSync(resolve(root, p))).toBe(true);
    // 面外名单不许与"已跟踪但盘上没有"那一批重叠——两支是两件事，混了就又回到只有一个数的老路。
    expect(r.untrackedHeldOut.filter((p) => r.missingOnDisk.includes(p))).toEqual([]);
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
    //   含桌面层 3——多出的那 1 格住在将被删的桌面测试里。非空分类路径由下方合成树用例覆盖；真仓可合法为 0。
    expect(r.bareName.every((v) => r.multiCopy.includes(v))).toBe(true);
    expect(r.inFlightBareName.every((v) => r.multiCopy.includes(v))).toBe(true);
    expect(r.bareName.filter((v) => r.inFlightBareName.includes(v))).toEqual([]);
    expect(r.bareName.length + r.inFlightBareName.length).toBe(
      r.multiCopy.filter((v) => isBareNameNeedle(v.needle)).length,
    );
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
    // ⚠️ 第 272 页实测：上面那条纪律只改了**if 那一半**，else 还挂着 `inFlightFiles.some(tests/|src/)`——
    //   它要求「此刻在飞的文件里必须有一个源码或判卷文件」，于是**只剩 outputs 在飞时这把尺必红**
    //   （`pnpm gates` 于 06:23 那一趟就是这么红的：那时工作树只有 `outputs/**` 未提交）。
    //   换成与树脏净无关的**定义式配对**：按在飞清单筛出的多副本数必须等于尺自报的那一半——
    //   隔壁改没改源码都成立，而分面漏一半（`splitByInFlight` 用另一套成员判据）会当场红。
    expect(r.multiCopy.filter((v) => r.inFlightFiles.includes(v.file)).length).toBe(r.inFlightMultiCopy);
    if (r.inFlightFiles.length === 0) {
      expect(r.inFlightMultiCopy).toBe(0);
      expect(r.inFlightDrift.length).toBe(0);
      expect(r.inFlightBareName.length).toBe(0);
      expect(r.committedMultiCopy).toBe(r.multiCopy.length);
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

/* ── 第 286 页（任务 #15）：把三格「只在安全值那一侧被断言」的读数变成**确切期望值**。
    为什么真仓钉不住这三格（规则 340）：
    ① `sourceFiles` 从前只有 `> 50`——把它焊死成任何正数都绿；
    ② `proseHeldBack` 只有 `> 0`——把排除面放宽（连用例表的散文一起数）它只会更大，不会红；
    ③ `inFlightStale` 只有「是 `inFlightFiles` 的子集」——**干净树里在飞那一面是空的**，
       空集合对任何断言都恒真，把这一格改成 `[]` 在这棵树上完全无声（第 278 页给 `splitAged` 配过合成夹具，
       但 `scanRepo` 把 helper 的输出接到字段上那一截仍然没人守）。
    ⇒ 一棵自己造的树能把三面同时变成等式：生产侧恰好 5 支、登记表恰好 60 条 `desc:`、
       在飞恰好 2 支其中只有 3 天前那支算旧。先导证人：
       `outputs/prose-face-observers-286-2026-10-01/probe-synthetic-tree.log`（`三格命中: true`）。 ── */
describe("合成树那一面：sourceFiles／proseHeldBack／inFlightStale 三格各有确切", () => {
  const buildTree = (): string => {
    const root = mkdtempSync(join(tmpdir(), "dsh-prose-face-"));
    const g = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    g("init", "-q");
    g("config", "user.email", "probe@test.local");
    g("config", "user.name", "Probe");
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "tests"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), 'export const sentence = "不在 HEAD 里"; export const first = "grep";\n');
    // 另两档扩展名各一支：摘掉 `.mts` 或 `.mjs` 那一档 ⇒ 等式当场少一支（真仓那条阈值对小漂移不分辨）
    writeFileSync(join(root, "src", "b.mts"), 'export const b = "另一档的一面"; export const second = "grep";\n');
    writeFileSync(join(root, "scripts", "c.mjs"), 'export const c = "第三档的一面";\n');
    // 登记表形状：≥50 条 `expectFail:`（`ANCHOR_TABLE_MIN`），每条配一句只给人读的 `desc:` ⇒ 散文栏恰好 60
    const rows = Array.from({ length: 60 }, (_, i) =>
      `  { id: "probe-${String(i)}", desc: "第 ${String(i)} 条散文：这一栏不流进任何输出", expectFail: "不在 HEAD 里" },`).join("\n");
    writeFileSync(join(root, "scripts", "table.ts"), `export const MUTATIONS = [\n${rows}\n];\n`);
    // 用例表形状：5 张导出的字符串数组、0 个导出函数；里面**也**有一句 `desc:`——
    // 它必须留在散文栏之外（放宽排除面时这一格会从 60 变 61，等式当场红）
    writeFileSync(join(root, "scripts", "cases.ts"),
      "export const A_CASES: readonly string[] = [\"alpha\"];\n"
      + "export const B_CASES: readonly string[] = [\"beta\"];\n"
      + "export const C_CASES: readonly string[] = [\"gamma\"];\n"
      + "export const D_CASES: readonly string[] = [\"delta\"];\n"
      + "export const E_CASES: readonly string[] = [\"epsilon\"];\n"
      + "function proseHolder() { return [{ desc: \"别把这张用例表的散文算进登记表那一半\" }]; }\n"
      + "proseHolder();\n");
    writeFileSync(join(root, "tests", "a.test.ts"),
      'import { expect, it } from "vitest";\nit("点名那句生产文案", () => { expect({ detail: "" }.detail).toContain("grep"); });\n');
    g("add", "src/a.ts", "src/b.mts", "scripts/table.ts", "scripts/cases.ts", "scripts/c.mjs", "tests/a.test.ts");
    g("commit", "-q", "-m", "fixture");
    // 在飞两面：一支把 mtime 拨到 3 天前（跨过 `STALE_IN_FLIGHT_MS`＝24h），一支新鲜
    writeFileSync(join(root, "src", "old.ts"), 'export const oldFace = "老的一面";\n');
    writeFileSync(join(root, "src", "fresh.ts"), 'export const freshFace = "新的一面";\n');
    const three = new Date(Date.now() - 3 * STALE_IN_FLIGHT_MS);
    utimesSync(join(root, "src", "old.ts"), three, three);
    return root;
  };
  let root: string;
  let r: ScanReport;
  beforeAll(() => {
    root = buildTree();
    r = scanRepo(root);
  }, HOOK_BUDGET_MS);
  // `afterAll` 不声明预算：它只做一次 `rmSync` 递归删那棵 7 支文件的合成树（毫秒级），
  // 缺省 10s 对它够用；真要放宽它就得先有读数说它不够——别给没量过的格子配预算（规则 241）。
  afterAll(() => {
    // 本 suite 一条没被 `-t` 选中时 beforeAll 不跑，`root` 还是 undefined ⇒ 没有目录要收
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  });

  it("生产侧只吃已跟踪那一半：恰好 5 支（tests/ 不算、两支未跟踪也不算）", () => {
    expect(r.scope).toBe("core-only");
    expect(r.sourceFiles).toBe(5);
    expect(r.testFiles).toBe(1);
    // 反向一侧：未跟踪的那两支在面里出现＝口径漂了（这条等式同时挡「加宽到工作树」与「把 tests/ 算进生产侧」）
    expect(r.inFlightFiles.slice().sort()).toEqual(["src/fresh.ts", "src/old.ts"]);
    expect(r.untrackedHeldOut).toEqual(["src/fresh.ts", "src/old.ts"]);
  });

  it("真扫描把重复的裸名字收进裸名字候选", () => {
    expect(r.bareName.map((v) => v.needle)).toContain("grep");
  });

  it("散文栏只数登记表那一半：恰好 60 条，用例表里那句 `desc:` 不许进来", () => {
    expect(r.anchorTables.map((t) => `${t.kind}:${t.path}`).sort()).toEqual(["用例表:scripts/cases.ts", "登记表:scripts/table.ts"]);
    expect(r.proseHeldBack).toBe(60);
  });

  it("在飞年龄：3 天前那支进 `inFlightStale`、新鲜那支不进，分母恰好 2", () => {
    expect(r.inFlightStale).toEqual(["src/old.ts"]);
    expect(r.inFlightAgeChecked).toBe(2);
    // 焊死成 `[]` 与焊死成「全部在飞」在这一格里都要红（两侧都不是这个确切集合）
    expect(r.inFlightStale).not.toEqual(r.inFlightFiles);
    expect(r.inFlightStale.length).toBeGreaterThan(0);
  });

  it("两本账必须对得上：`viaCounts` 三档之和＝`needles`，`counts` 的 across 档＝`across` 清单长度", () => {
    // 这两条是**守恒**而不是阈值：合成树这一面里 `needles` 恰好 0，所以「某一档被凭空 ＋1」这种坏法当场出声
    // （阈值断言在这种面上永远绿）。第 286 页的普查（任务 #20）点的就是这两格只在安全值一侧。
    const via = Object.values(r.viaCounts).reduce((a, n) => a + n, 0);
    expect(via, "三档分类不划分整个收料面＝有一族的归类在悄悄漏").toBe(r.needles);
    expect(r.counts["across-interpolation"], "直方图与清单是同一件事的两本账，不许各数一遍").toBe(r.across.length);
  });

  it("空面不许被读成全绿：同一棵树上把在飞清空，stale 与分母必须同时归零", () => {
    // 这一格专挡「把子集断言当成观测者」：干净树里 `inFlightFiles` 就是空的，
    // 所以 `stale ⊆ files` 恒真——改吃一棵**有**在飞的树才谈得上分辨（上面那条等式），
    // 这里再把另一态钉住：没有未跟踪文件时两格一起是 0，不许 stale 有数而分母为 0。
    const empty = mkdtempSync(join(tmpdir(), "dsh-prose-empty-"));
    try {
      const gg = (...args: string[]) => execFileSync("git", args, { cwd: empty, encoding: "utf8" });
      gg("init", "-q");
      gg("config", "user.email", "probe@test.local");
      gg("config", "user.name", "Probe");
      mkdirSync(join(empty, "src"), { recursive: true });
      writeFileSync(join(empty, "src", "only.ts"), 'export const only = "只有一支";\n');
      gg("add", "src/only.ts");
      gg("commit", "-q", "-m", "fixture");
      const e = scanRepo(empty);
      expect(e.inFlightFiles.slice().sort()).toEqual([]);
      expect([e.inFlightStale, e.inFlightAgeChecked]).toEqual([[], 0]);
      expect(e.sourceFiles).toBe(1);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("spawn 单价的形状：真仓那一次扫住在 beforeAll 里，不在 describe 体里（第 287 页）", () => {
  // 判卷读的是**自己这一支文件**的文字，所以两条都用行锚定＋转义写法：搜索式在判卷里只以正则字面量出现，
  // 不会被自己撞上（规则 236/348 那一族：同文件文字判卷一旦写成 toContain 就恒真）。
  const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const LAZY = /^ {2}beforeAll\(\(\) => \{\n {4}r = scanRepo\(root\);\n {2}\}, HOOK_BUDGET_MS\);/gm;
  const EAGER = /^ {2}const r = scanRepo\(root\);$/gm;
  const DECLARED = /^ {2}beforeAll\(\(\) => \{[\s\S]{0,300}?\n {2}\}, HOOK_BUDGET_MS\);/gm;
  const BUDGETLESS = /^ {2}beforeAll\(\(\) => \{\n {4}r = scanRepo\(root\);\n {2}\}\);/gm;

  it("收集期不再扫真仓：那种写法恰好一条", () => {
    expect(self.match(LAZY) ?? []).toHaveLength(1);
  });

  it("负控：回到 describe 体的急切写法必须不存在（否则每条锚点 spawn 都付 8.9s）", () => {
    expect(self.match(EAGER) ?? []).toHaveLength(0);
  });

  it("两支重钩子都声明了预算（第 291 页：钩子吃缺省 10s，而冷扫实测 8.9～9.5s）", () => {
    expect(self.match(DECLARED) ?? []).toHaveLength(2);
  });

  it("负控：第 287 页落下来那种「搬进钩子但没声明时限」的形状必须已经没了", () => {
    expect(self.match(BUDGETLESS) ?? []).toHaveLength(0);
  });
});
