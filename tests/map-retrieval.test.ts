// 能力 1（任务 #17）：**词面检索**——拿文件自己写好的头注释当语料，把自然语言问句接进符号地图。
//
// 立案动因（10-02 现读，`outputs/map-import-edges-2026-10-02/miss-ranking.log`）：接上 import 精确边之后，
// locate-recall 的 13 个真值文件里 9 个的名次仍落在 1013–1949，而 4096 档只渲染约 123 个节点所属的文件
// ⇒ 对这批题**排名这条路已封顶**。把那 9 个文件的头注释第一行与问句并排看，9/9 词面重叠
// ——缺的从来不是语义模型，是「仓库自己已经写下来的说明」一直没进任何语料。
//
// 判卷形状（本仓规矩）：
// · 语义判据喂**合成输入**（真仓数据分辨不了「命中」与「恰好都在图里」）；
// · 每条「A＝B」都配它的反面，且对「对全部输入同答」那一格单独验；
// · 帽那一格先证明这张图**真的被预算卡住**，否则 `≤ 帽` 是空判（规则 248 同族）；
// · 接线（语料来自图谱那份 inputs、扣减接进 renderMapBudget、前缀拼进正文、指纹含问句、
//   会话把整句问话交出来）既有结构针，也有行为证人——两者红的不是同一件事。
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  QUERY_MAX_CODEPOINTS, RETRIEVAL_LINE_HEAD, RETRIEVAL_MAX_FILES, STOPWORD_DF_RATIO, SUMMARY_MAX_CODEPOINTS,
  boundQuery, commentSummary, isRetrievalLine, renderRetrievalLine, retrieveByQuery, tokensOf, type RetrievalEntry,
} from "../src/agent/map/retrieve.js";
import { budgetAfterRetrievalLine, buildMap, createMapBuilder, mapFingerprint } from "../src/agent/map/build.js";
import { clampBudget, mapTokensOf, renderMapBudget } from "../src/agent/map/render.js";
import { buildGraph, personalizedPageRank, type FileTagsInput } from "../src/agent/map/rank.js";
import { TAGS_EXTRACT_VERSION, __resetLangCache, __resetQueryCache } from "../src/agent/map/parse.js";
import { createGlmSessionProvider } from "../src/agent/session-provider";
import { createEventLog, type EventLog } from "../src/events";

const TMP: string[] = [];
const buildSrc = readFileSync(fileURLToPath(new URL("../src/agent/map/build.ts", import.meta.url)), "utf8");
const sessionSrc = readFileSync(fileURLToPath(new URL("../src/agent/session-provider.ts", import.meta.url)), "utf8");

/** 合成语料：`n` 个 `src/f###.ts`，其中 `hot` 名单里的带 `hotTerm`，其余只带到处都有的「模型」。 */
function corpus(n: number, hot: string[], hotTerm = "用量归因"): RetrievalEntry[] {
  const out: RetrievalEntry[] = [];
  for (let i = 0; i < n; i++) {
    const file = `src/f${String(i).padStart(3, "0")}.ts`;
    out.push({ file, summary: hot.includes(file) ? `${hotTerm} 模型` : "模型 模型" });
  }
  return out;
}

describe("commentSummary（只吃顶部，且块注释要吃完）", () => {
  it("顶部连续 // 行合成一行；与代码之间的空行结束；**中段注释不吃**", () => {
    expect(commentSummary("// 甲\n// 乙\n\nexport const x = 1;\n// 丙\n")).toBe("甲 乙");
  });

  it("shebang 与前置空行跳过；第一个非注释行即停（行尾注释不算顶注释）", () => {
    expect(commentSummary("#!/usr/bin/env node\n\n// 头\nconst a = 1; // 尾\n")).toBe("头");
  });

  it("跨行的 JSDoc 块**整段吃完**——只读首行的话，这类文件的摘要恒空，与「没写注释」同形", () => {
    const src = "/**\n * 用量归因：一笔 usage 事件属于哪个模型\n * 补在 bucketsSpendUsd 那一层\n */\nexport const y = 2;\n";
    const s = commentSummary(src);
    expect(s).toContain("用量归因");
    expect(s).toContain("哪个模型");
    expect(s).not.toContain("*"); // JSDoc 每行顶着的星号不许漏进语料
  });

  it("块注释只吃**顶部那一段**；单行 /* … */ 同样吃完后立刻停", () => {
    expect(commentSummary("/* 甲 */\nconst a = 1;\n/* 乙 */\n")).toBe("甲");
    expect(commentSummary("/** 单行块 */\nconst a = 1;\n")).toBe("单行块");
  });

  it("没有顶注释 ⇒ 空串，而不是抛或返回代码行", () => {
    expect(commentSummary("export const a = 1;\n// 甲\n")).toBe("");
    expect(commentSummary("")).toBe("");
  });

  it("按**码点**截断：超长的代理对不许切半个字符出去", () => {
    const astral = "🐦".repeat(SUMMARY_MAX_CODEPOINTS + 50); // 每个占 2 个 UTF-16 单元
    const s = commentSummary(`// ${astral}\n`);
    expect([...s].length).toBe(SUMMARY_MAX_CODEPOINTS);
    expect(s.length).toBeGreaterThan(SUMMARY_MAX_CODEPOINTS); // 证实它真不是按 .length 截的
    expect(/[\uD800-\uDBFF]$/.test(s), "结尾不许是前半个代理对").toBe(false);
  });
});

