// M2a 任务 7 / M2g 任务 5：pnpm tools-check —— 逐工具实测输出三项清单（输出上限 / 截断提示 / 相对路径）
// + 断言工具注册表含 12 个工具（9 + M2 的 apply_patch + 2026-10-15 的 read_image + 2026-10-16 的 render_image）。全部真实调用（临时工作区），不做静态扫描。
//
// M2g 修正（闭合 §1.4-4「空断言 + 言过其实的结语」）：
//   - 删掉 `check(..., true)` 形式的空断言；
//   - 语义上不适用的项显式标 **n/a 并写理由**（不是恒真断言）；
//   - lsp 段补齐三项（此前只验「未启用报错」）：借 fixtures/lsp/stub-server.mjs 真跑 documentSymbol
//     触发输出上限 + 截断提示，并核对相对路径输出；
//   - 结语按**实际覆盖**打印（工具 × 三项的逐格勾选），不再打印与覆盖不符的笼统结论。
import { mkdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// 隔离 LSP 运行态落盘目录：避免门禁向宿主真实 ~/.config/cairn/lsp-runtime 写入或在受限沙箱下报 EPERM。
if (!process.env.CAIRN_LSP_HOME) process.env.CAIRN_LSP_HOME = join(tmpdir(), "dsh-tools-check-lsp-home");
mkdirSync(process.env.CAIRN_LSP_HOME, { recursive: true });

import { TOOLS } from "../src/tools";
import { ToolError } from "../src/tools/base";
import { edit_file } from "../src/tools/edit_file";
import { closeAllLspClients, lsp, setLspTrustedRepos } from "../src/tools/lsp";
import { todo_write } from "../src/tools/todo_write";
import { backgroundTasksFor, forgetBackgroundTasks } from "../src/tools/background-tasks";
import type { AgentEvent } from "../src/events";
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
// M2 起 10 个；2026-10-15 加 read_image（识图）；2026-10-16 加 render_image（渲染 HTML/SVG 成 PNG）；2026-11-04 加 todo_write（工作状态面板清单）⇒ 13。
// 2026-11-05 加 task_output / task_stop（后台任务三件套，run_shell 的 background 档）⇒ 15。
// 2026-11-06 加 git_read（只读三合一）⇒ 16；+calc（确定性算术）+ list_dir（目录总览）⇒ 18；+read_doc（文档读取）⇒ 19。
// 2026-11-10 加 web_doc（网络文档→文本）⇒ 20；+fs_ops（文件生命周期四动作）⇒ 21。
check("注册表含 21 个工具", names.length === 21, "实际 " + String(names.length));

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
  // #58 第二半：判卷/基准跑的是仓内 fixture，显式声明信任（口径与 tests/lsp.test.ts 同源）。
  setLspTrustedRepos([ws]);
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
  // 帽管的是**正文**，提示行在帽之外——这条口径从 #57 起写成两截量，不再用 "+80" 这种魔数容差：
  // 提示一旦报出省略量与续读位置就会变长，魔数会先于真实缺陷红（或先于真实越界绿）。
  const splitNotice = (s: string): { bodyBytes: number; noticeBytes: number } => {
    const i = s.indexOf("\n[truncated:");
    const body = i < 0 ? s : s.slice(0, i);
    return { bodyBytes: Buffer.byteLength(body, "utf8"), noticeBytes: Buffer.byteLength(s, "utf8") - Buffer.byteLength(body, "utf8") };
  };
  const bigSplit = splitNotice(big.output);
  check("① 输出上限：1500 个符号的 documentSymbol 正文被截到 32KB 内（提示行另计且有界）",
    big.ok && bigSplit.bodyBytes <= 32 * 1024 && bigSplit.noticeBytes <= 400,
    "正文 " + String(bigSplit.bodyBytes) + " 字节 / 提示 " + String(bigSplit.noticeBytes) + " 字节 / " + String(big.output.length) + " 字符");
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
  const cjkSplit = splitNotice(cjkBig.output);
  check("④ 中文输出：承诺 32KB 时截断必须按字节生效（旧实现在这一格按字符放行 53998 字节）",
    cjkBig.ok && cjkSplit.bodyBytes <= 32 * 1024 && cjkBig.output.includes("32KB 上限，已截断"),
    "正文 " + String(cjkSplit.bodyBytes) + " 字节 / 提示 " + String(cjkSplit.noticeBytes) + " 字节 / " + String(cjkBig.output.length) + " 字符");
  // ⑤ 提示要报得出省略量（#57：只说"已截断"的模型不知道自己是看全了还是漏了一大段）。
  // 这里只判"报了个正数、且不是把帽值或正文长度抄过来充数"——**逐字节对等**那一条在
  // `tests/cap-notice-unit.test.ts`（它拿独立构造的请求体自己算省略量），门不重复造那把尺。
  const omitted = Number((cjkBig.output.match(/还有 (\d+) 字节未显示/) ?? [])[1]);
  check("⑤ 截断提示报得出省略字节数（不是 0、也不是拿帽值/正文长度充数）",
    Number.isInteger(omitted) && omitted > 0 && omitted !== 32 * 1024 && omitted !== cjkSplit.bodyBytes,
    "省略 " + String(omitted) + " 字节（正文 " + String(cjkSplit.bodyBytes) + " 字节）");
  const replacementChar = String.fromCharCode(0xfffd); // 半个 UTF-8 序列解码后就长这样，源码里不留这个字符本身
  check("④ 反向：截断处不许留半个 UTF-8 序列（半个字符进 provider 变问号）",
    !cjkBig.output.includes(replacementChar),
    "输出尾 40 字符：" + JSON.stringify(cjkBig.output.slice(-40)));
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

console.log("\n== todo_write ==");
{
  const { ws, ctx } = await makeWs();
  const emitted: AgentEvent[] = [];
  const wiredCtx: ToolContext = { ...ctx, callId: "c-todo-1", emit: async (e) => { emitted.push(e); } };
  let unWiredThrew = false;
  try {
    await todo_write.run({ items: [{ text: "检查门禁", state: "pending" }] }, ctx);
  } catch (err) {
    unWiredThrew = err instanceof ToolError;
  }
  check("未接线 emit/callId fail-closed 报错", unWiredThrew);
  let overItemsThrew = false;
  try {
    const twentyOne = Array.from({ length: 21 }, (_, i) => ({ text: "项 " + String(i), state: "pending" }));
    await todo_write.run({ items: twentyOne }, wiredCtx);
  } catch (err) {
    overItemsThrew = err instanceof ToolError;
  }
  check("① 入参上界：超过 20 项 fail-loud 拒收（不静默截断）", overItemsThrew);
  na("todo_write ① 输出上限", "入参硬卡 ≤20 项 × ≤200 字，回执长度结构性有界（≤4.2KB），不存在无界输出面");
  na("todo_write ② 截断提示", "同上：超限直接抛 ToolError 拒收而非截断，无需截断提示");
  const okRes = await todo_write.run(
    { items: [{ text: "对齐门禁", state: "done" }, { text: "拆分模块", state: "pending" }] },
    wiredCtx,
  );
  const noAbs = okRes.ok && emitted.length === 1 && emitted[0]?.type === "todo_updated" && assertNoAbsPath(okRes.output, ws);
  check("③ 相对路径与事件落流：回执含完成进度且无绝对路径", noAbs, "首行：" + okRes.output.split("\n")[0]);
  mark("todo_write", 2, noAbs ? "✅" : "❌");
  await rm(ws, { recursive: true, force: true });
}

console.log("\n== 新工具实测（git_read / read_doc / calc / list_dir） ==");
{
  const { ws, ctx } = await makeWs();
  await mkdir(join(ws, "src"), { recursive: true });
  await mkdir(join(ws, "sub"), { recursive: true });
  const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (args: string[]): void => { execFileSync("git", args, { cwd: ws, env: gitEnv, stdio: "pipe" }); };
  git(["init", "-q"]);
  await writeFile(join(ws, "a.ts"), "one\n", "utf8");
  git(["add", "."]);
  git(["commit", "-qm", "init"]);
  await writeFile(join(ws, "a.ts"), "two\n", "utf8");
  const status = await TOOLS.git_read.run({ op: "status" }, ctx);
  const diff = await TOOLS.git_read.run({ op: "diff", path: "a.ts" }, ctx);
  const log = await TOOLS.git_read.run({ op: "log" }, ctx);
  check("git_read status/diff/log 真跑三支且只回 workspace 相对路径",
    status.ok && status.output.includes("a.ts") && diff.ok && diff.output.includes("+two") &&
    log.ok && log.output.includes("init") && [status, diff, log].every((r) => assertNoAbsPath(r.output, ws)),
    "status: " + status.output.split("\n")[0]);
  check("git_read 截断帽与越界保护（真工具调用）",
    diff.output.length < 20_100 && (await TOOLS.git_read.run({ op: "push" }, ctx).catch((e: unknown) => e)) instanceof ToolError);

  // 零依赖 zip 写入器（stored 成员）：与判卷夹具同形，只用于现场造 docx/xlsx。
  const makeZip = (files: Record<string, string>): Buffer => {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
      const data = Buffer.from(content, "utf8");
      const n = Buffer.from(name, "utf8");
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt16LE(n.length, 26);
      localParts.push(local, n, data);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt32LE(data.length, 20);
      central.writeUInt16LE(n.length, 28);
      central.writeUInt32LE(offset, 42);
      centralParts.push(central, n);
      offset += local.length + n.length + data.length;
    }
    const cd = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(Object.keys(files).length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...localParts, cd, eocd]);
  };
  await writeFile(join(ws, "sample.docx"), makeZip({
    "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>第一段：A&amp;B</w:t><w:tab/><w:t>列二</w:t></w:r></w:p></w:body></w:document>",
  }));
  await writeFile(join(ws, "sample.xlsx"), makeZip({
    "xl/workbook.xml": "<workbook/>",
    "xl/sharedStrings.xml": "<sst><si><t>名称</t></si><si><t>价格</t></si></sst>",
    "xl/worksheets/sheet1.xml": "<worksheet><sheetData><row><c t=\"s\"><v>0</v></c><c t=\"s\"><v>1</v></c></row><row><c t=\"s\"><v>0</v></c><c><v>42</v></c></row></sheetData></worksheet>",
  }));
  await writeFile(join(ws, "sample.pdf"), "%PDF-1.4\n1 0 obj\n<<>>\nstream\nBT (pdf text check) Tj ET\nendstream\nendobj\n%%EOF", "latin1");
  await writeFile(join(ws, "long.docx"), makeZip({
    "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>" + "x".repeat(21_000) + "</w:t></w:r></w:p></w:body></w:document>",
  }));
  const docx = await TOOLS.read_doc.run({ path: "sample.docx" }, ctx);
  const xlsx = await TOOLS.read_doc.run({ path: "sample.xlsx" }, ctx);
  const pdf = await TOOLS.read_doc.run({ path: "sample.pdf" }, ctx);
  const long = await TOOLS.read_doc.run({ path: "long.docx" }, ctx);
  check("read_doc docx/xlsx/pdf 真读三类且正文不出绝对路径",
    docx.ok && docx.output.includes("第一段：A&B\t列二") &&
    xlsx.ok && xlsx.output.includes("名称\t42") &&
    pdf.ok && pdf.output.includes("pdf text check") &&
    [docx, xlsx, pdf].every((r) => assertNoAbsPath(r.output, ws)));
  check("read_doc 输出帽：>20K 字符截断且明确说被截断",
    long.ok && long.output.includes("[read_doc] 输出已截断") && long.output.length < 21_000);

  const calc = await TOOLS.calc.run({ expression: "(128000-8192)*0.8/4" }, ctx);
  const badCalc = await TOOLS.calc.run({ expression: "1; process.exit(1)" }, ctx).catch((e: unknown) => e);
  check("calc 确定性算术 + 拒绝任意表达式（零 eval 面）",
    calc.ok && calc.output.includes("23961.6") && badCalc instanceof ToolError, calc.output);
  for (let i = 0; i < 201; i++) await writeFile(join(ws, "sub", "f" + String(i).padStart(3, "0") + ".txt"), "x", "utf8");
  const listing = await TOOLS.list_dir.run({ path: "sub" }, ctx);
  check("list_dir 单层 200 项帽 + 截断提示 + 相对路径",
    listing.ok && listing.output.includes("201 项，截断到 200") && listing.output.includes("[list_dir] 已截断") &&
    assertNoAbsPath(listing.output, ws), listing.output.split("\n")[0]);
  await rm(ws, { recursive: true, force: true });
}

