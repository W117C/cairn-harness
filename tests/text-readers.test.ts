// 第 328 页 · 任务 #37：「谁在读这段文本」这把尺本身的判据。
// 立尺的事故是第 327 页补：一支判据从跑器搬进纯模块之后，两条**读跑器源文本**的接线判卷静默失效，
// 而 typecheck／动过的判卷／六台造红／`--check-needles`（阻断 0）四格全都安静——只有全量判卷看得见。
// 本尺要把那一格压成秒级读数，所以判卷的重点不是"能不能印出一张清单"，
// 而是**四态有没有各归各处**：把运行期路径谎报成"看不懂"，或把合成源码字符串里的假调用当成读取者，
// 两种错法都会让清单在某个方向上静默（规则 261：读不到与没有不许同形）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CORPUS_HELPERS, corpusJudgesFor, findReadCallSites, normalizeRel, readerSummary, readersOf, scanJudgeForCorpusReaders, scanJudgeForReaders,
  SOURCE_FACES, corpusSummary, type CorpusScan, type ReaderScan, type ReaderShape,
} from "../scripts/lib/text-readers";

const always = (_rel: string): boolean => true;
const none = (_rel: string): boolean => false;
const scan = (text: string, exists: (rel: string) => boolean = always, judge = "tests/x.test.ts"): ReaderScan =>
  scanJudgeForReaders(judge, text, exists);

describe("findReadCallSites：只数代码里的调用，不数字符串与注释里的字面", () => {
  it("代码里的三种写法都数到，且各归一种动态／字面形状", () => {
    const text = [
      'const a = readFileSync(join(REPO, "scripts/x.ts"), "utf8");',
      'const b = await readFile(abs, "utf8");',
      'const c = readFileSync(fileURLToPath(new URL("../scripts/y.ts", import.meta.url)), "utf8");',
    ].join("\n");
    expect(findReadCallSites(text)).toHaveLength(3);
    const s = scan(text);
    expect(s.literal).toBe(2);
    expect(s.dynamic).toBe(1);
    expect(s.unknown).toBe(0);
  });

  it("★合成源码字符串里的假调用不算（第 328 页现读：全文正则量出 403 处，其中 27 处躺在夹具正文里）", () => {
    // 这一段是被判卷当**夹具内容**使用的源码文本，本仓真实存在这个形状（tests/impact-attribution.test.ts）。
    const fixture = '"src/consumer.ts": \'import { readFile } from "./ledger.js";\\nexport const a = readFile("x");\\n",\n';
    const s = scan(fixture);
    expect(s.readCalls).toBe(0);
    expect(s.hits).toEqual([]);
  });

  it("注释里的那一句也不算读取者（行注释与块注释两种）", () => {
    const text = '// 以前这里写 readFileSync("src/a.ts", "utf8")\n/* 块注释 readFileSync("src/b.ts") */\nconst x = 1;\n';
    expect(scan(text).readCalls).toBe(0);
  });

  it("但模板串插值里的真调用要算——整段跳过会把这一格吞掉", () => {
    const text = 'const t = `读到 ${readFileSync(join(REPO, "src/a.ts"), "utf8")} 为止`;\n';
    const s = scan(text);
    expect(s.readCalls).toBe(1);
    expect(s.literal).toBe(1);
    expect(s.hits[0]?.target).toBe("src/a.ts");
  });
});