describe("tokensOf（词面切分：CJK 二元组＋拉丁词）", () => {
  it("CJK 连续串出二元组；**长度 1 的串不收**（单字噪声大）", () => {
    expect(tokensOf("用")).toEqual([]);
    expect(tokensOf("用量")).toEqual(["用量"]);
    expect(new Set(tokensOf("用量归因"))).toEqual(new Set(["用量", "量归", "归因"]));
  });

  it("拉丁/数字词要 ≥3 字符并转小写；两字符的不收", () => {
    const t = new Set(tokensOf("ab abc A_b9 x1"));
    expect(t.has("abc")).toBe(true);
    expect(t.has("a_b9")).toBe(true);
    expect(t.has("ab")).toBe(false);
    expect(t.has("x1")).toBe(false);
  });

  it("路径里的词也收 ⇒ 问句写 `sandbox.ts` 时能对上文件名", () => {
    expect(new Set(tokensOf("map/sandbox.ts")).has("sandbox")).toBe(true);
  });

  it("CJK 扩展区/兼容表意文字算连续串（区间端点被复制磨掉时这条会红）", () => {
    expect(new Set(tokensOf("豈帝甲"))).toEqual(new Set(["豈帝", "帝甲"]));
  });

  it("同一个串切两次给的集合相同（切词不许依赖输入次序）", () => {
    const q = "那笔用量到底属于哪个模型，在哪一层补上模型名";
    expect([...tokensOf(q)].sort()).toEqual([...tokensOf(q)].sort());
  });
});

