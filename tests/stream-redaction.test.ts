// 落流脱敏的覆盖面闸：每个事件类型都要对「带不带外部文本」表过态。
//
// 起因（2026-09-22）：`scanStreamEvent` 的注释写着「密钥不进主转录 JSONL」，但实现只列了三型
// （assistant_message / tool_result / tool_call.args）。实测 13 个带正文的候选里只擦了 3 个，
// 漏的包括 `assistant_delta`（与最终消息同源——擦了成品留着分片等于没擦）、`verify_result.results`
// （测试输出最容易把 env 打印出来）、`agent_message.text`、`compaction.summary`（摘要是源事件之外
// 的**新副本**，源事件擦过不代表它擦过）。这与「同族出口各抄一份」同一根：政策在一条路上成立,
// 在旁边的路上静默失效，而且没有任何地方报错。
//
// 本文件判三件事：① 注册表每一型恰好落进一个桶（未表态即红）；② 声明要扫的每条路径真的擦得掉
// （含嵌套叶子）；③ 刻意不擦的边界（用户自己贴进来的文本）不许被"顺手"扫掉——那是毁任务不是保密。
import { describe, expect, it } from "vitest";
import {
  PROSE_FREE_TYPES,
  SCANNED_TEXT_PATHS,
  SCANNED_UPSTREAM_TYPES,
  scanStreamEvent,
  USER_AUTHORED_TEXT_TYPES,
} from "../src/agent/worker-projection";
import type { AgentEvent } from "../src/events";
import { knownTypes } from "./event-registry";

const S1 = "sk-AAAAAAAAAAAAAAAA1111";
const S2 = "ghp_BBBBBBBBBBBBBBBBBBBBBBBB";
const T = (s: string) => `前缀 ${s} 后缀`;

/** 每型一份贴合真实声明的样本，密钥种在表里声明的那条路径上。 */
const SAMPLES: Record<string, { event: Record<string, unknown>; secrets: string[] }> = {
  assistant_message: { event: { type: "assistant_message", callId: "c", content: T(S1) }, secrets: [S1] },
  assistant_delta: { event: { type: "assistant_delta", callId: "c", text: T(S1) }, secrets: [S1] },
  // 思考正文同正文一样是模型生成的文本：把 key / env 复述在"想"的过程里也得擦掉。
  thinking_delta: { event: { type: "thinking_delta", callId: "c", text: T(S1) }, secrets: [S1] },
  tool_call: { event: { type: "tool_call", id: "t1", name: "write_file", args: { path: "a.ts", contents: T(S1) } }, secrets: [S1] },
  tool_result: { event: { type: "tool_result", callId: "t1", ok: true, output: T(S1) }, secrets: [S1] },
  verify_result: {
    event: { type: "verify_result", callId: "v", ok: false, attempt: 1, maxAttempts: 2, results: [{ command: T(S1), ok: false, output: T(S2) }] },
    secrets: [S1, S2],
  },
  error: { event: { type: "error", message: T(S1) }, secrets: [S1] },
  agent_message: { event: { type: "agent_message", agent_id: "w", kind: "progress", text: T(S1) }, secrets: [S1] },
  agent_result: {
    event: { type: "agent_result", agent_id: "w", status: "done", summary: T(S1), artifacts: { report: T(S2) } },
    secrets: [S1, S2],
  },
  agent_spawned: {
    event: { type: "agent_spawned", agent_id: "w", parent_event_id: 1, mode: "read", task: T(S1), max_turns: 2, permission_mode: "default" },
    secrets: [S1],
  },
  approval_requested: { event: { type: "approval_requested", id: "a1", agent_id: "w", tool: "run_shell", args_digest: T(S1), risk: "high" }, secrets: [S1] },
  compaction: {
    event: { type: "compaction", trigger: "auto", reason: "threshold", compressed_event_ids: [1], summary: T(S1), summary_offset: 1, tokens_before: 9, tokens_after: 2 },
    secrets: [S1],
  },
  plan_proposed: {
    event: { type: "plan_proposed", callId: "p", plan: { goal: T(S1), files: [{ path: "a.ts", action: "edit", summary: T(S2) }] } },
    secrets: [S1, S2],
  },
  clarify_requested: {
    event: { type: "clarify_requested", callId: "q", questions: [{ question: T(S1), header: "h", options: [{ label: T(S2) }] }] },
    secrets: [S1, S2],
  },
  goal_stopped: { event: { type: "goal_stopped", reason: T(S1), turn: 3, evidence: "absent" }, secrets: [S1] },
  goal_paused: { event: { type: "goal_paused", reason: T(S1), turn: 2 }, secrets: [S1] },
  // 还原事件：字段是**路径**，但路径必须与 tool_call.args 里的同一个路径同样地扫——
  // 主会话落盘时 args.path 已过 redactSecrets，这条是主进程直接 append 的（不经 loop），
  // 不扫就两处文本可能不同 ⇒ 改动面按路径配不上，还原白落。
  file_restored: {
    event: { type: "file_restored", path: `src/${S1}.ts`, snapshotId: `.agent/snapshots/${S2}/src/a.ts` },
    secrets: [S1, S2],
  },
};

