/** 「裸 hex 长串」到底是凭据还是校验和——先数清楚再决定加不加规则（任务 #6 的取料）。
 *
 *  为什么必须先量：把 `threshold` 调低或加一条"hex≥32 即密钥"看着像补漏检，
 *  但编码 agent 的输出里 40/64 位 hex 绝大多数是 **git blob/commit hash、lockfile 的 sha512/md5 校验和**。
 *  掩掉它们 = 让一条安全判据制造返工（模型看不到 hash 就没法核对/回滚），
 *  与 fbc0a44 修的相对路径过掩是同一族错，只是方向相反。
 *
 *  复跑：TERM=dumb node --import tsx outputs/redact-overmask-2026-09-24/measure-naked-hex.mts
 */
import { redactSecrets } from "../../src/agent/security/scan.ts";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 目录里有空格 ⇒ 必须走 fileURLToPath（`new URL(...).pathname` 会留下 %20，整支探针当场找不到料）
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HEX = /\b[0-9a-f]{32,}\b/gi;

/** 上下文分类：就近看同一行里有没有"校验和"或"凭据"的语汇。 */
export function classify(line: string, token: string): "checksum" | "assignment" | "naked" {
  const before = line.slice(Math.max(0, line.indexOf(token) - 40), line.indexOf(token) + token.length + 8).toLowerCase();
  if (/(integrity|sha\d+|md5|sha1|sha256|sha512|blob|commit|tree|parent|author|hash|index)\s*[:=_-]?/.test(before)) return "checksum";
  if (/(api[_-]?key|secret|token|password|passwd|access[_-]?key)\s*[:=]/.test(before)) return "assignment";
  return "naked";
}

function toolOutputs(): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(d, n);
      let isDir = false;
      try {
        isDir = readdirSync(p).length >= 0;
      } catch {
        isDir = false;
      }
      if (isDir) walk(p);
      else if (n.endsWith(".jsonl")) {
        for (const line of readFileSync(p, "utf8").split("\n")) {
          if (!line.trim()) continue;
          let e: Record<string, unknown>;
          try {
            e = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (e["type"] === "tool_result") out.push(String(e["output"] ?? ""));
        }
      }
    }
  };
  for (const d of readdirSync(join(ROOT, "outputs"))) {
    if (d.startsWith("ga-strategy")) walk(join(ROOT, "outputs", d));
  }
  walk(join(ROOT, "fixtures", "no-progress"));
  walk(join(ROOT, "fixtures", "mock"));
  return out;
}

/** agent 真会看到的 git 输出（校验和那一类的真实来源）：不靠想象造负控。 */
function gitShapes(): string[] {
  const run = (args: string[]): string => {
    try {
      return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 8 << 20 });
    } catch {
      return "";
    }
  };
  return [
    run(["log", "--format=commit %H%ntree %T%nparent %P", "-n", "40"]),
    run(["rev-list", "--objects", "--max-count", "400", "HEAD"]),
    run(["show", "--format=commit %H", "--no-patch", "HEAD"]),
    run(["ls-tree", "-r", "--format=%(objectname) %(objecttype) %(path)", "HEAD"]).slice(0, 4000),
  ].join("\n").split("\n");
}

const rows = new Map<string, { total: number; caught: number }>();
const examples: Record<string, string[]> = {};
let lockfileLines = 0;

function feed(lines: string[], source: string): void {
  for (const line of lines) {
    for (const t of line.match(HEX) ?? []) {
      const kind = classify(line, t);
      const key = source + " · " + kind;
      const rec = rows.get(key) ?? { total: 0, caught: 0 };
      rec.total++;
      if (redactSecrets(line).text !== line) rec.caught++;
      rows.set(key, rec);
      examples[key] = [...(examples[key] ?? []), line.trim().slice(0, 72)].slice(0, 2);
    }
  }
}

feed(toolOutputs(), "真轨迹输出");
feed(gitShapes(), "git 输出");
// lockfile：校验和最密集的地方（存在就读，缺了要明说，不许静默少一支）
for (const f of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]) {
  try {
    const text = readFileSync(join(ROOT, f), "utf8").split("\n");
    lockfileLines++;
    feed(text, "lockfile");
  } catch {
    console.log("ℹ️ 没有 " + f + "（这一支今天没料，不算 0）");
  }
}

console.log("分组（source · 上下文）→ 条数 / 其中被脱敏改动过：");
for (const [k, v] of [...rows.entries()].sort()) console.log("  " + k.padEnd(24) + " " + String(v.total) + " 条，被改 " + String(v.caught));
for (const [k, ex] of Object.entries(examples)) if (ex.length) console.log("    " + k + " 例：" + ex[0]);

const total = [...rows.values()].reduce((a, b) => a + b.total, 0);
if (total === 0) console.log("❌ 一条长 hex 都没扫到 ⇒ 取料面空，这张表不作数");
if (rows.size === 0 || total === 0 || lockfileLines === 0) process.exit(1);
process.exit(0);
