# M4 ponytail-audit（§16 纪律 5：从零自研最大的风险是给自己造抽象）

> 出具：M4b 收口轮（2026-09-12）。方法沿 M2g/M3c：对每个「对外声明但无消费路径」的抽象做 grep/引用扫描，
> 命中只有声明点 = 无第二消费者。**处置三选**：删 / 保留待后续用 / 记 BLOCKED。

## 一、M4a 新增面（automations / scheduler / 三事件 / 工具五件）

| 抽象 | 消费者 | 判定 |
|---|---|---|
| `src/main/automations.ts`（AutomationDefinition + 严格校验） | scheduler（读）+ agent 工具 automation_*（写）+ renderer 表单（schema 复用）+ tests A 段矩阵 | 消费充分，**保留** |
| `src/main/scheduler.ts`（tick + 准入管线 + journal） | main/index.ts 装配（app 生命周期）+ agent-runner（触发走 handleAgentRun 真实路径）+ schedule-check 全段 | 消费充分，**保留** |
| `automation_triggered/skipped/completed` 三事件 | journal 落账 + renderer 投影（时间线卡/徽标/过滤）+ schedule-check J 段 | 消费充分，**保留** |
| `SkipReason` 四态类型 | journal 落账 + UI hover 标签映射（SKIP_REASON_LABELS）+ 六态筛选 | 消费充分，**保留** |

## 二、M4b 新增面（license / updater / provider-keys / onboarding）

| 抽象 | 消费者 | 判定 |
|---|---|---|
| `src/main/license.ts`（verifyLicense/verifyLicenseFile/signLicense） | agent-runner handleLicenseStatus（设置/关于页 + 引导横幅）+ commercial-check A 段 + tests/license 七项矩阵 | ≥3 消费者，**保留** |
| `src/main/updater.ts`（checkUpdate/compareSemver/isSafeExternalUrl） | agent-runner handleUpdateCheck + 设置页「检查更新」+ commercial-check B 段 + tests/updater | 消费充分，**保留** |
| `src/main/provider-keys.ts`（safeStorage 后端） | main/index.ts 装配 + injectStoredProviderKey（启动解密注入 provider 配置——真实 BYOK 消费路径）+ 设置页状态面 + commercial-check C 段 | 消费充分，**保留** |
| `src/renderer/onboarding.tsx`（OnboardingWizard/OnboardingSteps/ONBOARDING_GROUPS） | main.tsx 挂载（首启 !onboarded 弹 + 重跑入口）+ commercial-check D1（七组覆盖）+ tests/onboarding | 消费充分，**保留** |
| `OnboardingSteps` 内层拆分（坑七十） | OnboardingWizard（Dialog 壳内渲染）+ tests/onboarding SSR 冒烟 + commercial-check | 双消费者，**保留** |
| `scripts/commercial-check.ts`（第 22 道门） | gates 清单 + package.json scripts | 验收面本体，**保留** |

## 三、观察项（记后续）

1. **`sessionUsage`（M3c）与 automations journal 水位**均为单写入方投影，跨轮运行后若出现第二个写入口需重审原子性——暂无迹象。
2. **license 公钥常量**：单消费者（verifyLicense 缺省参）；若 M4+ 引入 license 服务端/多产品，公钥应改配置注入——届时重审，现在保持常量（更难被换掉）。

## 四、结论

- M4 新增抽象 **10 项候选全部有真实消费路径**，0 删 0 备案。
- 判据面（schedule-check 67 + commercial-check 45 断言）全部可失败——反向验证 8 条（两轮各 4）红→绿实录在 PROGRESS M4a/M4b 段。
- M0–M4 五里程碑的四份 ponytail-audit（m2/m3/m4 + 各轮 PROGRESS）累计「造了没人用的抽象」：0 个（M2g 修正 userConfig 1 个当轮消费；其余轮次 0）。