describe("注册表每一型都必须对正文表过态", () => {
  const declared = new Set<string>([
    ...Object.keys(SCANNED_TEXT_PATHS), ...SCANNED_UPSTREAM_TYPES, ...USER_AUTHORED_TEXT_TYPES, ...PROSE_FREE_TYPES,
  ]);

  it("没有未表态的类型（新增一型不列进任何桶 = 当场红）", () => {
    const undecided = knownTypes().filter((t) => !declared.has(t));
    expect(undecided, "这些类型还没决定要不要脱敏：" + undecided.join(", ")).toEqual([]);
  });

  it("四个桶互斥（一型同时「要扫」和「无正文」就是假表态）", () => {
    const all = [...Object.keys(SCANNED_TEXT_PATHS), ...SCANNED_UPSTREAM_TYPES, ...USER_AUTHORED_TEXT_TYPES, ...PROSE_FREE_TYPES];
    const seen = new Map<string, number>();
    for (const t of all) seen.set(t, (seen.get(t) ?? 0) + 1);
    expect(all.filter((t) => (seen.get(t) ?? 0) > 1)).toEqual([]);
    expect(all.length, "桶塌成空集").toBeGreaterThan(25);
  });

  it("表里没有注册表之外的类型名（改名会静默变成「不扫」）", () => {
    const registry = new Set(knownTypes());
    expect([...declared].filter((t) => !registry.has(t))).toEqual([]);
  });
});

describe("声明要扫的路径，逐条真擦得掉", () => {
  it.each(Object.entries(SCANNED_TEXT_PATHS))("%s 的声明路径种得进密钥、也擦得掉", (type, paths) => {
    const sample = SAMPLES[type];
    expect(sample, `${type} 在表里却没有样本：补一份真实形状的样本，别拿空表当覆盖`).toBeDefined();
    expect(paths!.length, `${type} 声明了空路径`).toBeGreaterThan(0);
    const out = JSON.stringify(scanStreamEvent(sample!.event as unknown as AgentEvent));
    for (const s of sample!.secrets) expect(out, `${type} 上的 ${s} 没被擦`).not.toContain(s);
  });

  it("注册表里每一型都有对应处理：扫的有样本、不扫的走原对象", () => {
    for (const t of USER_AUTHORED_TEXT_TYPES) {
      expect(SCANNED_TEXT_PATHS[t as AgentEvent["type"]], t + " 是用户自己的文本，不该进扫描表").toBeUndefined();
    }
    for (const t of PROSE_FREE_TYPES) {
      expect(SCANNED_TEXT_PATHS[t as AgentEvent["type"]], t + " 号称无正文，就不该有扫描路径").toBeUndefined();
    }
  });

  it("没有密钥时逐字不变（脱敏不许顺手改坏正文）", () => {
    const e = { type: "agent_result", agent_id: "w", status: "done", summary: "普通中文正文", artifacts: { report: "## 结论\n- ok" } } as unknown as AgentEvent;
    const out = scanStreamEvent(e) as Extract<AgentEvent, { type: "agent_result" }>;
    expect(out.summary).toBe("普通中文正文");
    expect(out.artifacts.report).toBe("## 结论\n- ok");
  });

  it("不改动传入的原对象（worker 内存态要留着原文给 provider 投影）", () => {
    const e = { type: "assistant_delta", callId: "c", text: T(S1) } as unknown as AgentEvent;
    const before = JSON.stringify(e);
    const out = scanStreamEvent(e);
    expect(JSON.stringify(e)).toBe(before);
    expect(JSON.stringify(out)).not.toContain(S1);
  });

  it("缺席字段不无中生有（可选正文没填时不该被写成空串）", () => {
    const e = { type: "agent_result", agent_id: "w", status: "done", summary: "只有 summary" } as unknown as AgentEvent;
    const out = scanStreamEvent(e) as unknown as Record<string, unknown>;
    expect("artifacts" in out).toBe(false);
  });
});
