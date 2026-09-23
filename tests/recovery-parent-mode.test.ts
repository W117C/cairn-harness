// 崩溃恢复「重派」时，父会话档位从哪儿来（能力 7：最小权限、可审计）。
//
// 病灶：`ensureSessionOrchestrator()`（agent-runner.ts:258）把 `parentMode` 取自
// `(await store().get()).mode` —— 而设置盘那个键的**名字就是「新对话开始时使用的权限档」**
// （渲染层 app.js:4176 原话：此前 settings.mode 只被用来点亮设置页那一格）。
// 于是：一条 read-only 会话崩溃后重启，只要用户的全局默认档是 auto，重派出来的 worker
// 就拿 auto 当父档 ⇒ `clampTier(请求档, 父档)` 与「read-only 父不得派 write worker」这两道闸
// 一起被换松一档（orchestrator.ts:513-516）。方向是**单向变宽**，所以它属于权限问题，不是读数问题。
//
// 为什么这条判据挂在事件流上：档位**早就有持久记录**——每次权限判定都留 `tool_result.gate`，
// 其中 `mode` 在 evaluate 一侧必带（构造口 `gateBase` 要求入参，另有用例钉着）。
// 所以修法不是新增字段，是把已经落盘的那份事实读回来。
//
// 反向一侧为什么只钉到纯函数：非只读那一支要真派 worker ⇒ 要模型 ⇒ 花真钱；
// 本文件最后一格能便宜地跑，正是因为 read-only 的拒绝发生在任何模型调用**之前**。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { recoveryParentMode } from "../src/agent/recovery";
import type { AgentEvent } from "../src/events";
import { handleAgentRun, handleCardAction, initSettingsStore } from "../src/main/agent-runner";
import { replay } from "../src/events";

const dirs: string[] = [];
afterAll(async () => {
  delete process.env.M3A_MAIN_SCRIPT;
  for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

const gateResult = (mode: string | undefined, agentId?: string): AgentEvent =>
  ({
    type: "tool_result", callId: "c", ok: false, output: "denied",
    ...(agentId ? { agent_id: agentId } : {}),
    gate: { layer: "L2-risk", verdict: "denied", ...(mode === undefined ? {} : { mode }) },
  }) as unknown as AgentEvent;
const spawned = (permissionMode: string): AgentEvent =>
  ({
    type: "agent_spawned", agent_id: "a1", parent_event_id: 1, mode: "read", task: "t",
    max_turns: 8, permission_mode: permissionMode,
  }) as unknown as AgentEvent;

describe("recoveryParentMode：只采信这条会话历史上真用过的档位", () => {
  it("主会话判过一次 read-only 的门 ⇒ 采信它，不是设置盘的 auto", () => {
    expect(recoveryParentMode([gateResult("read-only")], "auto")).toBe("read-only");
  });

  it("中途改过档 ⇒ 取最后一条留痕", () => {
    expect(recoveryParentMode([gateResult("read-only"), gateResult("default")], "auto")).toBe("default");
  });

  // worker 子流的 tool_result 也落在同一条主流 JSONL 上（M3a），但它带 agent_id。
  // 把它当父档 = 拿一个**被裁过**的子档去当父档上限，两向都可能错（§11.7.6 单调继承）。
  it("worker 子流的留痕不算父档位（agent_id 在场即排除）", () => {
    expect(recoveryParentMode([gateResult("read-only"), gateResult("auto", "a1")], "auto")).toBe("read-only");
    expect(recoveryParentMode([gateResult("auto", "a1")], "default")).toBe("default");
  });

  it("gate 里 mode 缺席（档位机之外的判定，宁缺不编）⇒ 不许当成任何一档", () => {
    expect(recoveryParentMode([gateResult(undefined), gateResult("read-only")], "auto")).toBe("read-only");
    expect(recoveryParentMode([gateResult(undefined)], "auto")).toBe("auto");
  });

  it("没有任何门留痕 ⇒ 退到最近一次 spawn 记的 worker 有效档（它 ≤ 父，宁可更严）", () => {
    expect(recoveryParentMode([spawned("read-only")], "auto")).toBe("read-only");
  });

  it("两条来源都没有 ⇒ 才用设置盘那个值（并如实是兜底）", () => {
    expect(recoveryParentMode([], "auto")).toBe("auto");
    expect(recoveryParentMode([{ type: "user_message", content: "hi" } as AgentEvent], "default")).toBe("default");
  });
});

describe("生产入口那一腿：重派 write worker 时被这条会话的档位拦住", () => {
  it(
    "会话历史是 read-only + 设置盘默认 auto ⇒ 重派 write worker 必须被拒（拒因点名 read-only）",
    { timeout: 180_000 },
    async () => {
      const home = await mkdtemp(join(tmpdir(), "rec-mode-home-"));
      const ws = await mkdtemp(join(tmpdir(), "rec-mode-ws-"));
      dirs.push(home, ws);
      initSettingsStore(join(home, "settings.json"));
      // 干扰值：全局默认档是 auto —— 旧实现读的就是它。
      await writeFile(join(home, "settings.json"), JSON.stringify({ mode: "auto" }), "utf8");
      const script = join(home, "main.jsonl");
      await writeFile(
        script,
        [
          { type: "tool_call", id: "w1", name: "write_file", args: { path: "src/a.ts", content: "x" } },
          { type: "assistant_message", content: "试着改了一下。" },
        ].map((o) => JSON.stringify(o)).join("\n") + "\n",
        "utf8",
      );
      process.env.M3A_MAIN_SCRIPT = script;
      const logPath = join(home, "events.jsonl");
      // 这一条会话当时用的是 read-only 档（unattended ⇒ 不设交互 askGate；read-only 档下写盘被门**直接拒**，
      // 于是那次判定把 mode 留在 `tool_result.gate` 上——这正是恢复时要读回来的那份事实）。
      const run = await handleAgentRun(
        { message: "改一版", mode: "read-only" },
        { workspace: ws, logPath, unattended: true, onEvent: () => {} },
      );
      expect(run.ok, JSON.stringify(run)).toBe(true);
      // 前置自检：留痕真落盘了（少了它，下面的"被拒"可以是"根本没读到东西"）。
      const log = await replay(logPath);
      expect(
        log.some((e) => e.type === "tool_result" && (e as { gate?: { mode?: string } }).gate?.mode === "read-only"),
        "read-only 档的那次判定没落 gate 留痕 ⇒ 这一格测的不是恢复路径读的那份来源",
      ).toBe(true);

      const res = await handleCardAction({
        cardId: "recovery-card-1", sourceEventId: 1,
        action: "respawn", cardType: "agent_result",
        payload: { respawn: { mode: "write", task: "把那个 bug 修了" } },
      });
      expect(res.ok, "重派竟然被放行了 ⇒ 父档位读的不是这条会话的留痕").toBe(false);
      expect(res.error, "拒因没点名 read-only ⇒ 拦它的不是这条闸（可能是别的错误，读数不可信）").toContain("read-only");
    },
  );
});
