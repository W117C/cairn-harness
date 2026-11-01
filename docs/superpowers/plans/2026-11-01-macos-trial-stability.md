# macOS Trial Stability Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复当前工作树的桌面试用阻断，并生成无需 Developer ID/公证的受邀内测包。

**Architecture:** 复用现有 Electron 与 package/install-smoke 链。共享纯函数保持单源；机器检查递归检查获准的纯依赖。工作树内定点修改，保留其他批次。

**Tech Stack:** TypeScript、React、Electron、Vitest、macOS 原生工具；零新依赖。

**Spec:** `docs/superpowers/specs/2026-11-01-macos-trial-stability-design.md`

## Global Constraints

- 不做 Developer ID/公证，不关闭全局 Gatekeeper；原有 ad-hoc 封装保留。
- 不 reset/stash，不修改冻结判据，不放宽现有断言，不提交其他批次。
- 本轮工作树验证与 HEAD/外部真机验证分开记。

## Review Focus

- 获准的纯模块及其依赖后来引入 IO、时钟或可变态时仍须报错。
- 旧 build-info 兼容；新包的 commit 不被误读成已提交整个工作树。
- quarantine 操作仅作用于用户确认的 Cairn.app；安装文档随包提供。
- 窄窗主动收起检查器时，冒烟不能把隐藏终端当成仍可见。
- 本地重新打开与跨机器真实钥匙串行为不混为一谈。

### Task 1: 共享纯依赖检查

Files: `scripts/renderer-layer-check.ts`、`tests/renderer-layer-pure-deps.test.ts`。

- [x] 写临时仓行为用例，证明共享子流纯函数可以复用，传递依赖中的时钟、IO、可变态会被拒绝；先运行观察失败。
- [x] 只登记 `src/agent/subflow.ts`，对获准依赖递归运行原有纯度规则，循环依赖去重。
- [x] 跑新增用例、原分层用例、子流归因用例及 `pnpm renderer-layer-check`。

### Task 2: 设置与终端真实冒烟

Files: `apps/desktop/scripts/settings-process-smoke.cjs`、`apps/desktop/scripts/terminal-resize-smoke.cjs`。

- [x] 复现失败，核对设置控件当前可访问名称及检查器窄窗收起规则。
- [x] 修正控件定位与测试前置条件；保留缩窄/变矮/放大断言，额外验证窄窗自动收起及用户重新展开。
- [x] 同一构建上实际运行两支 Electron 冒烟，检查真实读数与截图。

### Task 3: 安装包、来源与无公证安装路径

Files: `apps/desktop/scripts/package.mjs`、`src/main/build-info.ts`、新增构建来源测试、`README.md`；恢复原图标及仍被引用的字体。

- [x] 在临时 Git 仓测试 clean、tracked dirty、untracked dirty、非 Git 的来源信息，先观察失败。
- [x] 最小化添加来源信息与向后兼容解析，恢复已有资源；用手工替换方式分发，避免新增自动更新系统。
- [x] README 与随包说明提供单应用 quarantine 处置、架构要求、数据/密钥边界和手工升级路径。
- [x] 定向测试通过后实际打包到新目录，校验包和归档校验和，再移出源码目录启动。

### Task 4: 综合验证与交付

- [x] 串行运行 core（`--maxWorkers=1`）及 desktop 全套、typecheck、docs、boundary、renderer-layer。
- [x] 独立审查本轮相对临时基线的补丁，修复重要问题。
- [x] 记录测试、包地址、未验证边界与真实模型验收条件；共享工作树改动不混合提交。