describe("retrieveByQuery（idf＋停用词＋确定性次序）", () => {
  it("稀有词给分、**到处都有的词不给分**（df 过帽即停用）", () => {
    const c = corpus(20, ["src/f007.ts"]); // 「模型」20 个文件全有 ⇒ 停用；「归因」只 1 个有
    const hits = retrieveByQuery("用量归因 模型", c);
    expect(hits.map((h) => h.file)).toEqual(["src/f007.ts"]);
    expect(hits[0]?.matched).toContain("归因");
    expect(hits[0]?.matched, "被停用的词不许出现在命中词里").not.toContain("模型");
  });

  it("df 门槛就是 max(3, floor(N×ratio))：df=4 在 N=10 时被滤，df=3 时留着", () => {
    const n = 10;
    const stopAt = Math.max(3, Math.floor(n * STOPWORD_DF_RATIO));
    expect(stopAt).toBe(3);
    const four = ["src/f001.ts", "src/f002.ts", "src/f003.ts", "src/f004.ts"];
    const three = ["src/f001.ts", "src/f002.ts", "src/f003.ts"];
    expect(retrieveByQuery("特例", corpus(n, four, "特例")), "df 4 > 3 ⇒ 这词当停用词，一个都不该命中").toEqual([]);
    expect(retrieveByQuery("特例", corpus(n, three, "特例")).length, "df 3 未过帽 ⇒ 三个都该命中").toBe(3);
  });

  it("同分按 rel 升序 ⇒ 打乱语料次序，读数一字不动（不把次序交给遍历顺序）", () => {
    const c = corpus(6, ["src/f002.ts", "src/f005.ts"]);
    const a = retrieveByQuery("用量归因", c);
    const b = retrieveByQuery("用量归因", [...c].reverse());
    expect(a.map((h) => h.file)).toEqual(["src/f002.ts", "src/f005.ts"]);
    expect(b.map((h) => h.file)).toEqual(a.map((h) => h.file));
  });

  it("命中数帽在 RETRIEVAL_MAX_FILES：再多也只列那么多", () => {
    const many = Array.from({ length: RETRIEVAL_MAX_FILES + 4 }, (_, i) => `src/f${String(i).padStart(3, "0")}.ts`);
    // N=100 时停用词门槛是 15 ⇒ 10 个文件共享的词仍算稀有词，命中数由 k 而不是 df 决定
    const hits = retrieveByQuery("用量归因", corpus(100, many));
    expect(hits.length, "10 个候选该被 k 截成 6").toBe(RETRIEVAL_MAX_FILES);
  });

  it("空问句 / 空语料 / k≤0 三态都是空数组，且**不许是恒空**（同输入下有效问句必须命中）", () => {
    const c = corpus(8, ["src/f003.ts"]);
    expect(retrieveByQuery("", c)).toEqual([]);
    expect(retrieveByQuery("用量归因", [])).toEqual([]);
    expect(retrieveByQuery("用量归因", c, { k: 0 })).toEqual([]);
    expect(retrieveByQuery("用量归因", c).length, "同一份语料的有效问句必须给东西").toBe(1);
  });

  it("问句按码点封顶（QUERY_MAX_CODEPOINTS）：帽外那半句不参与命中，帽内也不受影响", () => {
    const c = corpus(10, ["src/f009.ts"]);
    const filler = "啊".repeat(QUERY_MAX_CODEPOINTS); // 恰好占满帽
    expect([...boundQuery(filler + "归因")].length).toBe(QUERY_MAX_CODEPOINTS);
    expect(retrieveByQuery(filler + "归因", c), "稀有词被截在帽外 ⇒ 不该命中").toEqual([]);
    expect(retrieveByQuery("归因" + filler, c).length, "同一个词在帽内时照旧命中（反向对照）").toBe(1);
  });
});

describe("renderRetrievalLine（口径写死在句子里）", () => {
  it("没命中 ⇒ 空串，不印「命中 0 个」这种噪声", () => {
    expect(renderRetrievalLine([])).toBe("");
    expect(isRetrievalLine(""), "空行不算检索行").toBe(false);
  });

  it("行首标记与 `isRetrievalLine` 同源（取料面与生成面共用一支，改措辞时尺不会静默失灵）", () => {
    const line = renderRetrievalLine([{ file: "src/a.ts", score: 1, matched: ["归因"] }]);
    expect(line.startsWith(RETRIEVAL_LINE_HEAD)).toBe(true);
    expect(isRetrievalLine(line)).toBe(true);
    expect(isRetrievalLine("[map] 仓库地图本次不可用"), "降级那句也以 `[map]` 开头 ⇒ 只认整句行首，不许误判").toBe(false);
  });

  it("句子自带「词面命中、不是重要性排名、也不是调用关系」，且每个路径逐字出现", () => {
    const line = renderRetrievalLine(retrieveByQuery("用量归因", corpus(9, ["src/f001.ts", "src/f004.ts"])));
    expect(line).toContain("src/f001.ts");
    expect(line).toContain("src/f004.ts");
    expect(line).toContain("词面");
    expect(line).toContain("不是重要性排名");
    expect(line.split("\n").length, "整条就是一行").toBe(1);
  });

  it("列出的文件数不超过 RETRIEVAL_MAX_FILES", () => {
    const line = renderRetrievalLine(Array.from({ length: 12 }, (_, i) => ({ file: `src/x${String(i)}.ts`, score: 1, matched: ["x"] })));
    for (let i = 0; i < 12; i++) {
      const present = line.includes(`src/x${String(i)}.ts`);
      if (i < RETRIEVAL_MAX_FILES) expect(present, `前 ${String(i)} 个该列出来`).toBe(true);
      else expect(present, `第 ${String(i)} 个不该被列出来`).toBe(false);
    }
    expect((line.match(/、/g) ?? []).length, "分隔符只出现在那串路径之间").toBe(RETRIEVAL_MAX_FILES - 1);
  });
});

