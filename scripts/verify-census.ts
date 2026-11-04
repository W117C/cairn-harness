#!/usr/bin/env node
// 判据覆盖率统计：扫描 <workspace>/.agent/sessions/*.jsonl，逐行 JSON.parse，坏行跳过并计 skippedLines。
// 用法：
//   node --import tsx scripts/verify-census.ts [--workspace <dir>] [--json]
//   · --workspace <dir>  覆盖 workspace（缺省 process.cwd()）
//   · --json             打印 JSON；否则打印人读三行
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface CensusResult {
  /** .jsonl 会话文件数 */
  sessions: number;
  /** 含 type==="verify_result" 的文件数 */
  withVerify: number;
  /** 第一条 verify_result 的 ok===true 的文件数 */
  firstGreen: number;
  /** type==="user_message" 且 origin?.kind !== "goal" 的总条数 */
  userTurns: number;
  /** 坏行（JSON.parse 失败）累计数 */
  skippedLines: number;
  /** withVerify/sessions；0 会话时为 null */
  ratio: number | null;
}

function isVerifyResult(rec: Record<string, unknown>): boolean {
  return rec.type === "verify_result";
}

function isNonGoalUserMessage(rec: Record<string, unknown>): boolean {
  if (rec.type !== "user_message") return false;
  const origin = rec.origin;
  if (typeof origin !== "object" || origin === null) return true;
  return (origin as Record<string, unknown>).kind !== "goal";
}

export function collectCensus(workspace: string): CensusResult {
  const sessionsDir = join(workspace, ".agent", "sessions");
  let sessions = 0;
  let withVerify = 0;
  let firstGreen = 0;
  let userTurns = 0;
  let skippedLines = 0;

  const names = existsSync(sessionsDir)
    ? readdirSync(sessionsDir).filter((n) => n.endsWith(".jsonl"))
    : [];

  for (const name of names) {
    const filePath = join(sessionsDir, name);
    let content: string;
    try {
      const st = statSync(filePath);
      if (!st.isFile()) continue;
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    sessions += 1;
    let sawVerify = false;
    let firstVerifyOk: boolean | null = null;

    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (line.length === 0) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        skippedLines += 1;
        continue;
      }
      if (obj === null || typeof obj !== "object" || Array.isArray(obj)) continue;
      const rec = obj as Record<string, unknown>;
      if (isVerifyResult(rec)) {
        sawVerify = true;
        if (firstVerifyOk === null) firstVerifyOk = rec.ok === true;
      } else if (isNonGoalUserMessage(rec)) {
        userTurns += 1;
      }
    }

    if (sawVerify) withVerify += 1;
    if (firstVerifyOk === true) firstGreen += 1;
  }

  const ratio = sessions === 0 ? null : withVerify / sessions;
  return { sessions, withVerify, firstGreen, userTurns, skippedLines, ratio };
}

function parseArgs(argv: string[]): { workspace: string; json: boolean } {
  let workspace = process.cwd();
  let json = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") {
      json = true;
    } else if (a === "--workspace") {
      workspace = resolve(argv[i + 1] ?? process.cwd());
      i += 1;
    } else if (a.startsWith("--workspace=")) {
      workspace = resolve(a.slice("--workspace=".length));
    }
  }
  return { workspace, json };
}

function main(): void {
  const { workspace, json } = parseArgs(process.argv);
  const r = collectCensus(workspace);
  if (json) {
    process.stdout.write(JSON.stringify(r) + "\n");
  } else {
    process.stdout.write(`sessions: ${r.sessions}\nwithVerify: ${r.withVerify}\nfirstGreen: ${r.firstGreen}\n`);
  }
}

// 仅当作为入口直接运行时执行 main；被测试 import 时不触发。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
