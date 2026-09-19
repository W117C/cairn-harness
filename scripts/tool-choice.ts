// W3b 的读数面：把一个会话目录里的 JSONL 全量投影成「工具/skill 选择」读数，打印 + 落生成物。
//
// 为什么单独一个脚本而不是塞进 `pnpm facts`：facts.ts 的账本记的是**门禁耗时**（宿主相关的观测值），
// 这里记的是**模型行为代理量**（与会话集合相关）。两者生命周期不同，混在一个文件里迟早要为谁的
// 环形上限打架。
//
// 三条纪律：① 只投影，不做决策、不进模型面（spec §5 W3b）；② 读不出来的会话**点名跳过并计数**，
// 不静默少算——少算出来的读数比没有读数更坏；③ 值只活在这个生成物里，文档写「见 pnpm tool-choice」。
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { replay, type AgentEvent } from "../src/events";
import { listSessions } from "../src/main/sessions";
import { formatToolChoice, projectToolChoice, type ToolChoiceReadings } from "../src/agent/tool-choice";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TOOL_CHOICE_PATH = "docs/facts/tool-choice.json";
/** 默认只看最近 50 个会话：全量扫会在大目录上跑很久，而"最近行为"才是这条读数要回答的。 */
export const DEFAULT_LIMIT = 50;

export interface ToolChoiceFacts {
  version: 1;
  generatedAt: string;
  host: string;
  sessionsRoot: string;
  limit: number;
  /** 读失败或被 limit 挡掉的会话数——读数不是全体时必须让人看见 */
  skipped: number;
  readings: ToolChoiceReadings;
}

function arg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** 一个会话文件 → 事件（读失败交调用方计数，不在这里编一个空数组冒充"这个会话没行为"）。 */
async function loadSession(root: string, id: string): Promise<AgentEvent[]> {
  return replay(join(root, id + ".jsonl"));
}

export async function collect(sessionsRoot: string, limit: number): Promise<{ facts: ToolChoiceFacts; warnings: string[] }> {
  const all = await listSessions(sessionsRoot);
  const picked = all.slice(0, limit);
  const warnings: string[] = [];
  const sessions: AgentEvent[][] = [];
  for (const s of picked) {
    try {
      sessions.push(await loadSession(sessionsRoot, s.id));
    } catch (err) {
      warnings.push("读失败：" + s.id + " — " + (err instanceof Error ? err.message : String(err)));
    }
  }
  return {
    facts: {
      version: 1,
      generatedAt: new Date().toISOString(),
      host: hostname(),
      sessionsRoot,
      limit,
      skipped: all.length - picked.length + warnings.length,
      readings: projectToolChoice(sessions),
    },
    warnings,
  };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const root = arg(argv, "--sessions");
  if (root === undefined) {
    console.error("用法：pnpm tool-choice --sessions <会话目录> [--limit N] [--out <path>] [--no-write]");
    console.error("     会话目录不给就不猜——猜错会把别的会话当成「本产品最近行为」。");
    return 2;
  }
  const limitRaw = Number(arg(argv, "--limit") ?? String(DEFAULT_LIMIT));
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 ? limitRaw : DEFAULT_LIMIT;
  const { facts, warnings } = await collect(resolve(root), limit);
  for (const w of warnings) console.warn("⚠️ " + w);
  console.log(formatToolChoice(facts.readings));
  console.log("  样本：最近 " + String(facts.readings.sessions) + " 个会话" +
    (facts.skipped > 0 ? "（另有 " + String(facts.skipped) + " 个未纳入：limit 截断或读失败）" : "（全体）"));
  if (!argv.includes("--no-write")) {
    const out = join(ROOT, arg(argv, "--out") ?? TOOL_CHOICE_PATH);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(facts, null, 2) + "\n");
    console.log("→ 已写 " + out);
  }
  return 0;
}

void main().then((code) => process.exit(code)).catch((err) => {
  console.error("[tool-choice] 投影失败（fail-visible，不产出半个账本）:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
