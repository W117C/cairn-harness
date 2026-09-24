// §11.2 承诺：「默认 denyRead 集（密钥卫生硬边界，**用户可增不可减**）：~/.ssh/**、BYOK 密钥封装目录、
// ~/**/.env、Electron safeStorage 后端密钥路径」。这是 T2（BYOK/.env/SSH 私钥被读进模型上下文）
// 三条缓解里的第一条。本探针只问一件事：**这四条各自今天由谁守、守不守得住**——逐条，不逐句。
// 全部读数出自真函数（buildSandboxProfile / evaluate / read.run），不读源码形状。
import { mkdtempSync, writeFileSync, rmSync, readdirSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSandboxProfile } from "../../src/main/sandbox";
import { evaluate, newAutonomySession } from "../../src/permissions/autonomy";
import type { PermissionMode } from "../../src/permissions";
import { read_file as readFileTool } from "../../src/tools/read_file";
import type { ToolContext } from "../../src/tools/base";

const PLAN_PROMISES: { name: string; needle: string }[] = [
  { name: "~/.ssh/**", needle: ".ssh" },
  { name: "~/**/.env", needle: ".env" },
  { name: "BYOK 密钥封装目录（app 数据目录内）", needle: "appdata" },
  { name: "Electron safeStorage 后端密钥路径", needle: "keychains" },
];

// ---- 正控（先证这把尺活着）：冻结判卷文件在 L0-hard 必被拒 ----
const ctlSess = newAutonomySession("default", {
  rules: [], sandboxAvailable: null, sessionScopes: new Set<string>(),
  frozenJudgePaths: new Set<string>(["tests/todo.test.ts"]),
});
const ctl = evaluate("write_file", { path: "tests/todo.test.ts", content: "x" }, ctlSess);
if (!(ctl.verdict === "deny" && ctl.layer === "L0-hard")) {
  console.log("!! 正控失败：冻结判卷文件未被 L0-hard 拒（实得 " + JSON.stringify(ctl) + "）⇒ 会话构造不对，下面的读数全部作废");
  process.exit(1);
}
console.log("正控：L0-hard 确实拦得住写冻结判卷文件 ⇒ 尺活的\n");

// ---- 面 A：OS 沙箱 profile 里到底 deny 了什么（真函数产出的文本，不是我读数组）----
const root = mkdtempSync(join(tmpdir(), "denyread-a-"));
const profile = buildSandboxProfile(root);
console.log("=== 面 A｜buildSandboxProfile 实际 deny 的路径 ===");
const denyLines = profile.split("\n").filter((l) => /deny(?!.*network)/.test(l) && /subpath|literal/.test(l));
console.log(denyLines.join("\n") || "(无 filesystem deny 行)");
for (const p of PLAN_PROMISES) {
  const hit = denyLines.some((l) => l.toLowerCase().includes(p.needle));
  console.log(`  承诺「${p.name}」在 profile 里：${hit ? "有" : "**无**"}（找 ${p.needle}）`);
}

// ---- 面 B：权限层对读凭据路径的判果（四档 × 三形状）----
console.log("\n=== 面 B｜evaluate(\"read_file\", …) 逐档判果 ===");
const cases: { label: string; args: Record<string, unknown> }[] = [
  { label: "工作区内 .env", args: { path: ".env" } },
  { label: "工作区内嵌套凭据", args: { path: "config/prod.env" } },
  { label: "工作区内 .ssh/id_rsa", args: { path: ".ssh/id_rsa" } },
  { label: "绝对路径 ~/.ssh/id_rsa", args: { path: join(process.env.HOME ?? "/", ".ssh", "id_rsa") } },
];
const modes: PermissionMode[] = ["default", "guided", "auto", "read-only"];
for (const c of cases) {
  const row = modes.map((m) => {
    const d = evaluate("read_file", c.args, newAutonomySession(m, {
      rules: [], sandboxAvailable: null, sessionScopes: new Set<string>(), frozenJudgePaths: new Set<string>(),
    }));
    return `${m}=${d.verdict}/${d.layer}`;
  });
  console.log(`  ${c.label.padEnd(22)} ${row.join("  ")}`);
}

// ---- 面 C：真跑一次 read_file，看明文回不回来（工具层有无自己的守卫）----
console.log("\n=== 面 C｜read.run 真读工作区 .env ===");
const ws = mkdtempSync(join(tmpdir(), "denyread-c-"));
const SECRET = "sk-" + "T3rViv9Qk2Lm8Xs5Za1Bn7";
writeFileSync(join(ws, ".env"), `OPENAI_API_KEY=${SECRET}\n`);
const ctx: ToolContext = { workspace: ws };
const r = await readFileTool.run({ path: ".env" }, ctx).catch((e: unknown) => ({ ok: false, output: String(e) }));
const out = "output" in r ? String((r as { output: string }).output) : "";
console.log("  ok =", "ok" in r ? (r as { ok: boolean }).ok : "?");
console.log("  明文密钥出现在工具输出里：", out.includes(SECRET) ? "**是**（原样返回）" : "否");
if (!out.includes(SECRET)) console.log("  实际输出前 120 字:", out.slice(0, 120));

// ---- 面 D：真语料基础率（这是活路径还是假想路径）----
console.log("\n=== 面 D｜真语料 outputs/**/*.events.jsonl 里读凭据路径的调用 ===");
function walk(dir: string, acc: string[]): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) { if (f !== "node_modules" && f !== ".git") walk(p, acc); }
    else if (f.endsWith(".events.jsonl")) acc.push(p);
  }
  return acc;
}
const files = walk("outputs", []);
let calls = 0, hits = 0, shellHits = 0;
const exemplars: string[] = [];
for (const f of files) {
  for (const line of readFileSyncSafe(f).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let e: { type?: string; name?: string; args?: Record<string, unknown> };
    try { e = JSON.parse(t); } catch { continue; }
    if (e.type !== "tool_call" || !e.args) continue;
    calls++;
    const blob = JSON.stringify(e.args);
    if (/(^|[^A-Za-z0-9])\.env\b|\/\.env|\.ssh\/|id_rsa|credentials?\./i.test(blob)) {
      hits++;
      if (e.name === "run_shell") shellHits++;
      if (exemplars.length < 5) exemplars.push(`${e.name ?? "?"} ${blob.slice(0, 110)}`);
    }
  }
}
function readFileSyncSafe(p: string): string {
  try { return readFileSync(p, "utf8"); } catch { return ""; }
}
console.log(`  语料文件 ${files.length} 个｜tool_call ${calls} 次｜参数里点名凭据路径 ${hits} 次（其中 run_shell ${shellHits}）`);
for (const x of exemplars) console.log("   例:", x);
if (files.length === 0 || calls === 0) { console.log("  !! 语料或 tool_call 为空 ⇒ 这一面没有尺，不算读数"); }

rmSync(root, { recursive: true, force: true });
rmSync(ws, { recursive: true, force: true });
console.log("\n注：以上四面各自独立。A/B 都「无」而 D 有基础率 ⇒ 是真缺口；D=0 则缺口是理论形状，别当 P1 报。");
