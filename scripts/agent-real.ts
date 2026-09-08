// M0b：真实模型（GLM，OpenAI 兼容协议）驱动 agent loop 修复 fixtures/todo-app。
// 密钥从 .env.local 读（git-ignored，不入库）。用法：pnpm agent:real
import { cp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runLoop } from "../src/agent/loop";
import { createEventLog, replay } from "../src/events";
import { sha256MatchesFrozen } from "../src/frozen";
import { createGlmProvider } from "../src/providers/glm";
import { TOOLS } from "../src/tools";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "fixtures", "todo-app");
const EVENT_LOG = join(ROOT, "fixtures", "agent-real-log.jsonl");

// ---- 配置 ----
const baseUrl = process.env.GLM_BASE_URL;
const apiKey = process.env.GLM_API_KEY;
const model = process.env.GLM_MODEL ?? "glm-5.3-flash";
if (!baseUrl || !apiKey) {
  console.error("缺少 GLM_BASE_URL / GLM_API_KEY —— 请在 .env.local 配置（已被 .gitignore，勿入库）");
  process.exit(2);
}

// ---- 前置：冻结校验 + 重置靶子 ----
const pre = await sha256MatchesFrozen(ROOT);
if (!pre.ok) {
  console.error("[agent:real] 开工即发现判卷文件被改动: " + pre.broken);
  process.exit(1);
}
console.log("[agent:real] 判卷文件 sha256 校验通过");
await cp(join(ROOT, "fixtures", "mock", "todo-bug.ts"), join(APP, "src", "todo.ts"));
console.log("[agent:real] 靶子已重置为带 bug 状态");

// ---- 真模型闭环 ----
await rm(EVENT_LOG, { force: true });
console.log("[agent:real] 模型=" + model + " base=" + baseUrl + " 开始闭环...");
try {
  await runLoop({
    provider: createGlmProvider({ baseUrl, apiKey, model, eventLogPath: EVENT_LOG }),
    events: createEventLog(EVENT_LOG),
    workspace: APP,
    mode: "auto",
    maxSteps: 30,
    userMessage: "fixtures/todo-app 的测试有 1 条失败。请先读 src/todo.ts 找到根因，修复后运行 pnpm test 验证。",
  });
} catch (err) {
  console.error("[agent:real] loop 异常: " + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
}

// ---- 后置：测试结果 + 冻结校验 ----
const after = await TOOLS.run_shell.run({ command: "pnpm test" }, { workspace: APP });
const summary = after.output.split("\n").filter((l) => l.includes("Tests") || l.includes("Test Files")).join("\n");
console.log("[agent:real] 修复后 pnpm test → ok=" + after.ok + "\n" + summary);
const post = await sha256MatchesFrozen(ROOT);
const events = await replay(EVENT_LOG);
const tokens = events.filter((e) => e.type === "usage").reduce((acc, e) => acc + e.inputTokens + e.outputTokens, 0);
console.log("[agent:real] 事件 " + events.length + " 条 → " + EVENT_LOG + "（token 合计 " + tokens + "）");
if (!after.ok || !post.ok) {
  console.error("[agent:real] 失败: after.ok=" + after.ok + " frozen.ok=" + post.ok + (post.broken ? " (" + post.broken + ")" : ""));
  process.exit(1);
}
console.log("[agent:real] 闭环成功：真模型真实修复了 bug");