describe("预算扣减（检索行不许把总注入量顶过帽）", () => {
  it("空前缀 ⇒ 余额不变；不同长度的前缀 ⇒ 不同余额（防「A＝B」型恒真）；负数被夹到 0", () => {
    expect(budgetAfterRetrievalLine(1024, "")).toBe(1024);
    expect(budgetAfterRetrievalLine(1024, "啊".repeat(40))).toBeLessThan(1024);
    expect(budgetAfterRetrievalLine(1024, "啊".repeat(80))).toBeLessThan(budgetAfterRetrievalLine(1024, "啊".repeat(40)));
    expect(budgetAfterRetrievalLine(1024, "啊".repeat(8000))).toBe(0);
    expect(mapTokensOf("")).toBe(0); // 空前缀的估算是 0，不是 1
  });

  it("扣了以后总注入量在帽内——**前提**是这张图真的被预算卡住，且「不扣」那一支会超帽（分辨力预检）", () => {
    const budget = clampBudget(1024);
    const files: FileTagsInput[] = [];
    for (let i = 0; i < 40; i++) {
      const file = `src/mod${String(i).padStart(2, "0")}.ts`;
      files.push({
        file,
        tags: Array.from({ length: 8 }, (_, j) => ({ name: `handler_of_module_${String(i)}_${String(j)}`, kind: "def" as const, line: j + 1 })),
        summary: "词面检索的合成前缀 用量归因",
      });
    }
    const g = buildGraph(files);
    const ranks = personalizedPageRank(g);
    // 前缀直接由 `renderRetrievalLine` 造（不走 retrieveByQuery）：这一格要验的是**帽的算术**，
    // 让 df/停用词参与进来只会让「前缀有多长」变成第二个未知数。
    const retrievalLine = renderRetrievalLine(
      Array.from({ length: RETRIEVAL_MAX_FILES }, (_, i) => ({
        file: `src/agent/map/module-${String(i)}-with-a-deliberately-long-relative-path.ts`,
        score: 9 - i,
        matched: ["归因"],
      })),
    );
    const prefix = retrievalLine + "\n";
    expect(mapTokensOf(prefix), "前提：前缀不是零长度（否则下面的 ≤ 帽是空判）").toBeGreaterThanOrEqual(8);

    const allowance = budgetAfterRetrievalLine(budget, prefix);
    const deducted = renderMapBudget(g, ranks, allowance);
    const naive = renderMapBudget(g, ranks, budget);
    expect(naive.tokens, "前提：这张图大到二分要用满预算").toBeGreaterThanOrEqual(0.85 * budget);
    expect(deducted.tokens).toBeLessThanOrEqual(allowance);
    expect(mapTokensOf(prefix + deducted.text), "总注入量不许超帽").toBeLessThanOrEqual(budget);
    // 反向：不扣减那一支的总注入量**必须**超帽——否则「把扣减摘掉」这条变异无人看见
    expect(mapTokensOf(prefix + naive.text), "不扣前缀就会超帽（这条断言的存在＝扣减有观察者）").toBeGreaterThan(budget);
  });
});

/** 真工作区（词面命中的行为证人不能只靠合成输入：缓存两支与指纹都在盘上）。 */
async function mkWs(): Promise<{ ws: string; dir: string }> {
  const ws = await mkdtemp(join(tmpdir(), "dsh-retrieve-"));
  TMP.push(ws);
  const dir = join(ws, "tags-cache");
  await writeFile(join(ws, "src-usage-attribution.ts"), "// 用量归因：一笔 usage 事件属于哪个模型\nexport function usageAttribution(): number { return 1; }\n", "utf8");
  await writeFile(join(ws, "src-sandbox-runner.ts"), "// 沙箱执行：命令在白名单内怎么被挡住\nexport function sandboxRun(): number { return 2; }\n", "utf8");
  await writeFile(join(ws, "src-bandit-route.ts"), "// 路由档位选择：按成功率的老虎机\nexport function banditPick(): number { return 3; }\n", "utf8");
  return { ws, dir };
}

