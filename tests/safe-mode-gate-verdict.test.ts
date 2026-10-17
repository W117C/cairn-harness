// M1e 安全模式那道 gate 的拒绝出口：**必须带 verdict**。
//
// 它跑在 `evaluate` 之前，是独立于权限判定的第二次审批，所以从前它的失败出口自己写了一句话
// （「安全模式 gate 未批准」），既区分不出三种结局、也不挂 gate.verdict。
// 后果不只是文案含糊：`lessons.ts` 的 `isAskDeniedResult` 只认 `gate.verdict` 与
// `blockedBy === "permission"`，没有 verdict 的失败会被归进 **executed** 那一族
// ⇒「这个工具在这个项目里用不了」这种错误结论（真因可能只是 60 秒内没人点那张卡）。
//
// 判据：三种结局各自的 verdict 都在，且都能被 isAskDeniedResult 认成「工具没有执行」。
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolResultWithAudit } from "../src/permissions";

const temporaryDirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** 最小装配：只要能让 `gatedTool` 跑起来（currentSession + autonomy），不起真会话。 */
async function setup(askGate: unknown) {
  vi.resetModules();
  const dir = await mkdtemp(join(tmpdir(), "safe-mode-gate-"));
  temporaryDirs.push(dir);
  await mkdir(join(dir, ".agent"), { recursive: true });
  vi.stubEnv("DSH_APPDATA", dir);
  const permissions = await import("../src/permissions");
  const { gatedTool, setToolGateDeps } = await import("../src/main/tool-gates");
  const autonomy = permissions.newAutonomySession("default", { planBlocked: () => false });
  setToolGateDeps({
    currentSession: () => ({ askGate, autonomy, sandbox: null }) as never,
  });
  const execute = vi.fn(async () => ({ ok: true, output: "executed" }));
  const writer = gatedTool("write_file", { name: "write_file", run: execute });
  return { dir, autonomy, execute, writer };
}

describe("M1e 安全模式 gate 的拒绝出口", () => {
  it("无人值守（没有门）⇒ fail-closed，且 verdict=unattended、被认成「没执行」", async () => {
    const s = await setup(null);
    vi.stubEnv("M1E_SAFE_MODE", "gate");
    const r = await s.writer.run({ path: "x.txt", content: "x" }, { workspace: s.dir } as never) as ToolResultWithAudit;
    expect(r.ok).toBe(false);
    expect(r.output).toContain("安全模式 gate 非交互");
    // 关键格：verdict 必须在，否则 lessons 会把它算进"执行了但失败"
    expect(r.gate).toMatchObject({ layer: "L3-mode", verdict: "unattended" });
    expect(s.execute).not.toHaveBeenCalled();
  });

  // 审批超时是这一族里最贵的一种：从前它和"用户明确拒绝"共用一句「未获批准」，
  // 于是模型把"等 60s 没人答"读成"这一档禁止写文件"，并把这个结论沉淀进项目记忆。
  it("审批超时 ⇒ verdict=timeout，文案说清是等待超时而不是档位禁止", async () => {
    const { AskGate } = await import("../src/main/ask-gate");
    const gate = new AskGate({ timeoutMs: 20, notify: () => {} }); // 无人应答 ⇒ 超时
    const s = await setup(gate);
    vi.stubEnv("M1E_SAFE_MODE", "gate");
    const r = await s.writer.run({ path: "x.txt", content: "x" }, { workspace: s.dir } as never) as ToolResultWithAudit;
    expect(r.ok).toBe(false);
    expect(r.gate).toMatchObject({ layer: "L3-mode", verdict: "timeout" });
    expect(r.output).toContain("审批等待超时");
    expect(r.output).toContain("该工具没有执行");
    // 不许出现那句会把超时读成"档位禁止"的旧文案
    expect(r.output).not.toContain("安全模式 gate 未批准");
    expect(s.execute).not.toHaveBeenCalled();
  });

  it("用户明确拒绝 ⇒ verdict=rejected，文案给的是换路径而不是「此档位不能用」", async () => {
    const { AskGate } = await import("../src/main/ask-gate");
    const gate = new AskGate({
      timeoutMs: 1000,
      notify: (req) => { gate.decide(req.askId, false, "user", "once"); },
    });
    const s = await setup(gate);
    vi.stubEnv("M1E_SAFE_MODE", "gate");
    const r = await s.writer.run({ path: "x.txt", content: "x" }, { workspace: s.dir } as never) as ToolResultWithAudit;
    expect(r.ok).toBe(false);
    expect(r.gate).toMatchObject({ layer: "L3-mode", verdict: "rejected" });
    expect(r.output).toContain("用户明确拒绝了这次审批");
    expect(s.execute).not.toHaveBeenCalled();
  });

  it("批准了才执行（这一格不许被上面的收紧带松）", async () => {
    const { AskGate } = await import("../src/main/ask-gate");
    const gate = new AskGate({
      timeoutMs: 1000,
      notify: (req) => { gate.decide(req.askId, true, "user", "once"); },
    });
    const s = await setup(gate);
    vi.stubEnv("M1E_SAFE_MODE", "gate");
    const r = await s.writer.run({ path: "x.txt", content: "x" }, { workspace: s.dir } as never) as ToolResultWithAudit;
    expect(r.ok).toBe(true);
    expect(r.gate).toMatchObject({ layer: "L3-mode", verdict: "approved" });
    expect(s.execute).toHaveBeenCalledTimes(1);
  });
});
