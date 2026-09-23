// 复跑面 · 登记项 `replay:corpus-inventory`（判卷读数：judgment-layer §7 末「定序依据」四项）
//
// 与 `ask-density` 同一条理由搬进脚本：heredoc 不过编译。这里另有一处**该被机器记住**的坑，
// 09-21 实踩过——`tool_call` 的关联字段叫 `id`，`tool_result` 的叫 `callId`；按 `callId` 去查 `tool_call`
// 会得到 `Map.has(undefined)` 恒 false ⇒ 打出「失败=0 / 原样重试=0」的一片零**假读数**
// （该页 §附录 B 自纠第二条记的就是这次）。所以 join 键在这里写成具名常量 + 一条断言，
// 而不是散在表达式里：读错键不再只是"数不对"，而是当场崩。
import fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const GATED = new Set<string>(["write_file", "edit_file", "run_shell", "shell_rw", "shell_ro"]);
/** join 键：call 侧用 `id`，result 侧用 `callId`（两者不同名是本仓事件面的既有事实）。 */
const CALL_KEY = "id" as const;
const RESULT_KEY = "callId" as const;

interface Ev {
  type: string;
  [CALL_KEY]?: string;
  [RESULT_KEY]?: string;
  name?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
}

function jsonlUnder(dir: string, depth: number, out: string[]): void {
  if (depth > 4) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) jsonlUnder(p, depth + 1, out);
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
}

function parseLines(file: string): Ev[] {
  const out: Ev[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      out.push(JSON.parse(line) as Ev);
    } catch {
      /* 脏行跳过 */
    }
  }
  return out;
}

function main(): void {
  const roots = ["outputs", join(homedir(), "Library", "Application", "Support", "m0-agent-loop", "sessions")];
  const files: string[] = [];
  for (const r of roots) jsonlUnder(r, 0, files);

  let calls = 0, gated = 0, fails = 0, noRes = 0, retryName = 0, retryArgs = 0, nonAscii = 0;
  for (const f of files) {
    const ev = parseLines(f);
    const ok = new Map<string, boolean>();
    for (const e of ev) {
      if (e.type !== "tool_result") continue;
      const key = e[RESULT_KEY];
      if (typeof key !== "string") {
        // 有 result 却带不上 callId = 事件面坏了，静默跳过会把「失败」读成 0（正是 09-21 踩的形状）
        throw new Error(`corpus-inventory：tool_result 缺 ${RESULT_KEY}（${f}）——join 键断链，读数不可信`);
      }
      ok.set(key, e.ok === true);
    }
    const tc = ev.filter((e) => e.type === "tool_call");
    for (let i = 0; i < tc.length; i++) {
      const c = tc[i]!;
      const cid = c[CALL_KEY];
      if (typeof cid !== "string") throw new Error(`corpus-inventory：tool_call 缺 ${CALL_KEY}（${f}）`);
      calls++;
      if (GATED.has(String(c.name)) || String(c.name).startsWith("mcp__")) {
        gated++;
        const s = Object.values(c.args ?? {}).filter((v) => typeof v === "string").join(" ");
        if (/[^\x00-\x7F]/.test(s)) nonAscii++;
      }
      if (!ok.has(cid)) {
        noRes++;
        continue;
      }
      if (ok.get(cid) === true) continue;
      fails++;
      const n = tc[i + 1];
      if (n && n.name === c.name) {
        retryName++;
        if (JSON.stringify(n.args) === JSON.stringify(c.args)) retryArgs++;
      }
    }
  }
  console.log("会话文件=" + String(files.length), "tool_call=" + String(calls), "受管=" + String(gated), "受管含非ASCII=" + String(nonAscii));
  console.log("失败结果=" + String(fails), "无配对result=" + String(noRes), "失败后仍调同一工具=" + String(retryName), "其中参数一字不变=" + String(retryArgs));
}

main();