describe("四态归位：字面量／运行期路径／形状不认识", () => {
  it("字面量能定出仓内 rel：join(REPO|ROOT, …) 与 new URL(…) 两种写法同一目标", () => {
    const a = scan('readFileSync(join(ROOT, "scripts", "lib", "x.ts"), "utf8");\n');
    expect(a.hits[0]?.target).toBe("scripts/lib/x.ts");
    expect(a.hits[0]?.shape).toBe("literal-join");
    const b = scan('readFileSync(fileURLToPath(new URL("../../scripts/x.ts", import.meta.url)), "utf8");\n', always, "tests/deep/y.test.ts");
    expect(b.hits[0]?.target).toBe("scripts/x.ts");
    expect(b.hits[0]?.shape).toBe("url-relative");
  });

  it("../ 的基准是判卷自己所在目录，不是仓根（逃出纳名目录时rel 为空、不进清单）", () => {
    expect(normalizeRel("../scripts/x.ts")).toBeNull();
    expect(normalizeRel("./src/a.ts")).toBe("src/a.ts");
    const escape = scan('readFileSync(fileURLToPath(new URL("../../outside/x.ts", import.meta.url)), "utf8");\n', always, "tests/a/b.test.ts");
    expect(escape.hits[0]?.target).toBeNull();
  });

  it("运行期路径的每一子形状分开印，且绝不并进「形状不认识」（帽是 0，混一次就永远红）", () => {
    // 逐条各扫一次：混在一段里数总数，就分不清哪一行被归进了哪一档（聚合数会互相顶账）。
    const cases: Array<[string, ReaderShape]> = [
      ['readFileSync(abs, "utf8");', "dynamic-identifier"],
      ['readFileSync(entry!.script, "utf8");', "dynamic-identifier"],
      ['readFileSync(r.overflowFiles[0]!, "utf8");', "dynamic-identifier"],
      ['readFileSync(`${DIR}/x.ts`, "utf8");', "dynamic-template"],
      ['readFileSync(join(dir, "src", "a.ts"), "utf8");', "dynamic-call"],
      ['readFileSync(logOf(), "utf8");', "dynamic-call"],
      ['readFileSync(...paths, "utf8");', "dynamic-array"],
    ];
    for (const [code, want] of cases) {
      const s = scan(code);
      expect(s.unknown, code).toBe(0);
      expect(s.dynamic, code).toBe(1);
      expect(s.hits[0]?.shape, code).toBe(want);
    }
  });

  it("真的切不出第一个参数时才进「形状不认识」，而且三态相加＝分母", () => {
    const s = scan('readFileSync(\n  "未闭合的引号\n');
    expect(s.unknown).toBe(1);
    expect(s.literal + s.dynamic + s.unknown).toBe(s.readCalls);
    // 反向哨兵：同一把尺对一份空文本必须全 0（三态里有哪一态是常数，这条就把它揭穿）
    const empty = scan("");
    expect(empty).toEqual({ judge: "tests/x.test.ts", readCalls: 0, hits: [], literal: 0, dynamic: 0, unknown: 0 });
  });
});

describe("readersOf：清单只收「仓内源码面 + 盘上真有那份文件 + 不是自己」", () => {
  it("仓外面（node_modules／临时盘）、指不到盘上文件的字面量、判卷读自己——三种都不进清单", () => {
    const outside = scan('readFileSync(join(REPO, "node_modules/foo/index.js"), "utf8");\n');
    expect(readersOf(["node_modules/foo/index.js"], [outside]).get("node_modules/foo/index.js")).toEqual([]);
    const missing = scan('readFileSync(join(REPO, "scripts/gone.ts"), "utf8");\n', none);
    const gotMissing = readersOf(["scripts/gone.ts"], [missing]);
    expect(gotMissing.get("scripts/gone.ts")).toEqual([]);
    // 同一份文本但 exists 说"在" ⇒ 必须进清单（上面那条空清单不能是恒真）
    const present = scan('readFileSync(join(REPO, "scripts/gone.ts"), "utf8");\n', always);
    expect(readersOf(["scripts/gone.ts"], [present]).get("scripts/gone.ts")).toHaveLength(1);
    const selfRead = scan('readFileSync(join(REPO, "tests/x.test.ts"), "utf8");\n');
    expect(readersOf(["tests/x.test.ts"], [selfRead]).get("tests/x.test.ts")).toEqual([]);
  });

  it("同一份文件被多份判卷读 ⇒ 逐份列出，不压成一个数", () => {
    const one = scan('readFileSync(join(REPO, "scripts/loop-eval.ts"), "utf8");\n', always, "tests/a.test.ts");
    const two = scan('readFileSync(join(REPO, "scripts/loop-eval.ts"), "utf8");\n', always, "tests/b.test.ts");
    const hits = readersOf(["scripts/loop-eval.ts"], [one, two]).get("scripts/loop-eval.ts") ?? [];
    expect(hits.map((h) => h.judge).sort()).toEqual(["tests/a.test.ts", "tests/b.test.ts"]);
  });
});

