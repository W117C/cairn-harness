// 事件日志轨迹查看器：node --import tsx scripts/show-log.ts [log.jsonl]
import { replay } from "../src/events";
import { resolve } from "node:path";

const logPath = resolve(process.cwd(), process.argv[2] ?? "fixtures/agent-real-log.jsonl");
const events = await replay(logPath);
console.log("=== 事件轨迹（" + events.length + " 条）: " + logPath + " ===");
for (const e of events) {
  if (e.type === "user_message") console.log("USER   | " + e.content.slice(0, 90));
  else if (e.type === "assistant_message") console.log("ASSIST | " + e.content.replace(/\n/g, " ").slice(0, 110));
  else if (e.type === "tool_call") console.log("CALL   | " + e.name + " " + JSON.stringify(e.args).slice(0, 100));
  else if (e.type === "tool_result") console.log("RESULT | ok=" + e.ok + " " + e.output.replace(/\n/g, " ").slice(0, 100));
  else if (e.type === "usage") console.log("USAGE  | in=" + e.inputTokens + " out=" + e.outputTokens);
}
