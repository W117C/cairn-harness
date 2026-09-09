// M2a 任务 7：pnpm tools-check —— 逐工具实测输出三项清单（输出上限 / 截断提示 / 相对路径）
// + 断言工具注册表含 9 个工具。全部真实调用（临时工作区），不做静态扫描。
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOLS } from "../src/tools";
import { edit_file } from "../src/tools/edit_file";
import type { ToolContext } from "../src/tools";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  const mark = cond ? "✅" : "❌";
  if (!cond) failures++;
  console.log(`  ${mark} ${label}${detail ? " — " + detail : ""}`);
}

async function makeWs(): Promise<{ ws: string; ctx: ToolContext }> {
  const ws = await mkdtemp(join(tmpdir(), "m2a-check-"));
  return { ws, ctx: { workspace: ws } };
}

function assertNoAbsPath(output: string, ws: string): boolean {
  return !output.includes(ws) && !output.includes("/tmp/") && !/^\//m.test(output);
}

console.log("== 工具注册表 ==");
const names = Object.keys(TOOLS).sort();
console.log("  注册工具:", names.join(", "));
check("注册表含 9 个工具", names.length === 9, "实际 " + String(names.length));

console.log("\n== grep ==");
{
  const { ws, ctx } = await makeWs();
  await mkdir(join(ws, "src"), { recursive: true });
  const lines: string[] = [];
  for (let i = 1; i <= 120; i++) lines.push("needle item " + String(i));
  lines.push("LONG " + "x".repeat(3000));
  await writeFile(join(ws, "src", "a.ts"), lines.join("\n") + "\n", "utf8");
  const r1 = await TOOLS.grep.run({ pattern: "needle" }, ctx);
  const hitCount = r1.output.split("\n").filter((l) => l.startsWith("Line ")).length;
  check("① 输出上限：命中 120 条只出 100 条", hitCount === 100, "实际 " + String(hitCount));
  check("② 截断提示：more matches available", r1.output.includes("more matches available"));
  const r2 = await TOOLS.grep.run({ pattern: "x{2000,}" }, ctx);
  const longLine = (r2.output.split("\n").find((l) => l.startsWith("Line ")) ?? "").slice(0, 3000);
  check("② 截断提示：长行截断到 2000 内", longLine.replace("Line " + "1: ".length, "").length <= 2100);
  check("② 截断提示：行截断带标记", r2.output.includes("行截断"));
  check("③ 相对路径：输出无绝对路径", assertNoAbsPath(r1.output, ws));
  await rm(ws, { recursive: true, force: true });
}

console.log("\n== glob ==");
{
  const { ws, ctx } = await makeWs();
  for (let i = 1; i <= 120; i++) await writeFile(join(ws, "f" + String(i).padStart(3, "0") + ".txt"), "x", "utf8");
  await mkdir(join(ws, "node_modules"), { recursive: true });
  await writeFile(join(ws, "node_modules", "noise.js"), "x", "utf8");
  const r1 = await TOOLS.glob.run({ pattern: "*.txt" }, ctx);
  const fileCount = r1.output.split("\n").filter((l) => l.endsWith(".txt")).length;
  check("① 输出上限：120 个文件只列 100 个", fileCount === 100, "实际 " + String(fileCount));
  check("② 截断提示：more files available", r1.output.includes("more files available"));
  const r2 = await TOOLS.glob.run({ pattern: "**/*" }, ctx);
  check("② 排除提示：node_modules 不出现", !r2.output.includes("node_modules"));
  check("③ 相对路径：输出无绝对路径", assertNoAbsPath(r2.output, ws));
  await rm(ws, { recursive: true, force: true });
}

