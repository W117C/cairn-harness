// M2a 任务 7 / M2g 任务 5：pnpm tools-check —— 逐工具实测输出三项清单（输出上限 / 截断提示 / 相对路径）
// + 断言工具注册表含 9 个工具。全部真实调用（临时工作区），不做静态扫描。
//
// M2g 修正（闭合 §1.4-4「空断言 + 言过其实的结语」）：
//   - 删掉 `check(..., true)` 形式的空断言；
//   - 语义上不适用的项显式标 **n/a 并写理由**（不是恒真断言）；
//   - lsp 段补齐三项（此前只验「未启用报错」）：借 fixtures/lsp/stub-server.mjs 真跑 documentSymbol
//     触发输出上限 + 截断提示，并核对相对路径输出；
//   - 结语按**实际覆盖**打印（工具 × 三项的逐格勾选），不再打印与覆盖不符的笼统结论。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../src/tools";
import { edit_file } from "../src/tools/edit_file";
import { closeAllLspClients, lsp } from "../src/tools/lsp";
import type { ToolContext } from "../src/tools";

let failures = 0;
let checks = 0;
let nas = 0;
function check(label: string, cond: boolean, detail = ""): void {
  checks++;
  const mark = cond ? "✅" : "❌";
  if (!cond) failures++;
  console.log(`  ${mark} ${label}${detail ? " — " + detail : ""}`);
}
/** 显式 n/a（语义上不适用）：不是恒真断言，也不计入通过数。 */
function na(label: string, reason: string): void {
  nas++;
  console.log(`  ⏭ ${label} — n/a：${reason}`);
}