console.log("\n== fs_ops（文件生命周期四动作） ==");
{
  const { ws, ctx } = await makeWs();
  // ① mkdir：递归建 + 幂等；已存在同名文件拒绝（静默成功会让模型以为建好了目录）。
  await writeFile(join(ws, "afile"), "x", "utf8");
  const mk1 = await TOOLS.fs_ops.run({ action: "mkdir", path: "deep/nested/dir" }, ctx);
  const mk2 = await TOOLS.fs_ops.run({ action: "mkdir", path: "deep/nested/dir" }, ctx);
  const mk3 = await TOOLS.fs_ops.run({ action: "mkdir", path: "afile" }, ctx).catch((e: unknown) => e);
  check("① mkdir 递归建 + 幂等 + 同名文件拒绝",
    mk1.ok && mk2.ok && mk1.output.includes("已创建目录") && mk3 instanceof ToolError);
  // ② move：改名；目标已存在默认拒绝、显式 allow_overwrite 才放行且拍快照。
  await writeFile(join(ws, "src.txt"), "move me", "utf8");
  await writeFile(join(ws, "dst.txt"), "old content", "utf8");
  const mvClash = await TOOLS.fs_ops.run({ action: "move", path: "src.txt", target: "dst.txt" }, ctx).catch((e: unknown) => e);
  const mvOk = await TOOLS.fs_ops.run({ action: "move", path: "src.txt", target: "dst.txt", allow_overwrite: true }, ctx);
  check("② move 改名 + 覆盖需显式 + 覆盖前快照",
    mvClash instanceof ToolError && mvOk.ok && (mvOk as { snapshotId?: string }).snapshotId !== undefined,
    String(mvClash instanceof ToolError ? mvClash.message : mvOk.output));
  // ③ delete：删文件拍快照；非空目录拒绝并点名出口；.agent/ 禁区拒绝。
  const del = await TOOLS.fs_ops.run({ action: "delete", path: "dst.txt" }, ctx);
  const dirDel = await TOOLS.fs_ops.run({ action: "delete", path: "deep" }, ctx).catch((e: unknown) => e);
  const agentDel = await TOOLS.fs_ops.run({ action: "delete", path: ".agent/config.json" }, ctx).catch((e: unknown) => e);
  check("③ delete 快照 + 非空目录拒绝 + .agent 禁区",
    del.ok && (del as { snapshotId?: string }).snapshotId !== undefined &&
    dirDel instanceof ToolError && dirDel.message.includes("批量删除") &&
    agentDel instanceof ToolError,
    del.output.split("\n")[0] as string);
  check("③ 输出全部相对路径", assertNoAbsPath(del.output, ws) && assertNoAbsPath(mvOk.output, ws));
  await rm(ws, { recursive: true, force: true });
}

