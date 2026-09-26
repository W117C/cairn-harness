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
  { id: "provider", label: "Provider 管理（BYOK key · 单价表）", step: 1, entry: "下方输入并保存 key 到钥匙串；单价在设置页 Provider 组查看" },
  { id: "permission", label: "权限档位（沙箱状态 · 产出代码安全模式）", step: 2, entry: "确认档位 / 沙箱 / 安全模式" },
  { id: "ui", label: "UI（主题 · 面板布局）", step: 2, entry: "选择主题；布局在右栏切换器随时调整" },
  { id: "schedule", label: "定时任务", step: 3, entry: "确认定时会话并发上限；任务管理在右栏 schedule 面板" },
  { id: "memory", label: "记忆管理", step: 3, entry: "确认会话结束自动沉淀开关；面板在右栏「记忆」" },
  { id: "telemetry", label: "遥测开关（默认关）", step: 3, entry: "确认遥测保持关闭（V1 无上报通道 = 零数据出门）" },
  { id: "about", label: "关于 / 更新（版本 · license · 检查更新）", step: 4, entry: "查看版本与 license 状态；更新源在设置页关于/更新组配置" },
] as const;