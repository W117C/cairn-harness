// 影响面**读端**工具（能力 1 的事前一跳）：查询正确性 + 参数白名单 + 越权路径 + 可达性/成本不变量。
// 靶子 = fixtures/impact/mini-repo（冻结判卷面，只读不改；已知调用图见 expect-edges.json）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createImpactQueryTool, impactQuerySpec } from "../src/tools/impact-query";
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

  it("不在图内的文件（路径写错 / 后缀不支持）给出下一步动作", async () => {
    const r = await tool().run({ file: "notes.txt" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("不在影响图内");
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

  it("deps 模式下不在图内的文件仍然 fail-visible", async () => {
    const r = await tool().run({ file: "ghost.js", deps: true }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("不在影响图内");
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
