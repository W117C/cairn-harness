// 定时任务五件的**模型面**（§12.2.5 的工具五件）。
//
// 为什么以前没有：`installAutomationTools()`（src/main/agent-runner.ts）装的是
// `table["automation_create"] = { name, run }`——**只带实现、不带规格**，
// 而 G-B 三面判卷的实例面解析器只认 `(TOOLS as …).x =` 那一形，所以这道门从头到尾没看过它们。
// 实测（2026-09-24，第 42 页）：`gateToolSpecs("auto")` 里五个名字一个都没有 ⇒ 模型看不见 = 发不出去。
//
// 两条纪律：
//  · 字段名的真值在 `src/main/automations.ts` 的校验器（跨层方向只能是 main→agent，所以这里不 import 它，
//    由 tests/automation-tool-surface.test.ts 做那份对账：规格不许发明字段）。
//  · 这五件**不进 core 面**（见 session-provider 的 CORE_SURFACE_TOOL_NAMES）：固定面每次请求都付字节，
//    而"排一次定时任务"不是每轮都用得上的能力；降配梯砍掉谁会说出去（MS5），比让它常驻便宜。
import type { GlmToolSpec } from "../providers/glm";

/** 模型可申报的字段（`createdAt/updatedAt/nextRunAt` 由调度器写；`id` 只在改/删/触发时由模型给）。 */
export const AUTOMATION_MODEL_FIELDS = [
  "name", "prompt", "schedule", "timeZone", "permissionTier", "model", "catchUp", "enabled",
] as const;
export type AutomationModelField = (typeof AUTOMATION_MODEL_FIELDS)[number];

/** 表单路（agent 走的这条，`validateAutomation(..., {form:true})`）接受的 kind。 */
export const AUTOMATION_SCHEDULE_KINDS = ["once", "interval", "daily", "weekly"] as const;

/** 每个工具读哪些字段 + 哪些必填（与实现里 validateAutomation 的调用同一形状）。 */
export const AUTOMATION_TOOLS = [
  { name: "automation_create", fields: [...AUTOMATION_MODEL_FIELDS], required: ["name", "prompt", "schedule"] },
  { name: "automation_update", fields: ["id", ...AUTOMATION_MODEL_FIELDS], required: ["id"] },
  { name: "automation_delete", fields: ["id"], required: ["id"] },
  { name: "automation_run_now", fields: ["id"], required: ["id"] },
  { name: "automation_list", fields: [], required: [] },
] as const;

export const AUTOMATION_TOOL_NAMES: readonly string[] = AUTOMATION_TOOLS.map((t) => t.name);

const SCHEDULE_DOC =
  "触发规则，kind 只接受 " + AUTOMATION_SCHEDULE_KINDS.join("/") + "；每个 kind 只带自己那一个附带字段：" +
  "once+at(ISO) / interval+everyMinutes(≥5) / daily+time(HH:mm) / weekly+weekdays(0-6)+time";

const FIELD_DOC: Record<string, { type: string; description: string }> = {
  id: { type: "string", description: "任务 id（ulid，create 的回执里有）" },
  name: { type: "string", description: "任务名（会作会话标题，禁路径分隔符与 ·）" },
  prompt: { type: "string", description: "触发时投给 agent 的任务书，非空 ≤4000 字符" },
  schedule: { type: "object", description: SCHEDULE_DOC },
  timeZone: { type: "string", description: "IANA 时区，缺省系统时区" },
  permissionTier: { type: "string", description: "那一跑的权限档：read-only / workspace-write / danger-full-access" },
  model: { type: "string", description: "指定模型，缺省全局默认" },
  catchUp: { type: "string", description: "错过触发点：latest 补最近一次 / skip 跳过" },
  enabled: { type: "boolean", description: "是否启用，缺省 true" },
};

// 无人值守那句只说一次（进 create，模型第一次遇到这件事的地方）；update 指回它。
// 同一段话在两个工具里各抄一遍 = 两处必漂，而且白付一份字节。
const UNATTENDED = "触发时是无人值守跑的：那一跑里所有审批自动拒绝（fail-closed），permissionTier 越高越可能什么也干不成。";

/** 交给 `gateToolSpecs` 拼接的五份规格（顺序即 AUTOMATION_TOOLS 的声明序）。 */
export function automationToolSpecs(): GlmToolSpec[] {
  return AUTOMATION_TOOLS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: automationDescription(t.name),
      parameters: {
        type: "object",
        properties: Object.fromEntries(t.fields.map((f) => [f, FIELD_DOC[f as AutomationModelField | "id"]])),
        required: [...t.required],
      },
    },
  }));
}

function automationDescription(name: string): string {
  switch (name) {
    case "automation_create":
      return "新建定时任务（周期或一次性）。" +
        "何时用：用户要求以后自动重复做某件事。" + UNATTENDED;
    case "automation_update":
      return "按 id 改一个定时任务（只改你申报的字段，其余保留；无人值守口径同 create）。" +
        "改前先 automation_list 拿准 id。";
    case "automation_delete":
      return "按 id 删除定时任务（不可撤销；只是暂时不想跑就用 update 的 enabled:false，别删）。";
    case "automation_run_now":
      return "按 id 立刻手动触发一次（走同一准入管线：去重/并发/重叠闸生效）。";
    default:
      return "列出全部定时任务（id、名称、规则、启用状态、下次触发时间）。";
  }
}