describe("buildMap 的问句这一维（两支都要给同一张图）", () => {
  afterAll(async () => {
    for (const d of TMP) await rm(d, { recursive: true, force: true }).catch(() => {});
    __resetLangCache();
    __resetQueryCache();
  });

  it("带问句 ⇒ 检索行在正文**最前**且 retrievedFiles>0；不带 ⇒ 正文与 tokens 逐字不变（零回归哨兵）", async () => {
    const { ws, dir } = await mkWs();
    const bare = await buildMap({ workspace: ws, tagsCacheDir: dir, maxInputTokens: 128_000 });
    expect(bare.ok).toBe(true);
    expect(bare.retrievedFiles).toBe(0);
    expect(bare.text).not.toContain("词面");
    const empty = await buildMap({ workspace: ws, tagsCacheDir: dir, maxInputTokens: 128_000, queryText: "" });
    const blank = await buildMap({ workspace: ws, tagsCacheDir: dir, maxInputTokens: 128_000, queryText: "   \n  " });
    expect(empty.text, "空串/纯空白问句必须与「没给问句」同正文").toBe(bare.text);
    expect(blank.text).toBe(bare.text);
    expect(empty.tokens).toBe(bare.tokens);

    const asked = await buildMap({ workspace: ws, tagsCacheDir: dir, maxInputTokens: 128_000, queryText: "那笔用量到底属于哪个模型" });
    expect(asked.retrievedFiles, "命中数要出声，不许由 0 代替「没算」").toBeGreaterThan(0);
    const line0 = asked.text.split("\n")[0];
    expect(line0).toContain("src-usage-attribution.ts");
    expect(asked.text.slice(line0.length + 1), "检索行**前置**，地图正文一个字都不改写").toBe(bare.text);
    expect(asked.text.startsWith(line0 + "\n"), "正文那一半确实接在检索行之后").toBe(true);
    expect(asked.tokens).toBe(mapTokensOf(asked.text));
  });

  it("换一个问句 ⇒ 指纹与正文都跟着变（不进货就变成「问什么都是同一张图」）", async () => {
    const { ws, dir } = await mkWs();
    const builder = createMapBuilder({ workspace: ws, tagsCacheDir: dir, maxInputTokens: 128_000 });
    // 渲染缓存是**每仓一格**（后写覆盖前写）⇒ 问「同一问句会不会复用」必须连着问两次，
    // 中间插进别的问句就把它挤掉了——那样这条判卷恒假，读起来却像「缓存没生效」。
    const a = await builder.build({ workspace: ws, tagsCacheDir: dir, queryText: "那笔用量到底属于哪个模型", nowRound: 1 });
    const a2 = await builder.build({ workspace: ws, tagsCacheDir: dir, queryText: "那笔用量到底属于哪个模型", nowRound: 2 });
    expect(a2.fromRenderCache, "前提：连着同问句第二次该命中渲染缓存").toBe(true);
    expect(a.retrievedFiles, "前提：命中数不是 0（否则下一条是 0＝0 的恒真）").toBeGreaterThan(0);
    expect(a2.retrievedFiles, "缓存那一支漏带命中数，读端就成了 0").toBe(a.retrievedFiles);
    const b = await builder.build({ workspace: ws, tagsCacheDir: dir, queryText: "命令在沙箱里怎么被白名单挡住", nowRound: 3 });
    expect(b.fromRenderCache, "问句换了就不许复用上一张图").toBe(false);
    expect(b.fingerprint).not.toBe(a.fingerprint);
    expect(b.text).not.toBe(a.text);
    expect(a.text).toContain("src-usage-attribution.ts");
    expect(b.text).toContain("src-sandbox-runner.ts");
  });

  it("指纹里问句那一格（纯函数）：只有问句不同 ⇒ 指纹不同；问句同为缺席 ⇒ 指纹相同", () => {
    const files = [{ rel: "a.ts", abs: "/tmp/a.ts", mtimeMs: 1000, size: 10 }];
    const none = mapFingerprint(files, undefined, 1024, undefined, undefined);
    expect(none).toBe(mapFingerprint(files, undefined, 1024, undefined, ""));
    expect(none).not.toBe(mapFingerprint(files, undefined, 1024, undefined, "用量归因"));
  });

  it("缓存条目缺 summary ⇒ 整条按 miss 重解析（只核 tags/imports 的话，热缓存那支「问什么都不命中」）", async () => {
    const { ws, dir } = await mkWs();
    const cold = await buildMap({ workspace: ws, tagsCacheDir: dir, maxInputTokens: 128_000, queryText: "那笔用量到底属于哪个模型" });
    expect(cold.retrievedFiles, "前提：冷建那一次真的有命中").toBeGreaterThan(0);
    const names = await readdir(dir);
    expect(names.length, "前提：缓存目录写了条目").toBeGreaterThan(0);
    for (const name of names) {
      const raw = JSON.parse(await readFile(join(dir, name), "utf8")) as Record<string, unknown>;
      delete raw.summary;
      raw.v = TAGS_EXTRACT_VERSION; // 版本号照抄：不许靠 v 失配蒙过去
      await writeFile(join(dir, name), JSON.stringify(raw), "utf8");
    }
    const after = await buildMap({ workspace: ws, tagsCacheDir: dir, maxInputTokens: 128_000, queryText: "那笔用量到底属于哪个模型" });
    expect(after.fromRenderCache, "前提：这次要真的重算（否则下面读的是上一张图）").toBe(false);
    expect(after.fromTagsCache, "被降级成「没有 summary」的条目必须全算 miss").toBe(0);
    expect(after.retrievedFiles, "重解析之后命中数要回来，不许悄悄变成 0").toBe(cold.retrievedFiles);
  });
});

