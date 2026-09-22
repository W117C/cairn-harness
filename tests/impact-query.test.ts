// 影响面**读端**工具（能力 1 的事前一跳）：查询正确性 + 参数白名单 + 越权路径 + 可达性/成本不变量。
// 靶子 = fixtures/impact/mini-repo（冻结判卷面，只读不改；已知调用图见 expect-edges.json）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createImpactQueryTool, graphAbsenceNote, graphCandidatePosition, impactQuerySpec } from "../src/tools/impact-query";
import { MAX_FILES_DEFAULT } from "../src/agent/map/build";
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
