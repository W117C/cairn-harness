# 桌面设计继续检查 · 第三轮

2026-11-06；工作树 `/Users/ze/Downloads/Cairn/cairn`，分支 `fix/spec-summary-double-count`，HEAD `fc6e3638`。本轮改动未提交，保留共享工作区前序改动。

## 修复结果

| 问题 | 修改后的行为 | 实测证据 |
| --- | --- | --- |
| 全局自定义指令未保存时，Esc／返回直接关闭并丢失草稿 | 关闭前确认；可继续编辑并恢复输入焦点，或明确放弃修改；切换设置分区仍保留草稿 | 真实键盘、点击和输入复现；确认卡及焦点检查通过 |
| 自定义指令保存尚未完成时仍可关闭设置 | 保存期间保持设置面板在场，并显示等待提示；完成后可正常关闭 | 延迟写入夹具验证；普通数字设置的 Esc／返回失焦保存仍通过 |
| “保持电脑唤醒”读取失败被显示为“关” | 读取中显示状态，失败显示原因和就地重试，成功后才显示实际开关值 | 注入一次读取失败，再恢复读取并点击重试 |
| 唤醒设置保存失败静默回滚，保存中还能继续切换 | 显示失败原因并回滚；保存中锁定开关；成功后按返回的持久化结果回显 | 注入写入失败和延迟写入，随后恢复并重新保存 |

复用既有 `ConfirmDialog`、`Switch` 和错误样式，无新增依赖。没有修改 IPC、权限规则、Provider 或主进程保存逻辑。

“已有定时任务时唤醒设置消失”的初步猜测被代码和修复前实测否定：原来就有该设置。本轮保留并加入回归检查，不计作修复。

## 验证

先用新增 Electron smoke 在修复前构建复现草稿关闭、保存期间关闭、读取假状态、缺少重试和保存失败反馈等问题，保留[修复前读数](before/checks.json)及[日志](before.log)。修复后在独立构建重新运行，18 项全部通过。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 新增表单恢复 Electron smoke | 18/18 | [读数](after/checks.json)、[日志](form-recovery.log) |
| 原有设置 Esc／返回提交 Electron smoke | 7/7 | [读数](settings-esc-checks.json) |
| 应用壳及管理页 Electron smoke | 51/51 | [读数](shell-checks.json) |
| 880px 深色设置分区 sweep | 13/13 | [读数](settings-dark-checks.json) |
| 桌面 Vitest，`--maxWorkers=2` | 331 文件，2,280 项通过 | [日志](desktop-tests.log) |
| TypeScript、renderer layering、desktop boundary | 通过 | 当前工作树检查输出 |
| 隔离 Vite 构建 | 通过 | [日志](build.log) |
| 本轮两个组件的设计 detector | 无发现 | [读数](detector.json) |
| 三个 smoke／fixture 脚本语法、本轮 tracked diff 空白检查 | 通过 | `node --check`、限定路径的 `git diff --check` |

Electron 合计 89 项检查，使用真实 renderer、合成 AgentApi、临时用户配置。未调用真实 Provider，未写入用户实际设置。已检查最终确认卡、读取错误提示截图，以及深色窄窗无横向溢出。

首次补跑时误用了不存在的 `desktop-renderer-layer-check` 命令；随后按项目脚本名 `renderer-layer-check` 运行通过，`desktop-boundary-check` 亦通过。没有把未执行命令计作成功。

本代理通过 OCR delegate 选择文件、读取规则并完成本轮变更审查，未运行 `ocr review` 或 `ocr scan`。审查后移除新增嵌套三元表达式，再完成上述最终构建与回归。见[规则](review-rules.md)和[补充脚本规则](review-esc-rule.md)。

## 截图

- [未保存指令关闭确认](after/01-instructions-discard.png)
- 读取失败：[修改前显示“关”](before/02-wake-read-error.png)／[修改后显示错误与重试](after/02-wake-read-error.png)
- [已有任务、880px 深色窗口](after/03-wake-with-tasks-dark-880.png)

本轮实现仅涉及 `SettingsPanel.tsx` 的关闭保护、`AutomationPane.tsx` 的 `AutomationWakeRow`，以及隔离测试夹具与 smoke：新增 `form-recovery-smoke.cjs`、扩展 `ui-gallery-preload.cjs`、为 `settings-esc-commit-smoke.cjs` 增加隔离构建入口。文件内其他前序变更不计作本轮新增。

未提交、未打包或发布；未运行完整核心 gates、HEAD 认证或 mutation。结果证明当前工作树上述界面行为，不代表已发布应用或真实服务验证。