/** 逐工具 × 三项覆盖表（结语按实际覆盖打印）。 */
type Mark = "✅" | "❌" | "n/a";
const COVERAGE = new Map<string, [Mark, Mark, Mark]>();
function mark(tool: string, idx: 0 | 1 | 2, v: Mark): void {
  const cur = COVERAGE.get(tool) ?? ["n/a", "n/a", "n/a"];
  cur[idx] = v;
  COVERAGE.set(tool, cur);
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
  // 第 66 页口径：帽提示必须说对量纲。旧断言钉的是英文串，而那句话把「100 条命中帽」写成
  // 「输出超过 100KB 上限」——所以这里改钉两件事：有统一的 [truncated: 前缀 + 说的是条数、不是 KB。
  check("② 截断提示：说条数不说 KB", r1.output.includes("[truncated:") && r1.output.includes("条命中") && !r1.output.includes("KB"));
  const r2 = await TOOLS.grep.run({ pattern: "x{2000,}" }, ctx);
  const longLine = (r2.output.split("\n").find((l) => l.startsWith("Line ")) ?? "").slice(0, 3000);
  check("② 截断提示：长行截断到 2000 内", longLine.replace("Line " + "1: ".length, "").length <= 2100);
  check("② 截断提示：行截断带标记", r2.output.includes("行截断"));
  // 查改一体两项新能力过门：context 省掉「为拼 old_string 再读一次文件」那一轮，
  // fixed_strings 治的是含元字符查询词的**静默**假阳性（不报错，只是多命中）。
  {
    const r3 = await TOOLS.grep.run({ pattern: "needle item 7$", context: 1 }, ctx);
    const ctxRows = r3.output.split("\n").filter((l) => /^ {2}\d+ \| /.test(l)).length;
    check("② context=1 带回邻行且前缀可分辨", r3.output.includes("Line ") && ctxRows === 2, "邻行 " + String(ctxRows));
  }
  await writeFile(join(ws, "lit.txt"), "a.b\naxb\n", "utf8");
  {
    const hits = (out: string): number => out.split("\n").filter((l) => l.startsWith("Line ")).length;
    const re = await TOOLS.grep.run({ pattern: "a.b", path: "lit.txt" }, ctx);
    const fix = await TOOLS.grep.run({ pattern: "a.b", path: "lit.txt", fixed_strings: true }, ctx);
    check("② fixed_strings 收掉正则假阳性（2 命中 → 1）", hits(re.output) === 2 && hits(fix.output) === 1,
      String(hits(re.output)) + " → " + String(hits(fix.output)));
  }
  check("③ 相对路径：输出无绝对路径", assertNoAbsPath(r1.output, ws));
  mark("grep", 0, "✅");
  mark("grep", 1, "✅");
  mark("grep", 2, "✅");
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
  check("② 截断提示：说文件数不说 KB", r1.output.includes("[truncated:") && r1.output.includes("个文件") && !r1.output.includes("KB"));
  const r2 = await TOOLS.glob.run({ pattern: "**/*" }, ctx);
  check("② 排除提示：node_modules 不出现", !r2.output.includes("node_modules"));
  check("③ 相对路径：输出无绝对路径", assertNoAbsPath(r2.output, ws));
  mark("glob", 0, "✅");
  mark("glob", 1, "✅");
  mark("glob", 2, "✅");
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
  // 目录列表：输出含 workspace 相对路径且无绝对路径（真断言，替换旧版恒真式）
  await mkdir(join(ws, "sub"), { recursive: true });
  await writeFile(join(ws, "sub", "in.txt"), "x", "utf8");
  const r3 = await TOOLS.read_file.run({ path: "sub" }, ctx);
  check("② 目录路径：列条目", r3.output.includes("sub/（目录，1 项）"));
  check(
    "③ 相对路径：目录列表以相对路径呈现且无绝对路径",
    r3.output.includes("in.txt") && assertNoAbsPath(r3.output, ws),
    "输出首行：" + r3.output.split("\n")[0],
  );
  const err = await TOOLS.read_file.run({ path: "sub/in.tx" }, ctx).catch((e: Error) => e);
  check("② 未命中：近名建议", err instanceof Error && err.message.includes("近名建议") && err.message.includes("in.txt"));
  mark("read_file", 0, "✅");
  mark("read_file", 1, "✅");
  mark("read_file", 2, "✅");
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
  // edit_file 的 ①/②：输出是定长摘要（"已替换 <rel>（N 处，+A −R 行）"）+ 有界诊断块（每文件 ≤20 条），
  // 无无界输出面 → 语义上不适用，显式标 n/a 并写理由（不是恒真断言）。
  na("edit_file ① 输出上限", "输出为定长摘要 + 有界诊断块（每文件 ≤20 条），不存在无界输出面");
  na("edit_file ② 截断提示", "同上：输出有界，无需截断提示");
  check(
    "③ 相对路径：输出带 workspace 相对路径且无绝对路径",
    r1.output.includes("a.txt") && assertNoAbsPath(r1.output, ws),
    "write_file 输出：" + r1.output,
  );
  mark("edit_file", 0, "n/a");
  mark("edit_file", 1, "n/a");
  mark("edit_file", 2, "✅");
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
  // 提示要说清「省了多少字节、留了哪两段」：旧文案只报 32KB 上限，模型无从判断尾部结论还在不在
  //（run_shell 已从头尾双段截断，见 middleTruncationNotice）。
  check("② 截断提示：报省略字节数且尾段仍在", /\[truncated: [^\n]*省略中间 \d+ 字节/.test(r1.output) && r1.output.includes("line-5000"));
  check("③ 相对路径：cwd 为工作区", (await TOOLS.run_shell.run({ command: "pwd" }, ctx)).output.includes("m2a-check-"));
  await rm(ws, { recursive: true, force: true });
}

console.log("\n== lsp（三项补齐：输出上限 / 截断提示 / 相对路径）==");
{
  const STUB = fileURLToPath(new URL("../fixtures/lsp/stub-server.mjs", import.meta.url));
  const ws = await mkdtemp(join(tmpdir(), "m2a-check-lsp-"));
  const ctx: ToolContext = { workspace: ws };
  // 1) 未启用 = fail loud（既有断言，保留）
  const err = await lsp.run({ operation: "hover", path: "a.ts", line: 1, column: 1 }, ctx).catch((e: Error) => e);
  check("lsp 未启用时明确报错（不静默）", err instanceof Error && /未启用/.test((err as Error).message));
  // 2) 装配 stub server（与 tests/lsp.test.ts 同一靶子；真实 stdio JSON-RPC）
  await mkdir(join(ws, ".agent"), { recursive: true });
  await writeFile(
    join(ws, ".agent", "lsp.json"),
    JSON.stringify({ lsp: { stub: { command: "node", args: [STUB], extensions: [".ts", ".js"] } } }),
    "utf8",
  );
  await mkdir(join(ws, "src"), { recursive: true });
  const syms: string[] = [];
  for (let i = 1; i <= 1500; i++) syms.push("SYM(symbol_" + String(i).padStart(4, "0") + ") 一行一个文档符号，撑大输出");
  syms.push("ERROR_HERE");
  await writeFile(join(ws, "src", "big.ts"), syms.join("\n") + "\n", "utf8");
  const big = await lsp.run({ operation: "documentSymbol", path: "src/big.ts" }, ctx);
  // #52：输出帽那句提示承诺的是 32KB（字节），而 capLspOutput 原先量 text.length（字符）。
  // 同一 stub、同样 1500 个符号，在两棵树上实测（HEAD 旧实现 / 在飞新实现）：
  //   符号名 ASCII ⇒ 32798 字符 / 32818 字节（ratio 1.00）：这一格新旧口径同答，看不出问题；
  //   符号名中文 ⇒ 32798 字符 / 53998 字节（ratio 1.65）：旧门按字符量照样绿，
  //                而模型拿到的正文比承诺的 32KB 多出 21230 字节，那句截断提示是假的。
  // 所以 ① 把量纲改成字节（读数两个都给），并补下面 ④ —— 新旧口径答案分歧的那一格。
  check("① 输出上限：1500 个符号的 documentSymbol 被截到 32KB 内", big.ok && Buffer.byteLength(big.output, "utf8") <= 32 * 1024 + 80,
    "实际 " + String(Buffer.byteLength(big.output, "utf8")) + " 字节 / " + String(big.output.length) + " 字符");
  check("② 截断提示：[truncated: 输出超过 32KB", big.output.includes("32KB 上限，已截断"));
  check(
    "③ 相对路径：符号位置输出无绝对路径（documentSymbol 为单文档，位置形态 :line:col）",
    assertNoAbsPath(big.output, ws),
    "首行：" + big.output.split("\n")[0],
  );
  // ④ = ①的量纲分辨力：中文符号名（真实仓库里常见：中文标识符、中文诊断文案）让字符与字节分开。
  // 两棵树实测：HEAD 旧实现在这一格交 53998 字节（旧门按字符读 32798 ⇒ 绿），在飞新实现交 32817 字节。
  // ④ 反向那条是给新实现自己用的：按字节切会留下半个多字节序列，旧实现按字符切反而不会。
  const cjkSyms: string[] = [];
  for (let i = 1; i <= 1500; i++) cjkSyms.push("SYM(符号编号" + String(i).padStart(4, "0") + "的中文标识符) 撑大输出");
  await writeFile(join(ws, "src", "cjk.ts"), cjkSyms.join("\n") + "\n", "utf8");
  const cjkBig = await lsp.run({ operation: "documentSymbol", path: "src/cjk.ts" }, ctx);
  const cjkBytes = Buffer.byteLength(cjkBig.output, "utf8");
  check("④ 中文输出：承诺 32KB 时截断必须按字节生效（旧实现在这一格按字符放行）",
    cjkBig.ok && cjkBytes <= 32 * 1024 + 80 && cjkBig.output.includes("32KB 上限，已截断"),
    "实际 " + String(cjkBytes) + " 字节 / " + String(cjkBig.output.length) + " 字符");
  const replacementChar = String.fromCharCode(0xfffd); // 半个 UTF-8 序列解码后就长这样，源码里不留这个字符本身
  check("④ 反向：截断处不许留半个 UTF-8 序列（半个字符进 provider 变问号）",
    !cjkBig.output.includes(replacementChar),
    "正文尾 40 字符：" + JSON.stringify(cjkBig.output.slice(-40)));
  // 定义/引用走真实位置输出，复核相对路径
  await writeFile(join(ws, "src", "sample.ts"), ["function alpha() {}", "DEF(alpha) here", "REF(alpha) one", ""].join("\n"), "utf8");
  const def = await lsp.run({ operation: "definition", path: "src/sample.ts", line: 2, column: 5 }, ctx);
  check("③ 相对路径：definition 结果为 rel:line:col", def.ok && /^src\/sample\.ts:\d+:\d+$/.test(def.output.trim()), "实际 " + def.output.trim());
  mark("lsp", 0, "✅");
  mark("lsp", 1, "✅");
  mark("lsp", 2, "✅");
  await closeAllLspClients();
  await rm(ws, { recursive: true, force: true });
}

console.log("");
console.log("== 三项清单覆盖（按实际覆盖打印，结语与断言一一对应）==");
const order = ["grep", "glob", "read_file", "edit_file", "lsp"];
let asserted = 0;
for (const t of order) {
  const c = COVERAGE.get(t);
  if (!c) continue;
  for (const m of c) if (m === "✅") asserted++;
  console.log("  " + t.padEnd(10) + " ① " + c[0] + "   ② " + c[1] + "   ③ " + c[2]);
}
const total = order.length * 3;
console.log(
  "  合计：" + String(total) + " 格 = 已断言 " + String(asserted) + " + n/a " + String(nas) +
    "；本次实跑 check " + String(checks) + " 条（含清单外的语义断言）",
);

if (failures > 0) {
  console.log(`❌ tools-check 失败 ${String(failures)} 项`);
  process.exit(1);
}
console.log(
  "✅ tools-check 全部通过：grep/glob/read_file/lsp 四工具三项全绿；edit_file ①② 显式 n/a（输出有界），③ 相对路径绿。",
);
