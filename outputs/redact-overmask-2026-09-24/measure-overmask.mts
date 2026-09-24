/** 脱敏过掩的规模读数（任务 #4 的 before/after 尺，同一探针、同一口径）。
 *
 *  为什么先量再改：rule 59 只留下两条样本（`scratch=/var/folders/…` → `scra****`）。
 *  "过掩"到底发生在多少真输出上、掩掉的是哪一类东西，决定修法该往哪收——
 *  凭印象改会把一条安全面改松（本仓最忌：为了绿放宽判据）。
 *
 *  复跑：TERM=dumb node --import tsx outputs/redact-overmask-2026-09-24/measure-overmask.mts
 */
import { redactSecrets } from "../../src/agent/security/scan.ts";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const DIRS = [
  "fixtures/no-progress",
  "fixtures/mock",
  // 取料目录要**当场枚举**，写死日期会漂（09-23 那次语料在 09-20 的目录里，写死 = 读到 0 条还以为没缺陷）
  ...readdirSync("outputs", { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("ga-strategy"))
    .map((d) => join("outputs", d.name)),
];

function toolOutputs(): string[] {
  const outs: string[] = [];
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
          if (e["type"] === "tool_result") outs.push(String(e["output"] ?? ""));
        }
      }
    }
  };
  for (const d of DIRS) walk(d);
  return outs;
}

/** 被掩掉的 token 分类——只有分类才知道该不该放过。 */
export function tokenShape(t: string): "tmpdir" | "abs-path" | "uuid" | "key=value" | "other" {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return "uuid";
  if (/\/(var\/folders|private\/tmp|tmp)\//.test(t)) return "tmpdir";
  if (t.includes("=")) return "key=value";
  if (/(^|[^A-Za-z0-9])(\/[A-Za-z0-9._-]{2,}){3,}/.test(t)) return "abs-path";
  return "other";
}

const CAND = /[A-Za-z0-9+/=_-]{16,}/g;

export interface OvermaskReading {
  lines: number;
  changedOutputs: number;
  masked: number;
  byShape: Record<string, number>;
  examples: Record<string, string[]>;
}

/** 一次读数：逐条真输出跑 shipped 的 redactSecrets，再逐行找出"原来在、脱敏后不在"的候选 token。 */
export function measure(outputs: string[]): OvermaskReading {
  const byShape: Record<string, number> = {};
  const examples: Record<string, string[]> = {};
  let changedOutputs = 0;
  let masked = 0;
  for (const o of outputs) {
    if (redactSecrets(o).text === o) continue;
    changedOutputs++;
    for (const line of o.split("\n")) {
      const after = redactSecrets(line).text;
      if (after === line) continue;
      for (const t of line.match(CAND) ?? []) {
        if (!line.includes(t) || after.includes(t)) continue;
        masked++;
        const s = tokenShape(t);
        byShape[s] = (byShape[s] ?? 0) + 1;
        examples[s] = [...(examples[s] ?? []), t].slice(0, 4);
      }
    }
  }
  return { lines: outputs.length, changedOutputs, masked, byShape, examples };
}

/** 正负成对控制（rule 59：只有密钥样本的正控会全绿）——拿**当场生成**的真 tmpdir / uuid
 *  与一条真密钥形状各测一次，两类读数必须相反。 */
function controls(): { over: string[]; caught: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "dsh-redact-ctl-"));
  const uuid = randomUUID();
  const cases = [
    "scratch=" + dir,
    "created " + join(dir, "session.jsonl"),
    "id=" + uuid,
    "path=/tmp/" + uuid + "/x",
    // 相对路径才是这个 agent 输出里最高频的 token（HEAD 版把这几条都吃成 `outp****`）
    "read outputs/ga-strategy-2026-09-23/measure-overmask.mts ok",
    "opened fixtures/no-progress/session-2026-09-20T04-11-52.jsonl",
    "worktree .agents/worktrees/dsh-anchor-3f/src/main.ts dirty",
    "plan docs/superpowers/plans/2026-09-20-goal-plan-modes.md done",
  ];
  const secret = "OPENAI_API_KEY=sk-" + "Zm9vYmFy".repeat(3) + "1Q";
  // 混合大小写+数字的随机段（阈值之上，两版都该擦）；纯 hex 段在阈值之下，见页里的另记
  const embedded = "write src/config/xk39Fd8Qz2Lp7Vm4Rt6Bn ok";
  const over = cases.filter((c) => redactSecrets(c).text !== c);
  const caught = redactSecrets(secret).text === secret ? [] : ["sk-…"];
  // 第二条正控：路径里塞一段真高熵串，**必须仍被擦**。它混进 over 里是故意的——
  // 只测"放过路径"而不测这条，"一律放过含 / 的候选"也能骗过这个探针。
  if (redactSecrets(embedded).text === embedded) over.push("【漏掩】" + embedded);
  return { over, caught };
}
const ctl = controls();
const r = measure(toolOutputs());
console.log("真输出条数=" + String(r.lines) + "（取料目录：" + DIRS.join(" ") + "）");
console.log("被改写条数=" + String(r.changedOutputs) + " 被掩 token 数=" + String(r.masked));
if (r.masked === 0) console.log("ℹ️ 一条都没掩：要么没有过掩，要么取料面没有料——先看条数再看这条，别直接读成「已修好」");
for (const [k, v] of Object.entries(r.byShape)) {
  console.log("  " + k + " × " + String(v) + "  例：" + (r.examples[k] ?? []).slice(0, 2).map((x) => x.slice(0, 56)).join(" | "));
}
console.log("对照（8 条应当**放过**的形状）：" + String(ctl.over.length) + " 条被掩/漏掩");
for (const c of ctl.over) console.log("  过掩：" + c.slice(0, 64));
console.log("对照（真密钥形状，应当**掩掉**）：" + (ctl.caught.length ? "已掩 ✅" : "没掩 ❌（这条判据在说谎）"));
if (ctl.over.some((c) => c.startsWith("【漏掩】"))) console.log("❌ 路径里的真高熵串没被擦 ⇒ 否决放得太宽");
// 读数必须三条腿：语料规模、语料里的过掩、对照里的过掩。少一条都会把"没看着"读成"没问题"。
process.exit(r.lines < 50 || ctl.caught.length === 0 || ctl.over.length > 0 || ctl.over.some((c) => c.startsWith("【漏掩】")) ? 1 : 0);
