import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createEventLog,
  replay,
  type RoutingDecisionEvent,
} from "../src/events";

let dir: string;
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

/** 构造一条全字段 routing_decision（candidates 三项 + picked + 各 reason 之一）。 */
function fullDecision(overrides: Partial<RoutingDecisionEvent> = {}): RoutingDecisionEvent {
  return {
    type: "routing_decision",
    agent_id: "w1",
    stage: "implement",
    candidates: [
      { id: "glm-flash", tier: "cheap" },
      { id: "glm-standard", tier: "standard" },
      { id: "glm-strong", tier: "strong" },
    ],
    picked: "glm-flash",
    reason: "bandit",
    from: "cheap",
    ts: 1700000000000,
    ...overrides,
  };
}

describe("M5a routing_decision 事件", () => {
  it("roundtrip 无损：append → replay 逐字一致", async () => {
    dir = await mkdtemp(join(tmpdir(), "m5a-routing-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    const written = [
      fullDecision(),
      fullDecision({ agent_id: "w2", stage: "review", picked: "glm-strong", reason: "cascade-upgrade", from: "standard" }),
      fullDecision({ agent_id: undefined, stage: undefined, picked: "glm-standard", reason: "pinned" }),
    ];
    for (const e of written) await log.append(e);
    const events = await replay(logPath);
    expect(events).toHaveLength(3);
    expect(events).toEqual(written);
    expect(events.map((e) => e.type)).toEqual(["routing_decision", "routing_decision", "routing_decision"]);
  });

  it("事件里绝不出现 key / 凭据：字段面只含 model id（结构快照）", () => {
    const keys = new Set(["type", "agent_id", "stage", "candidates", "picked", "reason", "from", "ts"]);
    for (const k of Object.keys(fullDecision())) expect(keys.has(k)).toBe(true);
    for (const k of Object.keys(fullDecision({ picked: "x", from: "y" }))) expect(keys.has(k)).toBe(true);
  });

  it("未登记类型仍抛错（防 KNOWN_TYPES 误加导致的静默放行）", async () => {
    dir = await mkdtemp(join(tmpdir(), "m5a-routing-"));
    const log = createEventLog(join(dir, "events.jsonl"));
    await expect(log.append({ type: "routing_decision_typo", picked: "x", reason: "pinned", candidates: [] } as never))
      .rejects.toThrow(/未知事件类型/);
    await expect(log.append({ type: "routing-decison", candidates: [] } as never))
      .rejects.toThrow(/未知事件类型/);
  });

  it("旧日志重放无损：fixtures/agents/*.jsonl 全部重放逐字一致（零坏行）", async () => {
    const dirPath = join(__dirname, "..", "fixtures", "agents");
    const files = (await readdir(dirPath)).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const raw = await readFile(join(dirPath, f), "utf8");
      const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      // 逐字：每条重放事件反序列化后与原始行逐字节相等
      const events = await replay(join(dirPath, f));
      expect(events.length, `${f}: 事件条数`).toBe(lines.length);
      expect(events.map((e) => JSON.stringify(e)), `${f}: 逐字重放`).toEqual(lines);
    }
  });
});
