/** 「诊断文案 ↔ 断言收料」这把尺的判卷面（第 92 页）。
 *  分两层：纯函数用合成夹具（每条判态各钉一格，含两格反控）；最后一条打**真仓**——
 *  它同时是本面的"不许空载"自检（挑不到料就是尺坏了，不是全绿）。 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  applyWaivers,
  classifyNeedles,
  collectNeedles,
  KNOWN_NON_DRIFT,
  MULTI_COPY_CEILING,
  scanRepo,
  SELF_EXCLUDED_TESTS,
  staticRuns,
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
  const got = collectNeedles("x.test.ts", t);

  it("四个诊断字段各收一条，带行号与解出来的字面量", () => {
    expect(got.map((g) => [g.field, g.line])).toEqual([["reason", 1], ["why", 2], ["detail", 3], ["note", 4]]);
    expect(got[0]!.needle).toBe("不足两次同配置重复");
  });

  it("`.not.toContain`／非诊断字段／变量实参 三支都不收（各钉一格，免得哪天顺手放宽）", () => {
    expect(got.some((g) => g.needle.includes("无人照做"))).toBe(false);
    expect(got.some((g) => g.needle.includes("api_key"))).toBe(false);
    expect(got.some((g) => g.needle.includes("rate_limited"))).toBe(false);
    expect(got.some((g) => g.needle.includes("SHIP"))).toBe(false);
  });

  it("转义态要解成真字符再比（源码里写的是 \\\" 与 \\n）", () => {
    const esc = `expect(x.reason).toContain("读数里带 \\"引号\\" 和 \\n 换行");`;
    const one = collectNeedles("y.test.ts", esc);
    expect(one).toHaveLength(1);
    expect(one[0]!.needle).toContain('"引号"');
    expect(staticRuns(one[0]!.needle).length).toBeGreaterThan(0);
  });
});

describe("classifyNeedles：四态各自点名，一条不许静默归进『没问题』", () => {
  const n = (needle: string, field = "reason"): ProseNeedle => ({ file: "a.test.ts", line: 1, field, needle });

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
});

describe("applyWaivers：豁免要带理由，且不许静默烂在这儿", () => {
  const drift = (file: string, lostRun: string) => ({
    file, line: 1, field: "reason", needle: lostRun, kind: "drift" as const, detail: "", lostRun, copies: 0,
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

  it("挑得到收料断言（0 条＝尺坏了，不是全绿）", () => {
    expect(r.needles).toBeGreaterThan(20);
    expect(r.sourceFiles).toBeGreaterThan(50);
  });

  it("未登记的 drift ＝ 0；豁免表为空 ⇒ stale 也必须为空（登记烂在这儿要红）", () => {
    expect(r.drift.map((d) => `${d.file}:${d.lostRun}`)).toEqual([]);
    expect(r.stale).toEqual([]);
    // 本轮实录：曾登记过两条（docs-check 的「30000」「no-such」），登记后不到一小时被别人的在飞改动
    // 解掉 ⇒ stale-waiver 机制自己点名、我删登记。这条断言保证"清空"不是我把表抹了。
    expect(Object.keys(KNOWN_NON_DRIFT)).toEqual([]);
  });

  it("顶包候选的水位只准降（已提交态；在飞文件不计入 ⇒ 并发推不动我的棘轮）", () => {
    expect(r.committedMultiCopy).toBeLessThanOrEqual(MULTI_COPY_CEILING);
    expect(r.committedMultiCopy + r.inFlightMultiCopy).toBe(r.multiCopy.length);
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