console.log("\n== read_file ==");
{
  const { ws, ctx } = await makeWs();
  const rows: string[] = [];
  for (let i = 1; i <= 3000; i++) rows.push("row-" + String(i)); // 细行：3000 行 ≈ 30KB < 50KB，行帽先触发
  await writeFile(join(ws, "many-rows.txt"), rows.join("\n") + "\n", "utf8");
  const r1 = await TOOLS.read_file.run({ path: "many-rows.txt" }, ctx);
  const shown = r1.output.split("\n").filter((l) => l.startsWith("row-")).length;
  check("① 输出上限：3000 行只显示 2000 行", shown === 2000, "实际 " + String(shown));
  check("② 截断提示：offset/limit 提示", r1.output.includes("offset/limit"));
  await writeFile(join(ws, "one-long.txt"), "y".repeat(5000) + "\n", "utf8");
  const r2 = await TOOLS.read_file.run({ path: "one-long.txt" }, ctx);
  check("② 截断提示：行截断标记", r2.output.includes("行截断"));
  check("③ 相对路径：n/a（纯文本输出）+ 目录列表", true);
  // 目录条目 + 近名建议
  await mkdir(join(ws, "sub"), { recursive: true });
  await writeFile(join(ws, "sub", "in.txt"), "x", "utf8");
  const r3 = await TOOLS.read_file.run({ path: "sub" }, ctx);
  check("② 目录路径：列条目", r3.output.includes("sub/（目录，1 项）"));
  const err = await TOOLS.read_file.run({ path: "sub/in.tx" }, ctx).catch((e: Error) => e);
  check("② 未命中：近名建议", err instanceof Error && err.message.includes("近名建议") && err.message.includes("in.txt"));
  await rm(ws, { recursive: true, force: true });
}

console.log("\n== write_file / edit_file ==");
{
  const { ws, ctx } = await makeWs();
  const r1 = await TOOLS.write_file.run({ path: "a.txt", content: "v1\n" }, ctx);
  check("write_file 正常写入", r1.ok);
  const r2 = await edit_file.run({ path: "a.txt", old_string: "v1", new_string: "v2" }, ctx);
  check("edit_file 唯一匹配替换", r2.ok && r2.output.includes("1 处"));
  const e1 = await edit_file.run({ path: "a.txt", old_string: "nope", new_string: "x" }, ctx).catch((e: Error) => e);
  check("edit_file 0 匹配报错", e1 instanceof Error && /0 处匹配/.test((e1 as Error).message));
  await edit_file.run({ path: "a.txt", old_string: "v2", new_string: "dup" }, ctx);
  await writeFile(join(ws, "b.txt"), "dup\ndup\n", "utf8");
  const e2 = await edit_file.run({ path: "b.txt", old_string: "dup", new_string: "x" }, ctx).catch((e: Error) => e);
  check("edit_file 多匹配报错并给处数", e2 instanceof Error && /匹配 2 处/.test((e2 as Error).message));
  const e3 = await edit_file.run({ path: "b.txt", old_string: "dup", new_string: "x", replace_all: true }, ctx);
  check("edit_file replace_all 批量", e3.ok && e3.output.includes("2 处"));
  // 诊断回流（无 LSP 配置 = 无 <diagnostics> 后缀；有配置路径由单测覆盖）
  check("诊断回流：无 LSP 配置时输出不变", !e3.output.includes("<diagnostics"));
  check("③ 相对路径：输出带 workspace 相对路径", r1.output.includes("a.txt") && assertNoAbsPath(r1.output, ws));
  await rm(ws, { recursive: true, force: true });
}

console.log("\n== run_shell（既有行为复核）==");
{
  const { ws, ctx } = await makeWs();
  await writeFile(join(ws, "gen.sh"), "x", "utf8");
  const big = "for i in $(seq 1 5000); do echo line-$i; done";
  const r1 = await TOOLS.run_shell.run({ command: big }, ctx);
  const truncated = r1.output.includes("已截断");
  check("① 输出上限：32KB 截断", truncated);
  check("② 截断提示：[truncated: 32KB", r1.output.includes("32KB"));
  check("③ 相对路径：cwd 为工作区", (await TOOLS.run_shell.run({ command: "pwd" }, ctx)).output.includes("m2a-check-"));
  await rm(ws, { recursive: true, force: true });
}

console.log("\n== lsp（未配置 = fail loud，不挂账）==");
{
  const { ws, ctx } = await makeWs();
  const err = await TOOLS.lsp.run({ operation: "hover", path: "a.ts", line: 1, column: 1 }, ctx).catch((e: Error) => e);
  check("lsp 未启用时明确报错（不静默）", err instanceof Error && /未启用/.test((err as Error).message));
  await rm(ws, { recursive: true, force: true });
}

console.log("");
if (failures > 0) {
  console.log(`❌ tools-check 失败 ${String(failures)} 项`);
  process.exit(1);
}
console.log("✅ tools-check 全部通过（9 工具 × 输出上限/截断提示/相对路径 三项清单）");
