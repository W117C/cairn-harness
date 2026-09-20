// SoL-Pi 运行时集成行为测试（离线、确定性；无模型/无网络）。
// 覆盖：默认关闭恒等、B2 投影与全量发送契约、obs_recall 权限、B1 计量封存、D 经济恢复与报告落盘。
 import { mkdtempSync, readdirSync, realpathSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SolpiRuntime, privateSessionDirectory, removePrivateSessionData, solpiEnabled } from "../src/agent/solpi-runtime";
import { createObservationLedger, type AuthorizedRedactedText } from "../src/agent/ledger";
import type { AgentEvent } from "../src/events";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true }).catch(() => {});
});
const makeRoot = (): string => {
   const d = realpathSync(mkdtempSync(join(tmpdir(), "solpi-rt-")));
   dirs.push(d);
   return d;
};
const bigText = "x".repeat(20 * 1024); // > LEDGER_THRESHOLD_BYTES (10KB)

function eventsWithToolResult(): AgentEvent[] {
  return [
    { type: "user_message", content: "任务" },
    { type: "tool_call", id: "c1", name: "grep", args: { pattern: "x" } },
    { type: "tool_result", callId: "c1", ok: true, output: bigText },
  ];
}

describe("SolpiRuntime 默认关闭恒等", () => {
  it("全关时不建 ledger/meter，project 原样返回，报告 metering/economics 为 null", async () => {
    const root = makeRoot();
    const rt = new SolpiRuntime(root, {});
    expect(rt.ledger).toBeUndefined();
    expect(rt.meter).toBeUndefined();
    const replacements = await rt.project(eventsWithToolResult());
    expect(replacements.size).toBe(0);
    rt.sent([{ role: "tool", tool_call_id: "c1" }], eventsWithToolResult());
    expect(rt.recallTool(async () => true)).toBeUndefined();
    await rt.finish(eventsWithToolResult());
    const files = await readdir(root);
    const reportPath = files.find((f) => f.startsWith("run-"))!;
    const report = JSON.parse(await readFile(join(root, reportPath), "utf8")) as { metering: unknown; economics: unknown; realModelBenefits: string };
    expect(report.metering).toBeNull();
    expect(report.economics).toBeNull();
    expect(report.realModelBenefits).toBe("unverified");
  });
});

describe("SolpiRuntime B2 观测投影", () => {
  it("开启 observationPack：大输出归档，前 2 次发送全量，之后投影为存档回执；小输出不归档", async () => {
    const root = makeRoot();
    const rt = new SolpiRuntime(root, { observationPack: true });
    const events = eventsWithToolResult();
   // 第一次组装：sends=0 → 全量（归档在首次投影时已建立）
   let rep = await rt.project(events);
   expect(rep.size).toBe(1);
   expect(rep.get(3)).toBe(bigText);
   rt.sent([{ role: "tool", tool_call_id: "c1" }], events);
   // 第二次组装：sends=1 → 仍全量（FULL_SENDS=2）
   rep = await rt.project(events);
   expect(rep.get(3)).toBe(bigText);
   rt.sent([{ role: "tool", tool_call_id: "c1" }], events);
   // 第三次组装：sends=2 → 投影为存档回执（小于原文，含 obs_recall 指引）
   rep = await rt.project(events);
   const projected = rep.get(3)!;
   expect(projected.length).toBeLessThan(bigText.length);
   expect(projected).toContain("obs_recall");
   rt.sent([{ role: "tool", tool_call_id: "c1" }], events);
    // 归档产物在私有目录
    const entries = await readdir(root, { recursive: true });
    expect(entries.some((e) => String(e).includes("observations"))).toBe(true);
  });

  it("小输出不归档；obs_recall 授权拒绝时 fail-closed", async () => {
    const root = makeRoot();
    const rt = new SolpiRuntime(root, { observationPack: true });
    const events: AgentEvent[] = [
      { type: "tool_call", id: "c2", name: "grep", args: { pattern: "x" } },
      { type: "tool_result", callId: "c2", ok: true, output: "small" },
    ];
    const rep = await rt.project(events);
    expect(rep.size).toBe(0);
    const tool = rt.recallTool(async () => false)!;
    const r = await tool.run({ id: "obs_" + "a".repeat(24) }, { signal: undefined } as never);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("permission denied");
  });
});

