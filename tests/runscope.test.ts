// H3-P1 回归（BLOCKED D-2 立项的验收标准）：并发双 run（1 交互 + 1 unattended）下
// 审批路由与权限态互不串门。剧本两连写：交互 run 的两次写审批都必须落**自己的**门，
// 且在无人值守 run 完整跑完（含其 finally 清理）之后仍能继续执行——旧实现（模块级单例
// 后到覆写 + finally 置 null）下第二次写会「工具门未接线」假死或被 unattended 门抢走。
// 反向验证锚点：currentSession() 摘除 ALS 回退后本文件必须变红。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAgent } from "../src/main/agent-runner";
import { AskGate } from "../src/main/ask-gate";
import { replay } from "../src/events";
import type { AgentEvent } from "../src/events";

let ws = "";
let dir = "";
afterEach(async () => {
  delete process.env.M1C_AUTONOMY_SCRIPT;
  if (ws) await rm(ws, { recursive: true, force: true });
  if (dir) await rm(dir, { recursive: true, force: true });
});

const SCRIPT = [
  { type: "assistant_message", content: "开始写入" },
  { type: "tool_call", id: "w1", name: "write_file", args: { path: "out1.txt", content: "one" } },
  { type: "tool_call", id: "w2", name: "write_file", args: { path: "out2.txt", content: "two" } },
  { type: "assistant_message", content: "写完了" },
];

async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor 超时");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("RunScope：并发 run 隔离（D-2 验收）", () => {
  it("交互 run 的审批不被并发 unattended run 抢走/清场", async () => {
    dir = await mkdtemp(join(tmpdir(), "h3-runscope-"));
    ws = await mkdtemp(join(tmpdir(), "h3-ws-"));
    const scriptPath = join(dir, "script.jsonl");
    await writeFile(scriptPath, SCRIPT.map((e) => JSON.stringify(e)).join("\n"), "utf8");
    process.env.M1C_AUTONOMY_SCRIPT = scriptPath;

    const askIds: string[] = [];
    const gateI = new AskGate({
      notify: (req) => askIds.push(req.askId),
      timeoutMs: 8000,
    });

    // 交互 run I：第一次写 → ask 挂起（等人工批准）
    const logI = join(dir, "i.jsonl");
    const pI = runAgent({ workspace: ws, message: "i", mode: "default", logPath: logI, askGate: gateI });
    await waitFor(() => askIds.length >= 1);

    // unattended run U 与 I 重叠：同样的写请求应被 unattended 门**立即拒绝**且完整跑完
    const logU = join(dir, "u.jsonl");
    const eventsU: AgentEvent[] = await runAgent({
      workspace: ws,
      message: "u",
      mode: "default",
      logPath: logU,
      askGate: new AskGate({ unattended: true }),
      unattended: true,
    });
    const uDenied = eventsU.filter((e) => e.type === "tool_result" && !e.ok && e.output.includes("无人值守"));
    expect(uDenied.length).toBe(2); // 两次写都被 unattended fail-closed 拒绝

    // U 结束后，I 的门仍在等（没有被 U 的活动消耗/拒绝）
    expect(gateI.pendingCount).toBe(1);
    // U 的 finally 不清交互面：批准 I 的第一次写后，第二次写**仍然可达**（旧实现此处假死）
    gateI.decide(askIds[0]!, true, "user", "once");
    await waitFor(() => askIds.length >= 2);
    expect(gateI.pendingCount).toBe(1);
    gateI.decide(askIds[1]!, true, "user", "once");

    const eventsI = await pI;
    const iOk = eventsI.filter((e) => e.type === "tool_result" && e.ok);
    expect(iOk.length).toBe(2); // 两次写都获批执行
    expect(await readFile(join(ws, "out1.txt"), "utf8")).toBe("one");
    expect(await readFile(join(ws, "out2.txt"), "utf8")).toBe("two");
    void replay; // 事件日志已由 runAgent 返回值承载
  });
});
