// 影响面**读端**工具（能力 1 的事前一跳）：查询正确性 + 参数白名单 + 越权路径 + 可达性/成本不变量。
// 靶子 = fixtures/impact/mini-repo（冻结判卷面，只读不改；已知调用图见 expect-edges.json）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createImpactQueryTool, graphAbsenceNote, graphCandidatePosition, impactQuerySpec } from "../src/tools/impact-query";
// 覆盖面两把纯函数 09-30 挪进 `src/agent/impact/coverage.ts`：同一张图的四个消费者要说同一句话，
// 判据留在读端工具里就会被别处再抄一遍（第十四族）。
import { capCauseNote, coverageNote } from "../src/agent/impact/coverage";
import { MAX_FILES_CEILING, MAX_FILES_DEFAULT } from "../src/agent/map/cap";
import { TOOLS } from "../src/tools";
import type { ToolContext } from "../src/tools/base";
import { checkPermission, isSideEffectTool } from "../src/permissions";
import { sessionToolSpecs } from "../src/agent/glm-session";
import type { ToolName } from "../src/tools";

const MINI_REPO = fileURLToPath(new URL("../fixtures/impact/mini-repo", import.meta.url));

let cacheDir: string;
const ctx = (): ToolContext => ({ workspace: MINI_REPO, emit: async () => {} });
const tool = () => createImpactQueryTool(cacheDir);

beforeAll(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "impact-query-"));
});
afterAll(async () => {
  await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
});