describe("汇总行：四态不许并进一句话（读不到与没有要分得开）", () => {
  it("汇总把三态各自印出来，且带那句同句自检", () => {
    const line = readerSummary([scan('readFileSync(join(REPO, "src/a.ts"), "utf8");\nreadFileSync(v, "utf8");\n')]);
    expect(line).toContain("字面量 1");
    expect(line).toContain("运行期路径 1");
    expect(line).toContain("形状不认识 0");
    expect(line).toContain("三态相加＝2");
  });

  it("空语料不许读成「0 处调用所以一切正常」——分母那格要印 0（不藏）", () => {
    expect(readerSummary([])).toContain("读取调用 0 处");
  });
});

describe("真表现读与接线", () => {
  it("★第 327 页那次事故，这把尺当时就该指出来：读 `scripts/loop-eval.ts` 文本的判卷里必须有 eval-heldout 与 eval-validity", () => {
    // 取料＝被度量方自己的产物（lib 的 scan），不在判卷里重算一遍形状。
    const corpus = ["tests/eval-heldout.test.ts", "tests/eval-validity.test.ts", "tests/eval-task-set.test.ts", "tests/eval-assembly.test.ts", "tests/eval-retry.test.ts"];
    const scans = corpus.map((p) => scanJudgeForReaders(p, readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8"), (rel) => {
      try { readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8"); return true; } catch { return false; }
    }));
    const read = readersOf(["scripts/loop-eval.ts"], scans).get("scripts/loop-eval.ts") ?? [];
    const judges = new Set(read.map((h) => h.judge));
    expect(judges.has("tests/eval-heldout.test.ts"), "那两条红就出在这份判卷读 loop-eval 文本").toBe(true);
    expect(judges.has("tests/eval-validity.test.ts")).toBe(true);
  });

  it("★接线 CLI 吃的是代码态扫描器与那张帽，不是全文正则（旧写法不许回来）", () => {
    const cli = readFileSync(fileURLToPath(new URL("../scripts/text-reader-check.ts", import.meta.url)), "utf8");
    expect(cli).toContain("scanJudgeForReaders(f.path, f.text, exists)");
    expect(cli).toContain("if (unknown > UNKNOWN_CAP)");
    expect(cli).not.toMatch(/text\.matchAll\(\/readFileSync/u);
    const lib = readFileSync(fileURLToPath(new URL("../scripts/lib/text-readers.ts", import.meta.url)), "utf8");
    expect(lib).toContain("export function findReadCallSites(text: string): number[] {");
  });
});

/* ── 第二出口（第 329 页 · 任务 #38）：语料级读取者 ─────────────────────────────────
 * 上面那一栏只会点名「字面量里写着某个文件」的判卷；`tests/dead-script-refs.test.ts` 走的是全量遍历，
 * 目标要运行期才知道 ⇒ 那一族在清单里是**整类缺失**（第 328 页补实测：认证判卷当场报 1 红，新尺一句没喊）。
 * 这一组的重点因此不是「能不能列出一份名单」，而是**两栏分开、且每一档都不许谎报**：
 * 把遍历临时盘的判卷列进来＝清单变噪音（没人看），把遍历仓内面的列成"没关系"＝重演 #38 开场那一格。 */
const cscan = (text: string, judge = "tests/x.test.ts"): CorpusScan => scanJudgeForCorpusReaders(judge, text);

describe("第二出口：语料级读取者的三态（列仓内面／列临时盘／要人复认）", () => {
  it("仓内面才算，运行期目录不算，切不出来的那一档要出声（三态不许互相顶账）", () => {
    expect(cscan('const n = readdirSync(join(REPO, "scripts/replay"));\n').corpus).toBe(1);
    expect(cscan('const n = readdirSync(join(REPO, "scripts/replay"));\n').faces).toEqual(["scripts/"]);
    expect(cscan("const n = readdirSync(dir);\n").local).toBe(1);
    expect(cscan("const n = readdirSync(dir);\n").corpus).toBe(0);
    // 参数切成 `1 > 2 ? a : b`：形状真不认识 ⇒ 不许并进「临时盘」（那是把"我不认识"谎报成"没关系"）
    const bad = cscan("const n = readdirSync(1 > 2 ? a : b);\n");
    expect(bad.unknown).toBe(1);
    expect(bad.local).toBe(0);
  });

  it("★参数是裸标识符时要展开同文件的常量定义（现读第一版在这一格静默失效：那条正则没有捕获组）", () => {
    // 两种真机写法各有见证：`tests/env-cue-single-source.test.ts:15`（URL 形）与
    // `tests/replay-readings-registry.test.ts:18`（join＋__dirname 形）。
    const url = cscan('const DIR = fileURLToPath(new URL("../scripts/replay", import.meta.url));\nreaddirSync(DIR);\n');
    expect(url.corpus, "常量把字面量藏在另一行，只按参数行找就会判成临时盘").toBe(1);
    expect(url.faces).toEqual(["scripts/"]);
    const joined = cscan('const DIR = join(__dirname, "..", "scripts", "replay");\nreaddirSync(DIR);\n');
    expect(joined.faces).toEqual(["scripts/"]);
    // 反向哨兵：解得出来但**不是**源面（临时盘）⇒ 归 local，且形状留名 readdir-const 供人复认
    const tmp = cscan('const DIR = join(os.tmpdir(), "dsh-replay");\nreaddirSync(DIR);\n');
    expect(tmp.corpus).toBe(0);
    expect(tmp.local).toBe(1);
    expect(tmp.shapes).toContain("readdir-const");
  });

  it("同文件自己写的遍历助手：调用处点得出面才算；点不出面的同名函数不许污染读数", () => {
    const walker = [
      "function walkSources(dir: string, out: string[] = []): string[] {",
      "  for (const n of readdirSync(dir)) out.push(n);",
      "  return out;",
      "}",
      'walkSources(join(__dirname, "..", "src"));\n',
    ].join("\n");
    const s = cscan(walker);
    expect(s.corpus, "调用处点了 src，这一份就是语料级读取者").toBe(1);
    expect(s.faces).toEqual(["src/"]);
    // 假助手：名字里带 walk、函数体里没有列目录动作 ⇒ 一次都不该计
    const fake = cscan('function walkNotes(dir: string): string { return dir; }\nwalkNotes("docs");\n');
    expect(fake.listCalls).toBe(0);
    // 真助手但这一次调用喂的是运行期目录 ⇒ 也不计（现读第一版把这类全列成"要复认"，一张表被 10 处假命中刷红）
    const runtime = cscan('function walkAll(dir: string): string[] { return readdirSync(dir); }\nwalkAll(tmpDir);\n');
    expect(runtime.corpus).toBe(0);
    expect(runtime.unknown).toBe(0);
    expect(runtime.listCalls).toBe(1); // 函数体里那一枚 readdirSync 才是列目录动作
  });

  it("corpus 那一档必须点得出面，且三态相加＝分母；空文本全 0（对全部输入同答的哨兵）", () => {
    for (const text of [
      'readdirSync(join(REPO, "src"));\n', "readdirSync(dir);\n", "readdirSync(1 > 2 ? a : b);\n",
      'collectScriptRefs(root);\n', 'execFileSync("git", ["ls-files"], { cwd: root });\n',
    ]) {
      const s = cscan(text);
      expect(s.corpus + s.local + s.unknown, text).toBe(s.listCalls);
      if (s.corpus > 0) expect(s.faces.length, text).toBeGreaterThan(0);
    }
    expect(cscan("")).toEqual({ judge: "tests/x.test.ts", listCalls: 0, corpus: 0, local: 0, unknown: 0, faces: [], shapes: [] });
  });

  it("登记表自洽：每一枚助手的面都写在 SOURCE_FACES 里（抄第二份清单＝各写各的）", () => {
    expect(CORPUS_HELPERS.length).toBeGreaterThan(0);
    for (const h of CORPUS_HELPERS) {
      expect(h.faces.length, h.name).toBeGreaterThan(0);
      for (const f of h.faces) expect(SOURCE_FACES, `${h.name} 登记了没有的面：${f}`).toContain(f);
    }
  });
});

describe("corpusJudgesFor：按面配，不按「有没有 corpus」配", () => {
  const faceOnly = (judge: string, text: string): CorpusScan => cscan(text, judge);
  const scans = [
    faceOnly("tests/walks-src.test.ts", 'readdirSync(join(REPO, "src"));\n'),
    faceOnly("tests/walks-fixtures.test.ts", 'readdirSync(join(REPO, "fixtures/x"));\n'),
    faceOnly("tests/git-tracked.test.ts", 'execFileSync("git", ["ls-files"], { cwd: root });\n'),
  ];

  it("两向证人·出声：改了 src 下的文件 ⇒ 遍历 src 的那份与列跟踪面的那份都要点名", () => {
    const got = corpusJudgesFor(["src/agent/x.ts"], scans).map((m) => m.judge);
    expect(got).toContain("tests/walks-src.test.ts");
    expect(got).toContain("tests/git-tracked.test.ts");
  });

  it("两向证人·闭嘴：只遍历 fixtures 的那份不许出现在改了 scripts 的清单里（清单变噪音就没人看）", () => {
    const got = corpusJudgesFor(["scripts/y.ts"], scans).map((m) => m.judge);
    expect(got).not.toContain("tests/walks-fixtures.test.ts");
    expect(got).toContain("tests/git-tracked.test.ts"); // 跟踪面没有前缀可配 ⇒ 任何路径都罩得住
  });

  it("改动面为空 ⇒ 一份都不点（不许读成「所有语料级判卷都要跑」）", () => {
    expect(corpusJudgesFor([], scans)).toEqual([]);
  });
});

describe("第二出口的接线与真表现读", () => {
  it("★两栏各印一行：并成一行就分不清是「少了一条」还是「少了一类」", () => {
    const cli = readFileSync(fileURLToPath(new URL("../scripts/text-reader-check.ts", import.meta.url)), "utf8");
    expect(cli).toContain("console.log(`[text-reader-check] 判卷语料 ${String(scans.length)} 份｜${readerSummary(scans)}`)");
    expect(cli).toContain('console.log("  " + corpusSummary(corpusScans));');
    expect(cli).toContain("corpusJudgesFor(files, corpusScans)");
    // 反向哨兵：两栏合印（同一句里同时出现两个汇总）＝这一格白造
    expect(cli).not.toMatch(/readerSummary\(scans\)[\s\S]{0,40}corpusSummary\(corpusScans\)/u);
  });

  it("★第二出口那一栏的帽要接进退出码（算出来不看＝恒绿）", () => {
    const cli = readFileSync(fileURLToPath(new URL("../scripts/text-reader-check.ts", import.meta.url)), "utf8");
    expect(cli).toContain("corpusUnknown > CORPUS_UNKNOWN_CAP");
    expect(cli).toContain("} else if (corpusBad) {");
    expect(cli).toContain("process.exitCode = 1;");
    // 帽本身不许有余量：现读 0，留 1 就等于放一枚新写法进来
    expect(cli).toContain("export const CORPUS_UNKNOWN_CAP = 0;");
  });

  it("真表现读：改了 src 与 scripts 各一个文件，第 328 页补那次报错的 dead-script-refs 必须被点名", () => {
    const corpus = ["tests/dead-script-refs.test.ts", "tests/plan-required.test.ts", "tests/eval-heldout.test.ts", "tests/env-cue-single-source.test.ts"];
    const cs = corpus.map((p) => cscan(readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8"), p));
    const got = corpusJudgesFor(["src/agent/x.ts", "scripts/lib/text-readers.ts"], cs).map((m) => m.judge);
    expect(got, "这一族从前在清单里整类缺失").toContain("tests/dead-script-refs.test.ts");
    expect(got).toContain("tests/env-cue-single-source.test.ts");
    expect(got).toContain("tests/plan-required.test.ts");
    expect(got, "它只遍历 fixtures/，改了 src＋scripts 不该点名它").not.toContain("tests/eval-heldout.test.ts");
  });

  it("第一栏顺手补上的那一格：`join(__dirname, ..)` 也是字面量读取者（从前读成运行期路径）", () => {
    const cli = readFileSync(fileURLToPath(new URL("../scripts/text-reader-check.ts", import.meta.url)), "utf8");
    expect(cli).toContain("flag(\"readers-of\")");
    const s = scanJudgeForReaders("tests/gate-failure-log.test.ts",
      'readFileSync(join(__dirname, "..", "scripts", "gates.ts"), "utf8");\n', always);
    expect(s.hits[0]?.target).toBe("scripts/gates.ts");
    expect(s.hits[0]?.shape).toBe("literal-join");
  });
});
