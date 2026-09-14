// 方案门工具（唯一有强制力的门）：模型提交计划 → plan_proposed 事件 →
// 权限层进入写禁（存在未批准 plan 时 write_file/run_shell 一律拒绝）→ 挂起等人批准。
// 规格 §5.3：goal + files[{path, action, summary}]，action ∈ create|edit|delete；approach/verify 可选。
import { approvePlan, markPlanProposed } from "../permissions";
import type { PlanFileChange, PlanProposal, PlanProposedEvent } from "../events";
import { ToolError, type Tool, type ToolResult } from "./base.js";

const ACTIONS = new Set(["create", "edit", "delete"]);

/** 校验并规整 plan 入参；违规一律 ToolError。 */
export function parsePlanProposal(args: Record<string, unknown>): PlanProposal {
  if (typeof args.goal !== "string" || args.goal.trim().length === 0) {
    throw new ToolError("propose_plan: goal 必须是非空字符串");
  }
  if (!Array.isArray(args.files) || args.files.length === 0) {
    throw new ToolError("propose_plan: files 必须是非空数组");
  }
  const files: PlanFileChange[] = args.files.map((f, i) => {
    if (typeof f !== "object" || f === null) {
      throw new ToolError(`propose_plan: files[${String(i)}] 必须是对象`);
    }
    const o = f as Record<string, unknown>;
    if (typeof o.path !== "string" || o.path.trim().length === 0) {
      throw new ToolError(`propose_plan: files[${String(i)}].path 必须是非空字符串`);
    }
    if (typeof o.action !== "string" || !ACTIONS.has(o.action)) {
      throw new ToolError(`propose_plan: files[${String(i)}].action 必须是 create|edit|delete`);
    }
    if (typeof o.summary !== "string" || o.summary.trim().length === 0) {
      throw new ToolError(`propose_plan: files[${String(i)}].summary 必须是非空字符串`);
    }
    return { path: o.path, action: o.action as PlanFileChange["action"], summary: o.summary };
  });
  const out: PlanProposal = { goal: args.goal, files };
  if (args.approach !== undefined) {
    if (typeof args.approach !== "string") throw new ToolError("propose_plan: approach 必须是字符串");
    out.approach = args.approach;
  }
  if (args.verify !== undefined) {
    if (typeof args.verify !== "object" || args.verify === null) {
      throw new ToolError("propose_plan: verify 必须是对象");
    }
    const v = args.verify as Record<string, unknown>;
    const verify: PlanProposal["verify"] = {};
    for (const key of ["lint", "test"] as const) {
      if (v[key] !== undefined) {
        if (!Array.isArray(v[key]) || v[key].some((c) => typeof c !== "string")) {
          throw new ToolError(`propose_plan: verify.${key} 必须是字符串数组`);
        }
        verify[key] = v[key] as string[];
      }
    }
    out.verify = verify;
  }
  return out;
}

export const propose_plan: Tool = {
  name: "propose_plan",
  async run(args, ctx): Promise<ToolResult> {
    const plan = parsePlanProposal(args);
    if (!ctx.emit || ctx.callId === undefined || !ctx.plan) {
      throw new ToolError("propose_plan: 无方案审批通道（fail-closed：需要 emit/callId/plan 门接线）");
    }
    // 顺序即正确性：先落写禁态与登记等待（批准可能在广播事件瞬间到达），再落事件，再挂起。
    // 批准晚于 mark 不会被打回未批准态；批准早于 mark 在此顺序下不可能发生。
    markPlanProposed(); // 权限层写禁自此生效，直到批准
    const waiting = ctx.plan.waitApproval(ctx.callId);
    const event: PlanProposedEvent = { type: "plan_proposed", callId: ctx.callId, plan };
    await ctx.emit(event);
    const decision = await waiting;
    if (decision !== "approved") {
      return { ok: false, output: "方案被拒绝：写禁保持（存在未批准 plan），请修订后重新 propose_plan" };
    }
    // P1（审查）：解锁在 run 链内落地——决议处理器不在本 run 异步链，plan 态已 run 级隔离，
    // 谁的 plan 谁解锁（挂起期间本 run 的 loop 停在本工具上，解锁窗口无并发写面）。
    approvePlan();
    return { ok: true, output: "方案已批准，写工具解锁" };
  },
};