describe("SolpiRuntime B1 计量", () => {
  it("requestMetering 开启：报告带 metering 且标记未证；关闭恒等不记录", async () => {
    const root = makeRoot();
    const rt = new SolpiRuntime(root, { requestMetering: true });
    const events = eventsWithToolResult();
    await rt.project(events);
    rt.sent([{ role: "tool", tool_call_id: "c1" }], events); // 完成 1 次
    await rt.finish(events);
    const files = await readdir(root);
    const report = JSON.parse(await readFile(join(root, files.find((f) => f.startsWith("run-"))!), "utf8")) as { metering: unknown; realModelBenefits: string };
    expect(report.metering).not.toBeNull();
    expect(report.realModelBenefits).toBe("unverified");
  });
});

describe("SolpiRuntime D 经济恢复", () => {
  it("economicCompaction：compaction 事件回放为债务，报告与 economic.json 一致", async () => {
    const root = makeRoot();
    const rt = new SolpiRuntime(root, { economicCompaction: true });
    const events: AgentEvent[] = [
      { type: "compaction" } as AgentEvent,
      { type: "compaction" } as AgentEvent,
    ];
    await rt.finish(events);
    const economic = JSON.parse(await readFile(join(root, "economic.json"), "utf8")) as Record<string, unknown>;
    expect(economic).toBeTruthy();
    const report = JSON.parse(await readFile(join(root, readdirSync(root).find((f) => f.startsWith("run-"))!), "utf8")) as { economics: unknown };
    expect(report.economics).toEqual(economic);
  });
});

describe("privateSessionDirectory 隔离", () => {
  it("拒绝把私有存储放进工作区；正常日志路径返回私有目录", async () => {
    const root = makeRoot();
    const logPath = join(root, "s.jsonl");
    await writeFile0(logPath, "{}\n");
    const ws = join(root, "ws");
   await mkdir(ws, { recursive: true });
   // workspace = root 本身：派生 session-data 必然落在其内 → 必须被拒绝
   await expect(privateSessionDirectory(logPath, root)).rejects.toThrow(/private session-data/);
   // workspace = 子目录 ws：派生目录在 ws 外 → 正常返回（返回值为 realpath）
   const dir1 = await privateSessionDirectory(logPath, ws);
   expect(dir1.startsWith(join(realpathSync(root), "session-data"))).toBe(true);
  });
});

import { writeFile } from "node:fs/promises";
function writeFile0(path: string, data: string): Promise<void> {
  return writeFile(path, data, "utf8");
}

describe("solpiEnabled 开关语义", () => {
  it("任一为 true 即启用；全 false/空关闭", () => {
    expect(solpiEnabled({})).toBe(false);
    expect(solpiEnabled({ requestMetering: false })).toBe(false);
    expect(solpiEnabled({ requestMetering: true })).toBe(true);
    expect(solpiEnabled({ evidenceReceipts: true })).toBe(true);
  });
});

it("private storage reopens the same session and supports a second session", async () => {
  const root = makeRoot();
  const first = join(root, "first.jsonl");
  const second = join(root, "second.jsonl");
  await writeFile(first, "{}\n");
  await writeFile(second, "{}\n");
  const directory = await privateSessionDirectory(first);
  expect(await privateSessionDirectory(first)).toBe(directory);
  expect(await privateSessionDirectory(second)).not.toBe(directory);
});

// 隐私删除路径此前零测：写入侧（SolpiRuntime 构造 ledger）与撤销侧（removePrivateSessionData
// 另起一个 ledger 去 revoke）各自写着同一个 sessionId 字面量——两处各写一份就是漂移的入口，
// 而现在没有任何一条用例能看出它们是不是同一个账本。构造已收成单一出处（createObservationLedger）。
it("removePrivateSessionData 撤销的是写入侧那个账本：删除前读得到、删除后目录与对象都没了", async () => {
  const root = makeRoot();
  const logPath = join(root, "s.jsonl");
  await writeFile(logPath, "{}\n");
  const directory = await privateSessionDirectory(logPath);
  const rt = new SolpiRuntime(directory, { observationPack: true });
  const captured = await rt.ledger!.capture({
    toolName: "grep",
    callId: "c1",
    source: { kind: "authorized-redacted-text", text: bigText } as AuthorizedRedactedText,
  });
  expect(captured.archived).toBe(true);
  const id = captured.id ?? "";
  expect(id).not.toBe("");
  // 独立构造（同目录、同工厂）⇒ 删除前读得到全文：证明两侧指向同一个 ledger-<sessionId>
  const before = await createObservationLedger(directory).recall({ id });
  expect(before.text.length).toBeGreaterThan(0);
  await removePrivateSessionData(logPath);
  await expect(readdir(directory)).rejects.toThrow(/ENOENT/);
  // 删除后同一入口重新打开：句柄失效（清单与对象都不在），不是"读到旧内容"
  await expect(createObservationLedger(directory).recall({ id })).rejects.toThrow();
});
