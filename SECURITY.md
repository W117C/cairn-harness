# 安全策略 / Security Policy

## 支持范围

Cairn 目前是开发者预览版。安全修复只覆盖本仓库当前分支的最新代码；历史版本与第三方依赖按各自策略处理。

| 组件 | 路径 | 在支持范围内 |
|---|---|---|
| 事件溯源内核 | `src/` | ✅ |
| 工具、权限与沙箱 | `src/tools/`、`src/permissions/`、`src/main/sandbox.ts` | ✅ |
| provider 适配与路由 | `src/providers/`、`src/routing/` | ✅ |
| CLI 入口与安装脚本 | `src/cli.ts`、`bin/`、`scripts/install.sh` | ✅ |
| 桌面壳 | `apps/desktop/` | ✅ |
| 文档与 fixtures | `docs/`、`fixtures/` | ❌（测试/资料，不承诺安全修复） |

## 报告漏洞

**不要开公开 Issue，也不要在 PR 中描述漏洞细节。**

请使用 GitHub 的 **Security → Advisories → Report a vulnerability** 私密通道。如果该入口不可用，
请通过仓库所有者的公开联系方式私下联系。

报告请包含：

- 影响版本与提交（`git rev-parse HEAD`）；
- 受影响的组件与攻击前提；
- 最小复现步骤或 PoC（不要附真实密钥/用户数据）；
- 你期望的修复方向（可选）。

## 响应目标

| 阶段 | 目标 |
|---|---|
| 确认收到 | 3 个工作日内 |
| 初步评估 | 7 个工作日内 |
| 修复/缓解 | 按严重程度与影响面安排，修复后公开说明 |

## 已知边界

- 本项目是本地优先工具；默认 fail-closed，但用户显式 `--mode auto` / `full-access` 会放宽权限。
- 演示 provider 是预录剧本，不连接网络，也不应被视为真实模型输出。
- 第三方依赖漏洞请同时参考依赖包的公告。