describe("impact_query：改之前问波及谁", () => {
  it("图里没有它的定义 ⇒ 不许报「波及 N 个文件」，要明说这一问不适用（外部/全局符号）", async () => {
    const ws = await mkdtemp(join(tmpdir(), "impact-query-nodef-"));
    await writeFile(join(ws, "a.js"), "export function f() { return globalHelper(1); }\n", "utf8");
    await writeFile(join(ws, "b.js"), "export function g() { return globalHelper(2); }\n", "utf8");
    const r = await createImpactQueryTool(cacheDir).run({ symbol: "globalHelper" }, { workspace: ws, emit: async () => {} });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("没有任何文件");
    expect(r.output).toContain("图内没有 ≠ 仓库里没有"); // 被帽/忽略规则挡在图外也是一种成因
    expect(r.output).not.toMatch(/波及 \d+ 个文件/);
    // 反面对照（收窄判定面必须补这条）：定义在图内时，同一句照旧给出文件数
    const inGraph = await tool().run({ symbol: "compute" }, ctx());
    expect(inGraph.output).toContain("波及 2 个文件");
    await rm(ws, { recursive: true, force: true });
  });

  it("symbol 模式给出跨文件调用点（含定义文件自身要排除）", async () => {
    const r = await tool().run({ symbol: "compute" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("跨文件调用点 2 处");
    expect(r.output).toContain("app.js");
    expect(r.output).toContain("metrics.ts");
    // 定义在 math.js，调用点里不得再把 math.js 算作波及
    expect(r.output.split("\n").filter((l) => l.startsWith("  ")).join("\n")).not.toContain("math.js");
  });

  it("只在自己文件内被用的符号 ⇒ 明确报「波及半径为 0」，不是空输出", async () => {
    const r = await tool().run({ symbol: "topUp" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("波及半径为 0");
  });

  it("file 模式汇聚该文件全部符号的波及面（只列真被外部引用的符号，不抄局部名）", async () => {
    const r = await tool().run({ file: "math.js" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("被跨文件引用的符号 1 个：compute");
    expect(r.output).toContain("波及 2 个文件");
    // 局部变量（base/boosted）不得混进摘要——多花 token 且不可执行
    expect(r.output).not.toContain("base");
    expect(r.output).not.toContain("boosted");
  });

  it("图里没有的符号：fail-visible 说明原因，不静默返回空", async () => {
    const r = await tool().run({ symbol: "doesNotExist" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("图里没有符号");
  });

  it("「不在图内」要说清是哪一种：后缀不支持 / 路径没有这个文件，是两条不同的下一步", async () => {
    // 旧文案把三种成因挤在一句里（"后缀不支持 / 未扫到 / 路径写错"），模型照着末尾那句去 glob 是白跑一轮
    const ext = await tool().run({ file: "notes.txt" }, ctx());
    expect(ext.ok).toBe(false);
    expect(ext.output).toContain("后缀 .txt 不在符号图支持集内");
    expect(ext.output).toContain("不等于 0");
    const missing = await tool().run({ file: "no-such-file.ts" }, ctx());
    expect(missing.ok).toBe(false);
    expect(missing.output).toContain("该相对路径下没有文件");
    expect(missing.output).toContain("glob");
    // 两条不许同形：同形就等于没分诊
    expect(missing.output).not.toBe(ext.output);
  });

  it("文件在盘上、后缀支持、却在图外（噪声目录/帽/忽略规则）⇒ 明说「波及半径未知」而不是「没有调用点」", async () => {
    // node_modules 是 NOISE_GLOBS 排掉的目录：文件存在、后缀受支持，却永远不进图——
    // 这正是 2026-09-23 实测支配本仓 36 个图外源码文件的那一类缺席（见 outputs/impact-graph-boundary-2026-09-23.md）
    const ws = await mkdtemp(join(tmpdir(), "impact-outside-"));
    try {
      await mkdir(join(ws, "src"), { recursive: true });
      await mkdir(join(ws, "node_modules", "pkg"), { recursive: true });
      await writeFile(join(ws, "src", "real.ts"), "export function real(): number { return 1; }\n", "utf8");
      await writeFile(join(ws, "node_modules", "pkg", "ghost.ts"), "export function ghost(): number { return 2; }\n", "utf8");
      const r = await createImpactQueryTool(cacheDir).run({ file: "node_modules/pkg/ghost.ts" }, { workspace: ws, emit: async () => {} });
      expect(r.ok).toBe(false);
      // 这一支现在说得出**是哪一种**：连候选集都没进 ⇒ 重跑建图也等不到它
      expect(r.output).toContain("却连候选集都没进");
      expect(r.output).toContain("重新建图也不会收它");
      expect(r.output).toContain("波及半径未知");
      expect(r.output).toContain("不等于 0");
      // 反向不许说反话：面板侧钉的是「缺席 ≠ 波及 0」，读端也不能把未知写成 0
      expect(r.output).not.toContain("波及半径为 0");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  // 「在图外」的四种成因（纯函数那半，可精确造位置）：上一版只到"帽 或 忽略规则"的 either/or，
  // 而两种成因的下一步不同（等下次建图 / 直接换 grep），说成 either/or 等于让模型自己猜。
  const CAP = MAX_FILES_DEFAULT;

  it("帽外：报出它在候选集里的位置与本次收录数，并给出两条出路", () => {
    const n = graphAbsenceNote("src/old.ts", CAP, CAP + 11);
    expect(n).toContain("第 " + String(CAP + 12) + " 位");
    expect(n).toContain("本次图只收录 " + String(CAP) + " 个");
    expect(n).toContain("被文件数帽挤掉");
    expect(n).toContain("不等于 0");
    expect(n).not.toContain("重新建图也不会收它"); // 帽外≠永久排除，两句不许同形
  });

  it("没进候选集：说明是忽略规则/噪声目录，并明说重建图也等不到", () => {
    const n = graphAbsenceNote("gen/client.ts", CAP, -1);
    expect(n).toContain("却连候选集都没进");
    expect(n).toContain(".gitignore");
    expect(n).toContain("重新建图也不会收它");
    expect(n).toContain("不等于 0");
    expect(n).not.toContain("本次图只收录"); // 没挤帽就别报帽
  });

  it("帽内却没进图（快照滞后/解析失败）：给出「再问一次」这条出路，而不是帽或忽略", () => {
    const n = graphAbsenceNote("src/just-created.ts", CAP, 3);
    expect(n).toContain("第 4 位");
    expect(n).toContain("再问一次即可让它进图");
    expect(n).not.toContain("被文件数帽挤掉");
    expect(n).not.toContain("却连候选集都没进");
  });

  it("候选集重扫失败 ⇒ 如实说分辨不出，不许假装有结论", () => {
    const n = graphAbsenceNote("src/x.ts", CAP, null);
    expect(n).toContain("候选集重扫失败");
    expect(n).toContain("说不出是哪一种成因");
    expect(n).toContain("不等于 0");
  });

  // 上面那条只判了「拿到 null 之后怎么说」。null 从哪来也必须有人判，否则 catch 里改成
  // 什么都行得通（第一版锚点就钉在 catch 上，结果当场存活——那格没有观测者）。
  // 这里不 mock：把工作区指到一个真不存在的路径，rg 自己失败。
  it("graphCandidatePosition：扫不动交回 null、扫得到交出候选集下标（正反两面各一次）", async () => {
    const bogus = join(tmpdir(), "dsh-no-such-workspace-" + String(Date.now()));
    expect(await graphCandidatePosition(bogus, "math.js"), "工作区不存在 ⇒ 必须交 null，不许退成 -1（那是「永久排除」）").toBeNull();
    const pos = await graphCandidatePosition(MINI_REPO, "math.js");
    expect(pos, "靶子仓库里 math.js 是受支持后缀且在盘上 ⇒ 必在候选集内").toBeGreaterThanOrEqual(0);
  });

  it("三条具名成因互不同形（同形就等于没分诊）", () => {
    const set = new Set([
      graphAbsenceNote("f", CAP, CAP + 1),
      graphAbsenceNote("f", CAP, -1),
      graphAbsenceNote("f", CAP, 0),
    ]);
    expect(set.size).toBe(3);
  });

  it("参数必须恰好一个：两个都给 / 都不给 / 类型不对都显式报错", async () => {
    await expect(tool().run({ symbol: "compute", file: "math.js" }, ctx())).rejects.toThrow("恰好给一个");
    await expect(tool().run({}, ctx())).rejects.toThrow("恰好给一个");
    await expect(tool().run({ symbol: 42 }, ctx())).rejects.toThrow("恰好给一个");
    await expect(tool().run({ symbol: "compute", extra: 1 }, ctx())).resolves.toMatchObject({ ok: true }); // 未知键不炸查询（symbol 仍生效）
  });

  it("file 参数不得越出工作区（与 write_file/edit_file 同一套落点纪律）", async () => {
    await expect(tool().run({ file: "../../../etc/passwd" }, ctx())).rejects.toThrow();
    await expect(tool().run({ file: ".agent/config.json" }, ctx())).rejects.toThrow();
  });

  it("缓存不落进被查询的仓库（只写调用方给的 cacheDir）", async () => {
    await tool().run({ symbol: "compute" }, ctx());
    const listed = await fetchDirListing();
    expect(listed.some((f) => f.includes(".agent") || f.includes("impact"))).toBe(false);
  });
});

describe("可达性与成本不变量（「发货了没人接」的那类缺陷）", () => {
  it("规格与实例一一对应，且名字一致", () => {
    expect(impactQuerySpec.name).toBe("impact_query");
    expect(tool().name).toBe(impactQuerySpec.name);
  });

  it("不进静态工具表：开关关着时一次请求都不为该工具付字节", () => {
    expect(TOOLS["impact_query" as keyof typeof TOOLS]).toBeUndefined();
    expect(sessionToolSpecs({ mode: "default" }).specs.some((s) => s.function.name === "impact_query")).toBe(false);
  });

  it("只读档可用（不是副作用工具 ⇒ 三档全放行，调研 worker 也能问影响面）", () => {
    expect(isSideEffectTool("impact_query" as ToolName)).toBe(false);
    expect(checkPermission("read-only", "impact_query" as ToolName)).toBe("allow");
    expect(checkPermission("default", "impact_query" as ToolName)).toBe("allow");
  });

  it("deps 模式列本文件引用的外部定义（我在调用谁），自身文件内的定义不算", async () => {
    const r = await tool().run({ file: "app.js", deps: true }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("我在调用谁");
    expect(r.output).toContain("引用的外部定义 2 处，分布在 2 个文件");
    expect(r.output).toContain("utils.js");
    expect(r.output).toContain("math.js");
    // 反向方向不得把被查文件自己列成依赖
    expect(r.output.split("\n").filter((l) => l.startsWith("  ")).join("\n")).not.toContain("app.js");
  });

  it("deps 对叶子文件给出「依赖面为 0」的显式结论，而不是空输出", async () => {
    const r = await tool().run({ file: "utils.js", deps: true }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("依赖面为 0");
  });

  it("不带 deps 时 file 模式输出逐字不变（新增方向不得改动既有字节）", async () => {
    const plain = await tool().run({ file: "app.js" }, ctx());
    const explicitFalse = await tool().run({ file: "app.js", deps: false }, ctx());
    expect(explicitFalse.output).toBe(plain.output);
    expect(plain.output).toContain("跨文件调用点");
    expect(plain.output).not.toContain("我在调用谁");
  });

  it("deps 只能配 file：配 symbol 或裸给都显式报错（不静默忽略）", async () => {
    await expect(tool().run({ symbol: "compute", deps: true }, ctx())).rejects.toThrow(/deps 只配合 file/);
    await expect(tool().run({ deps: true }, ctx())).rejects.toThrow(/参数恰好给一个/);
  });

  it("deps 模式下不在图内的文件仍然 fail-visible（与 up 同一套分诊文案）", async () => {
    const r = await tool().run({ file: "ghost.js", deps: true }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("该相对路径下没有文件");
  });

  it("规格体积有上限（工具面是按轮重送的固定成本，膨胀要当场红）", () => {
    const bytes = Buffer.byteLength(JSON.stringify(impactQuerySpec), "utf8");
    expect(bytes, "impact_query 规格 " + String(bytes) + "B").toBeLessThan(600);
  });
});

// 「帽外」那条说明写着「调大 maxFiles 后重问」。2026-09-24 核出来这句**当时根本够不着**：
// 规格里没有这个参数，工具也不读它，而建图侧 `BuildImpactOptions.maxFiles` 早就存在
// ⇒ 引擎能做、说明在教、参数面没接线。模型照做就是白跑一轮（本轮缺陷与第 49 页同一族）。
// 判卷按**三个建图出口各一格**：少一格就是「同族只硬化一支」（本仓第六/十二族反复踩的那条）。
describe("maxFiles：说明里那句出路必须真够得着（三个建图出口 + 反向缺省 + 非法值）", () => {
  // 靶子自造而非用 mini-repo：候选序由 **mtime 新→旧** 决定（scanSourceFilesAll 的排序），
  // 把三个文件的 mtime 钉死后"谁在帽外"就是确定的，不依赖 fixture 的 checkout 时间。
  let ws = "";
  const CAPPED = 1; // 只收最新那一个 ⇒ new.js 在图内，mid.js / old.js 在帽外

  async function mk(): Promise<ToolContext> {
    ws = await mkdtemp(join(tmpdir(), "impact-query-cap-"));
    await writeFile(join(ws, "old.js"), "export function legacyHelper(x) { return x + 1; }\n", "utf8");
    await writeFile(join(ws, "mid.js"), "import { legacyHelper } from \"./old.js\";\nexport function midUse(y) { return legacyHelper(y); }\n", "utf8");
    await writeFile(join(ws, "new.js"), "import { legacyHelper } from \"./old.js\";\nexport function newUse(z) { return legacyHelper(z); }\n", "utf8");
    const stamp = async (name: string, ms: number): Promise<void> => {
      const { utimes } = await import("node:fs/promises");
      await utimes(join(ws, name), new Date(ms), new Date(ms));
    };
    await stamp("old.js", Date.UTC(2020, 0, 1));
    await stamp("mid.js", Date.UTC(2021, 0, 1));
    await stamp("new.js", Date.UTC(2022, 0, 1));
    return { workspace: ws, emit: async () => {} };
  }

  it("file 出口：maxFiles 同时到得了建图与那句说明（报的是**实发**的帽，不是缺省 400）", async () => {
    const c = await mk();
    const r = await createImpactQueryTool(cacheDir).run({ file: "old.js", maxFiles: CAPPED }, c);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("本次图只收录 " + String(CAPPED) + " 个"); // ← 建图与文案都吃到才算接上
    expect(r.output).toContain("被文件数帽挤掉");
    expect(r.output).toContain("调大 maxFiles");
    expect(r.output).not.toContain("本次图只收录 " + String(MAX_FILES_DEFAULT) + " 个");
  });

  it("deps 出口：同一格（反向一跳走的是另一处建图调用，漏接就静默按 400 建图）", async () => {
    const c = await mk();
    const r = await createImpactQueryTool(cacheDir).run({ file: "old.js", deps: true, maxFiles: CAPPED }, c);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("本次图只收录 " + String(CAPPED) + " 个");
  });

  it("symbol 出口：那句「被帽挡在图外」里的 N 也必须是实发的帽（此处原先写死 MAX_FILES_DEFAULT）", async () => {
    const c = await mk();
    // legacyHelper 定义在 old.js（帽外）、被 new.js（帽内）引用 ⇒ 走「图里没有定义」那一支
    const r = await createImpactQueryTool(cacheDir).run({ symbol: "legacyHelper", maxFiles: CAPPED }, c);
    expect(r.ok).toBe(true);
    // 断言的是**不变量**（报实发的帽）而不是整句措辞：第 55 页把这句改成条件真后，
    // 形状从「被 N 帽/忽略规则挡在图外」换成「＝帽 N（非全量）⇒ 可能被这一刀切在图外」。
    expect(r.output).toContain("帽 " + String(CAPPED));
    expect(r.output, "写死缺省值＝调了帽还在报 400，模型照那句去理解图就错").not.toContain(String(MAX_FILES_DEFAULT));
  });

  it("反向缺省：不传 maxFiles 时行为逐字不变（目标在图内，且帽按缺省说）", async () => {
    const c = await mk();
    const r = await createImpactQueryTool(cacheDir).run({ file: "old.js" }, c);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("跨文件调用点");
    expect(r.output).not.toContain("maxFiles");
  });

  it("非法 maxFiles 点名拒绝（0/负/小数/字符串/超上限），不静默回落成缺省", async () => {
    const c = await mk();
    const t = createImpactQueryTool(cacheDir);
    for (const bad of [0, -3, 2.5, "5", 1e9, Number.NaN]) {
      await expect(t.run({ file: "old.js", maxFiles: bad }, c), "给了 " + String(bad) + " 必须报错而不是照旧建图")
        .rejects.toThrow(/maxFiles/u);
    }
  });

  // 参数面对账机（`measure-param-drift.mts`）比的是**规格 ↔ 代码里的 args.读取**，
  //  structural 上看不见"输出文案里点名的那个参数存不存在"——本轮那条缺陷正好躲在这台机器的
  // 面之外（声明与自读两边都是三个键，完全自洽，而文案在教第四个）。所以这里补一道
  // **文案 ↔ 规格** 的握手：说明里写「调大 X」，X 就必须真的在规格上。
  // 09-30 补另一半：缺省帽现在**就是**上限 ⇒ 「调大」在默认调用下是死参数式文案，
  // 握手尺要同时判「能调时给得出出路」与「调不动时不许再教模型去拧」。
  it("文案里点名的参数必须真的在规格上；顶到上限时那句出路要换成拧得动的", () => {
    const declared = new Set(Object.keys(impactQuerySpec.parameters.properties));
    for (const c of [1, 400]) {
      const note = graphAbsenceNote("src/x.ts", c, c + 3); // 帽外那一支
      const named = [...note.matchAll(/调大 ([A-Za-z_][A-Za-z0-9_]*)/gu)].map((m) => m[1]);
      expect(named.length, "帽外这一支必须仍给出「调帽」这条出路").toBeGreaterThan(0);
      for (const key of named) expect(declared.has(key), `文案点名 ${String(key)}，规格里却没有它`).toBe(true);
    }
    const atCeiling = graphAbsenceNote("src/x.ts", MAX_FILES_CEILING, MAX_FILES_CEILING + 3);
    expect(atCeiling, "帽已顶到上限还教模型调大＝第 51 页那族死参数式文案").not.toContain("调大 maxFiles");
    expect(atCeiling).toContain("上限");
    expect(atCeiling).toContain("按目录拆仓");
    // 这一格不是假想路径：缺省＝上限 ⇒ 模型不传 maxFiles 时走的就是上面那一支
    expect(MAX_FILES_DEFAULT, "缺省帽若不再等于上限，上面那句「调不上去」就成了假话").toBe(MAX_FILES_CEILING);
  });

  it("规格里那句 maxFiles 说明也不许承诺一条拧不动的出路（规格每轮重送，比文案更贵）", () => {
    const desc = impactQuerySpec.parameters.properties.maxFiles.description;
    expect(desc).not.toMatch(/调大/u);
    expect(desc).toContain("只能调小");
  });
});

async function fetchDirListing(): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const out: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    for (const e of await readdir(join(MINI_REPO, rel), { withFileTypes: true })) {
      const child = rel === "" ? e.name : rel + "/" + e.name;
      if (e.isDirectory()) await walk(child);
      else out.push(child);
    }
  };
  await walk("");
  return out;
}

describe("覆盖度自述：图被帽截断时，成功答案也要说「这图不全」", () => {
  // 为什么要这一格：impact_query 的**阴性**结论（"无跨文件调用点"、"图里没有这个符号"）today 已经会
  // 说"不等于 0 / 图内没有 ≠ 仓库里没有"，但**阳性**答案完全不自述覆盖面 ⇒ 模型看到"波及 1 个文件"
  // 就以为问全了，而这张图可能只收了仓库的一小截。这与 grep/glob 那条"阴性要说清扫描面"是同一条政策，
  // 缺的是它的前半句：**阳性也要说清自己量了多大一块**。
  let ws = "";
  // a.ts 定义 target、b.ts 调用它，且这两个是**最新**的两个文件；pad 文件 mtime 更旧。
  // ⇒ maxFiles=2 时两张都还在图内（成功路径成立），而收录数正好等于帽 ⇒ 自述必须出现。
  async function mk(): Promise<ToolContext> {
    ws = await mkdtemp(join(tmpdir(), "impact-cov-"));
    const { utimes } = await import("node:fs/promises");
    const put = async (name: string, text: string, year: number): Promise<void> => {
      await writeFile(join(ws, name), text, "utf8");
      const t = new Date(Date.UTC(year, 0, 1));
      await utimes(join(ws, name), t, t);
    };
    await put("pad1.ts", "export const pad1 = 1;\n", 2019);
    await put("pad2.ts", "export const pad2 = 2;\n", 2019);
    await put("a.ts", "export function target(x) { return x + 1; }\n", 2022);
    await put("b.ts", "import { target } from \"./a\";\nexport function use(y) { return target(y); }\n", 2023);
    return { workspace: ws, emit: async () => {} };
  }
  afterAll(async () => { if (ws !== "") await rm(ws, { recursive: true, force: true }); });

  it("symbol 支命中帽 ⇒ 成功输出带覆盖度自述（阳性答案也要说清量了多大一块）", async () => {
    const c = await mk();
    const r = await createImpactQueryTool(cacheDir).run({ symbol: "target", maxFiles: 2 }, c);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("跨文件调用点 1 处");
    expect(r.output, "必须报出「收录几个 / 帽是几」，否则模型无从判断这是全量还是一截").toMatch(/收录 2 个文件.*帽/u);
    expect(r.output).toMatch(/图里没有 ≠ 仓库里没有/u);
    expect(r.output).toContain("maxFiles");
  });

  it("file 支同一格（fileImpact 不把收录数带出来，这支就永远不自述）", async () => {
    const c = await mk();
    const r = await createImpactQueryTool(cacheDir).run({ file: "a.ts", maxFiles: 2 }, c);
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/帽/u);
  });

  it("deps 支同一格（同一句覆盖面由三支各自组装 ⇒ 少守一支就是那支静默不自述）", async () => {
    const c = await mk();
    const r = await createImpactQueryTool(cacheDir).run({ file: "b.ts", deps: true, maxFiles: 2 }, c);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("我在调用谁"); // 前提：这一支真的走的是 deps 方向，不是波及方向
    expect(r.output).toMatch(/帽/u);
  });

  it("反向：没到帽时**一个字都不许多**（缺省路径逐字不变，这条是新文案的零回归哨兵）", async () => {
    const c = await mk();
    const r = await createImpactQueryTool(cacheDir).run({ symbol: "target" }, c);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("跨文件调用点 1 处");
    expect(r.output).not.toMatch(/帽/u);
  });

  // 第 55 页那句自述只说「图非全量」，不说漏了几个 —— 当时给的理由是"挤掉多少个要重扫全量候选，
  // 这一格不值一次 rg"。今天读 build.ts 才发现那句理由在建图这一支不成立：`scanSourceFiles`
  // 本来就是先取全量候选、再 `applyFileCap` 切片 ⇒ 分母是切片前那份数组的长度，**不要第二次 rg**。
  // 所以这一组钉的是「三支都把实数报出来」，各钉一支：覆盖面由三支各自组装，少接一支就是那支
  // 静默回到没有分母的旧句子（同族只硬化一支的第十一/十三族）。
  it("覆盖度自述带分母：图外还有几个候选要说得出数（不是只说「非全量」）", async () => {
    const c = await mk();
    const r = await createImpactQueryTool(cacheDir).run({ symbol: "target", maxFiles: 2 }, c);
    expect(r.ok).toBe(true);
    expect(r.output, "候选 4 个 / 收录 2 个 ⇒ 必须报出「另有 2 个」").toContain("另有 2 个候选文件没进这张图");
    expect(r.output).toContain("收录 2 个文件＝帽 2");
  });

  it("file 支的同一个数要穿过 fileImpact（少接一层 report 就只剩没有分母的旧句子）", async () => {
    const c = await mk();
    const r = await createImpactQueryTool(cacheDir).run({ file: "a.ts", maxFiles: 2 }, c);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("另有 2 个候选文件没进这张图");
  });

  it("deps 支的同一个数也从 graph 带过来（三支同判据，不许一支有一支没有）", async () => {
    const c = await mk();
    const r = await createImpactQueryTool(cacheDir).run({ file: "b.ts", deps: true, maxFiles: 2 }, c);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("我在调用谁");
    expect(r.output).toContain("另有 2 个候选文件没进这张图");
  });

  it("收录数正好等于帽、候选也只有这么多 ⇒ 一个字都不许多（旧判据在这里误报「非全量」）", async () => {
    // `applyFileCap` 只做 slice：files.length == cap **不等于**这一刀切掉了东西。
    // 旧判据 `files >= cap` 在这一格会喊"图非全量"，而图就是全量 ⇒ 模型白重问一次。
    const only2 = await mkdtemp(join(tmpdir(), "impact-exact-cap-"));
    await writeFile(join(only2, "a.ts"), "export function target(x) { return x + 1; }\n", "utf8");
    await writeFile(join(only2, "b.ts"), "import { target } from \"./a\";\nexport function use(y) { return target(y); }\n", "utf8");
    try {
      const r = await createImpactQueryTool(cacheDir).run({ symbol: "target", maxFiles: 2 }, { workspace: only2, emit: async () => {} });
      expect(r.ok).toBe(true);
      expect(r.output).toContain("跨文件调用点 1 处"); // 前提：这一支真的答出来了，不是走了别的分诊
      expect(r.output).not.toMatch(/帽|非全量/u);
    } finally {
      await rm(only2, { recursive: true, force: true });
    }
  });
});

describe("覆盖面两把纯函数的判据：候选数 > 收录数，而不是收录数 < 帽", () => {
  it("coverageNote：部分覆盖时报出实数，收全时闭嘴", () => {
    expect(coverageNote(400, 400, 508)).toContain("另有 108 个候选文件没进这张图");
    expect(coverageNote(400, 400, 400)).toBe(""); // ⑴ 旧判据 `files >= cap` 在这里误报
    // ⑵ 反向：切片之外还有「读/解析失败被跳过」这一支 —— 收录数低于帽并不等于收全了。
    expect(coverageNote(398, 400, 400)).toContain("另有 2 个候选文件没进这张图");
  });

  it("capCauseNote 与它同判据：一处说漏了、另一处不许说没漏", () => {
    expect(capCauseNote(400, 400, 508)).toContain("另有 108 个候选没进这张图");
    expect(capCauseNote(398, 400, 400)).toContain("另有 2 个候选没进这张图");
    const none = capCauseNote(400, 400, 400);
    expect(none).toMatch(/与帽无关/u);
    expect(none).toContain("全仓候选 400 个"); // 阴性一侧也带分母，不说空头的「与帽无关」
    expect(none).not.toContain("maxFiles"); // 没切东西时这一位不是出路（第 51 页死参数式文案）
  });
});

describe("「图里没有」的成因收敛：没到帽时不许把帽列成可能成因", () => {
  // 为什么：两条阴性出口（符号彻底查不到 / 只有引用没有定义）原先**无条件**写着
  // 「定义它的那个文件被 ${maxFiles} 帽挡在图外」。而 applyFileCap 只在候选数 > 帽时才切那一刀
  // ⇒ 小仓库上这是一句**不可能成立**的成因，模型照着去调大 maxFiles 就是白跑一轮
  // （第 51 页「死参数式文案」的同族：文案指向一个在此输入下不存在的开关）。
  // 反向两格同样必要：真到帽时这一类必须留着，否则又回到「把未知说成没有」。
  const dirs: string[] = [];
  async function mkRepo(spec: readonly [string, string, number][]): Promise<ToolContext> {
    const ws = await mkdtemp(join(tmpdir(), "impact-cause-"));
    dirs.push(ws);
    const { utimes } = await import("node:fs/promises");
    for (const [name, text, year] of spec) {
      await writeFile(join(ws, name), text, "utf8");
      const t = new Date(Date.UTC(year, 0, 1));
      await utimes(join(ws, name), t, t);
    }
    return { workspace: ws, emit: async () => {} };
  }
  afterAll(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

  it("符号查不到 + 未到帽 ⇒ 明说「与帽无关」，并把帽从成因里删掉", async () => {
    const c = await mkRepo([
      ["a.ts", "export function target(x) { return x + 1; }\n", 2022],
      ["b.ts", "import { target } from \"./a\";\nexport function use(y) { return target(y); }\n", 2023],
    ]);
    const r = await createImpactQueryTool(cacheDir).run({ symbol: "noSuchSymbol" }, c);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/与帽无关/u);
    expect(r.output).not.toMatch(/被 \d+ 帽|可能被帽|被这一刀/u);
    // 死参数式文案：这一格调大 maxFiles 改变不了任何事 ⇒ 不许把它列成出路（第 51 页同族）
    expect(r.output).not.toContain("maxFiles");
  });

  it("符号查不到 + 到帽 ⇒ 帽这一类留着，并点名实发的帽与排除动作", async () => {
    const c = await mkRepo([
      ["old.ts", "export function farOnly() { return 1; }\n", 2018], // 定义被这一刀切掉，图内也没有它的引用
      ["pad.ts", "export const pad = 1;\n", 2019],
      ["a.ts", "export function target(x) { return x + 1; }\n", 2022],
      ["b.ts", "import { target } from \"./a\";\nexport function use(y) { return target(y); }\n", 2023],
    ]);
    const r = await createImpactQueryTool(cacheDir).run({ symbol: "farOnly", maxFiles: 2 }, c);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/帽 2/u);
    expect(r.output).toContain("maxFiles"); // 到帽时这一位是**真出路**
  });

  it("只有引用没有定义 + 未到帽 ⇒ 那句「被 400 帽挡在图外」换成排除句", async () => {
    const c = await mkRepo([
      ["a.js", "export function f() { return globalHelper(1); }\n", 2022],
      ["b.js", "export function g() { return globalHelper(2); }\n", 2023],
    ]);
    const r = await createImpactQueryTool(cacheDir).run({ symbol: "globalHelper" }, c);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("图内没有 ≠ 仓库里没有"); // 既有那条用例的断言不许被这次改动带走
    expect(r.output).toMatch(/与帽无关/u);
    expect(r.output).not.toMatch(/被 \d+ 帽|可能被帽|被这一刀/u);
    expect(r.output).not.toContain("maxFiles");
  });

  it("只有引用没有定义 + 到帽 ⇒ 保留「可能被帽挡」这一成因并点名实发的帽", async () => {
    const c = await mkRepo([
      ["def.ts", "export function globalHelper(n) { return n; }\n", 2018], // 图外：定义被切掉，引用在图内
      ["pad.ts", "export const pad = 1;\n", 2019],
      ["a.ts", "export function f() { return globalHelper(1); }\n", 2022],
      ["b.ts", "export function g() { return globalHelper(2); }\n", 2023],
    ]);
    const r = await createImpactQueryTool(cacheDir).run({ symbol: "globalHelper", maxFiles: 2 }, c);
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/帽 2/u);
    expect(r.output).toMatch(/非全量/u);
    expect(r.output).toContain("maxFiles");
  });
});

describe("多份同名定义：波及清单必须自述是并集，不能当成「我改的那一份」的答案", () => {
  // 实测（2026-09-25）：`one.ts` 与 `two.ts` 各定义一份互不相干的 `run`，各有 1 个调用方。
  // 我改的是 one.ts 那份，工具今天回答「波及 2 个文件」并把 useTwo.ts 列进来，**一个字都不说**
  // 那是并集 ⇒ 模型会去改另一份定义的调用方（假阳性，与第 55/56 页那条"图外 ⇒ 未知"的
  // 假阴性正好相反的一侧）。符号图只按名字连边（parse 不采 import），所以归属做不到，
  // 能做到的诚实是：说出份数 + 说这是并集 + 给一条真做得到的归属查法。
  const dirs: string[] = [];
  async function mkDefs(spec: readonly [string, string][]): Promise<ToolContext> {
    const ws = await mkdtemp(join(tmpdir(), "impact-multidef-"));
    dirs.push(ws);
    for (const [name, text] of spec) await writeFile(join(ws, name), text, "utf8");
    return { workspace: ws, emit: async () => {} };
  }
  afterAll(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

  const twoDefs = (): Promise<ToolContext> => mkDefs([
    ["one.ts", "export function run() { return 1; }\n"],
    ["useOne.ts", "import { run } from \"./one\";\nexport const a = run();\n"],
    ["two.ts", "export function run() { return 2; }\n"],
    ["useTwo.ts", "import { run } from \"./two\";\nexport const b = run();\n"],
  ]);

  it("两份定义 ⇒ 明说「并集」，并给出可执行的归属查法", async () => {
    const r = await createImpactQueryTool(cacheDir).run({ symbol: "run" }, await twoDefs());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("跨文件调用点 2 处"); // 前提：这一格走的是原来的并集答案，不是空答案
    expect(r.output).toMatch(/2 份定义/u);
    expect(r.output).toMatch(/并集/u);
    expect(r.output, "并集那句必须指向一条真做得到的归属查法（否则就是第 51 页那种死出路）").toMatch(/grep/u);
  });

  it("反向：单一定义时**一个字都不许多**（不许把并集那句挂在所有查询上）", async () => {
    const r = await createImpactQueryTool(cacheDir).run({ symbol: "compute" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("定义在 1 个文件");
    expect(r.output).not.toMatch(/并集|份定义/u);
  });

  it("三份定义 ⇒ 那句里的份数是真数出来的（不是写死的「2」）", async () => {
    const c = await mkDefs([
      ["one.ts", "export function run() { return 1; }\n"],
      ["two.ts", "export function run() { return 2; }\n"],
      ["three.ts", "export function run() { return 3; }\n"],
      ["use.ts", "import { run } from \"./two\";\nexport const x = run();\n"],
    ]);
    const r = await createImpactQueryTool(cacheDir).run({ symbol: "run" }, c);
    expect(r.output).toMatch(/3 份定义/u);
    expect(r.output).not.toMatch(/2 份定义/u);
  });

  it("file 模式同一格：该文件的某个符号在别处也有同名定义 ⇒ 波及清单要说明它混进了别人的调用方", async () => {
    const c = await twoDefs();
    const r = await createImpactQueryTool(cacheDir).run({ file: "one.ts" }, c);
    expect(r.ok).toBe(true);
    // 前提（也是这条缺陷的正面证据）：one.ts 那份 run 被改，答案里却数进了 useTwo.ts —— 并集把
    // 另一份定义的调用方算成"我这次改动波及的人"。
    expect(r.output).toContain("波及 2 个文件");
    expect(r.output).toMatch(/并集/u);
    expect(r.output, "要点名是哪个符号有歧义，否则模型还得自己比对").toContain("同名歧义：run");
  });
});