/** 接线判卷拆成**一条一格**：一条用例里并五枚针脚的话，五个不同的变异全红在同一条上，
 *  造红那一步就分不出「哪一格没人守」（每台必须红在不同用例）。 */
describe("接线（算出来不接＝本仓那一族）", () => {
  it("检索语料取自**图谱那份 inputs**（另建一份摘要表就是第二套取料面）", () => {
    expect(buildSrc).toMatch(/retrieveByQuery\(query,\s*inputs\.map\(/);
    expect(buildSrc).toMatch(/summary: i\.summary \?\? ""/);
  });

  it("渲染那一半吃的是**扣减后的余额**（总注入量不许靠扣减之外的默契）", () => {
    expect(buildSrc).toMatch(/renderMapBudget\(graph, ranks, budgetAfterRetrievalLine\(budget, prefix\)\)/);
  });

  it("注入正文＝**前缀＋排名正文**（检索行不许被算出来就丢掉）", () => {
    expect(buildSrc).toMatch(/const text = prefix \+ rendered\.text;/);
    expect(buildSrc).toMatch(/const prefix = retrievalLine === "" \? "" : retrievalLine \+ "\\n";/);
  });

  it("地图指纹含问句（不进货就复用上一张图）", () => {
    expect(buildSrc).toMatch(/mapFingerprint\(files, merged\.mentionedIdents, budget, merged\.contextFiles, merged\.queryText\)/);
    expect(buildSrc).toMatch(/q: queryText \?\? ""/);
  });

  it("tags 缓存三个出口同进同出（少一个字段就按 miss，不许回半张图）", () => {
    expect(buildSrc).toMatch(/writeTagsCache\(dir, s\.f, sym\.tags, sym\.imports, sym\.summary\)/);
    expect(buildSrc).toMatch(/typeof e\.summary === "string"/);
  });

  it("会话把**整句问话**交给构建器，且与 mentioned 切片共用一个取料点", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dsh-retrieve-wire-"));
    TMP.push(dir);
    const captured: { queryText?: string; mentionedIdents?: string[] }[] = [];
    const log: EventLog = createEventLog(join(dir, "events.jsonl"));
    await log.append({ type: "user_message", content: "那笔用量到底属于哪个模型 usageAttribution" });
    await log.close?.();
    const provider = createGlmSessionProvider(join(dir, "events.jsonl"), {
      workspace: dir, system: "SYSTEM",
      mapBuilder: {
        build: async (opts) => {
          captured.push({ queryText: opts.queryText, mentionedIdents: opts.mentionedIdents });
          return {
            text: "MAP-BODY", tokens: 4, ok: true, fromTagsCache: 0, parsed: 0, fromRenderCache: false,
            fingerprint: "fp", cap: 400, graphFiles: 1, candidates: 1, retrievedFiles: 1,
          };
        },
      },
      transport: async function* () { yield { type: "assistant_message", content: "ok" }; },
    });
    for await (const _ of provider.stream([])) { /* drain */ }
    expect(captured.length, "前提：地图构建器真的被调用过一次").toBeGreaterThan(0);
    expect(captured[0]?.queryText).toContain("那笔用量到底属于哪个模型");
    expect(captured[0]?.mentionedIdents, "反向对照：切片那一支照旧在（两半共用同一个取料点）").toContain("usageAttribution");
    expect(sessionSrc).toMatch(/lastUserContent\(events\)\.match\(makeMentionedRe\(\)\)/);
  });
});