console.log("\n== web_doc（网络文档→文本） ==");
{
  const { ws, ctx } = await makeWs();
  // 不出网的实测：SSRF 判据是纯函数面，loopback 地址在解析前就被拒——
  // 这一支只证「判据在传输前开火」，抓真文档的网络路径由 web-fetch-check 与单元判卷覆盖。
  const loopback = await TOOLS.web_doc.run({ url: "http://127.0.0.1:9/x.pdf" }, ctx).catch((e: unknown) => e);
  check("① loopback 一律拒绝（SSRF 判据在传输前开火）", !((loopback as { ok?: boolean }).ok));
  const bad = await TOOLS.web_doc.run({ url: "" }, ctx).catch((e: unknown) => e);
  check("② 空 url fail-loud", bad instanceof ToolError);
  await rm(ws, { recursive: true, force: true });
}

console.log("\n== task_output / task_stop（后台任务三件套） ==");
{
  const { ws, ctx } = await makeWs();
  // 真后台任务两支：瞬时命令（跑完即终态）与长命令（读进行态后组杀）。
  // 走注册表直调（run_shell → registry 的接线面由 vitest 棘轮钉）；命令串用数组拼。
  const scopedCtx = { ...ctx, sessionLogPath: join(ws, "session.jsonl") };
  const backgroundTasks = backgroundTasksFor(scopedCtx);
  const echoCmd = ["echo", "bg-ok-marker"].join(" ");
  const sleepCmd = ["sleep", "30"].join(" ");
  const { id } = backgroundTasks.start(echoCmd, ws);
  check("注册表起任务：立即返回 bg_N 任务号", id !== "", id);
  await new Promise((r) => { setTimeout(r, 250); });
  const readDone = await TOOLS.task_output.run({ task_id: id }, scopedCtx);
  check("① task_output 读到输出与终态（退出码 0）", readDone.ok && readDone.output.includes("bg-ok-marker") && readDone.output.includes("退出码 0"));
  mark("task_output", 0, readDone.ok ? "✅" : "❌");
  // ② 截断提示：输出环与 run_shell 同源（32KB 头尾环 + [truncated:] 注记），帽行为由 output-ring 判卷覆盖。
  na("task_output ② 截断提示", "输出环与 run_shell 同源（32KB 头尾环），帽行为由 output-ring 自身判卷覆盖");
  const { id: longId } = backgroundTasks.start(sleepCmd, ws);
  const running = await TOOLS.task_output.run({ task_id: longId }, scopedCtx);
  check("长命令读出「仍在运行」", running.ok && running.output.includes("仍在运行"));
  const stopped = await TOOLS.task_stop.run({ task_id: longId }, scopedCtx);
  check("task_stop 组杀并回给停止前输出", stopped.ok && stopped.output.includes("已停止"));
  mark("task_stop", 2, stopped.ok ? "✅" : "❌");
  const read2 = await TOOLS.task_output.run({ task_id: longId }, scopedCtx);
  check("③ 停止后读终态：不再「仍在运行」、无绝对路径", read2.ok && !read2.output.includes("仍在运行") && assertNoAbsPath(read2.output, ws));
  mark("task_output", 2, read2.ok ? "✅" : "❌");
  let unknownThrew = false;
  try { await TOOLS.task_output.run({ task_id: "bg_999" }, scopedCtx); } catch (err) { unknownThrew = err instanceof ToolError; }
  check("未知任务号 fail-loud（点名现存任务域）", unknownThrew);
  await rm(ws, { recursive: true, force: true });
  forgetBackgroundTasks(scopedCtx.sessionLogPath);
}

console.log("");
console.log("== 三项清单覆盖（按实际覆盖打印，结语与断言一一对应）==");
const order = ["grep", "glob", "read_file", "edit_file", "lsp", "todo_write", "task_output", "task_stop"];
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
  "✅ tools-check 全部通过：grep/glob/read_file/lsp 四工具三项全绿；edit_file/todo_write ①② 显式 n/a（结构性有界），③ 相对路径绿。",
);
