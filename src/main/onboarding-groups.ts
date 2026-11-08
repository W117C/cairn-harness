/**
 * §13 七组设置项 → 向导步号与入口说明（覆盖清单；缺组 = `tests/onboarding-groups.test.ts` 红）。
 *
 * 从 `src/renderer/onboarding.tsx`（已删，`69fbb0d`）抽出来的**纯数据**部分。
 * 原文件是 React 组件 + shadcn 渲染整份向导；本模块只承载"七组覆盖面"这一规范。
 *
 * ⚠️ 观察者换过，别再照旧文案去找门：旧 observer 是已删的 `scripts/commercial-check.ts`（D1 引导七组覆盖，
 * 已删于 `69fbb0d`，且 `scripts/gate-manifest.ts` 的 26 道里从来没有它）。今天守这条的是
 * `tests/onboarding-groups.test.ts`——它同时钉「形状与步号域」「消费者拿到的必须是副本」两半。
 *
 * 文案纪律（2026-11-01 第 896 页 · 业主「让布局说话」）：entry 只写**看不出来的那部分**
 * （何时发生、能做什么、默认状态），不许把 label 换个说法再念一遍；
 * 同时保留「每组必须有 entry」的既有裁决（引导页不许有空壳条目），所以是**改写**不是删除。
 *
 * 命名前缀 `Onboarding` 保留以维持历史注释的指向；这是规范的单一事实源，
 * 任何对组的增删改都须同步到这里、那条用例与 §13 文档。
 */

export interface OnboardingGroup {
  id: "provider" | "permission" | "ui" | "schedule" | "memory" | "telemetry" | "about";
  label: string;
  step: 1 | 2 | 3 | 4;
  entry: string;
}

export const ONBOARDING_GROUPS: readonly OnboardingGroup[] = [
  { id: "provider", label: "连接模型", step: 1, entry: "填入 API Key，或先用演示模式看流程" },
  { id: "permission", label: "确认权限与安全", step: 2, entry: "写文件、联网与审批的边界都在这里" },
  { id: "ui", label: "主题与布局", step: 2, entry: "深浅色与字号可随时换，布局在右栏调" },
  { id: "schedule", label: "定时任务", step: 3, entry: "到点会自动发起新的对话。" },
  { id: "memory", label: "记忆", step: 3, entry: "会话结束后自动沉淀项目约定。" },
  { id: "telemetry", label: "隐私与遥测", step: 3, entry: "默认关闭；当前版本没有上报通道" },
  { id: "about", label: "版本与更新", step: 4, entry: "许可证状态与运行诊断都在这里。" },
] as const;