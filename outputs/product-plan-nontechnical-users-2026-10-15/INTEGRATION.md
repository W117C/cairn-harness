# 在飞改动集成边界（第一批第 2 条）

日期：2026-10-15。基线分支 `fix/spec-summary-double-count`，基线 HEAD
`d7fe85563edeb2064ba2d88a2b03fe3f5ace5766`。读取时工作区 169 条 git 状态记录（含未跟踪目录）。

**本文件只做清点与边界约定，不代替提交。** 本会话没有提交、重置或暂存任何其他会话的改动；
下面的建议批次供提交时使用（需要各自的所有者确认）。

## 一、集成纪律

1. 他人会话的在飞改动**不代提交**：提交范围必须是当前任务自己写下的文件；混入他人改动等于
   替别人背书其未完成的验证。
2. 每个批次带自己的验证证据（测试清单 + 命令 + 时间），不引用历史 CI 结果。
3. 工作区绿 ≠ HEAD 绿 ≠ 安装包绿：三种证据分别记录（`pnpm gates` / `head-cert` / 打包冒烟）。
4. 本仓库当前没有 `.dsh/rules/`（AGENTS.md 引用了它）；本会话沿用根 AGENTS.md 规则，
   未补写规则文件——补写属于治理动作，需要单独确认。

## 二、在飞改动清点（按功能区）

| 区 | 文件（代表） | 性质 | 当前证据 |
|---|---|---|---|
| 桌面 UI 组件栈重写（ADR 0003） | `apps/desktop/src/renderer/**`（App/Sidebar/Composer/Stream/SettingsPanel…）、`styles.css`、`tokens.css`、`theme.ts`、`apps/desktop/preview/**`、`design/**`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` | 整壳重建：Radix 组件栈、三栏布局、窗格化 | 本会话实跑：桌面 22 文件 209 测试通过、desktop 类型检查通过、边界检查绿 |
| v5 窗格后端 | `browser-host.ts`、`terminal-host.ts`、`channels.ts`、`preload/index.ts`、`main/index.ts`、`ipc-protocol.ts`（v5 段）、`tests/terminal-host.test.ts`、`panes*.test.*` | 浏览器/终端/文件/变更窗格与独立窗口 | 同上；真机交互未验（无 GUI 会话证据） |
| 核心 web-fetch 加固 | `src/tools/web_fetch.ts`、`web-fetch-policy.ts`、`tests/web-fetch.test.ts` | 抓取策略/重定向处理 | 未在本会话重跑该组测试（在全量套件里） |
| 会话/事件面 | `src/main/session-handlers.ts`、`tests/loop-eval-*.test.ts` | 与并行评测隔离相关的改动 | 未在本次单独复核（在全量套件里） |
| CI / 文档 | `.github/workflows/verify.yml`、`scripts/ci/README.md`、`AGENTS.md`（删除 GraphFlow 托管块）、`outputs/d57-fix-ready-2026-10-05/apply.mjs` | 门禁与文档维护 | CI 无新提交，不覆盖工作区 |
| 运行期残留与非代码产物 | `.agent/**`、`.rivet/`、`agent-canon/`、`var/`、`outputs/**`（大量历史目录） | 数据/证据/草稿 | 提交前逐项判定；`outputs/` 为证据面、`var/`/`.rivet/` 疑为运行产物 |

## 三、本会话（v6 产品第一批）改动

新增（可独立成批）：

- `src/main/project-templates.ts`（模板建项 + 清单）、`src/main/project-preview.ts`（预览运行时）、
  `src/main/project-export.ts`（导出）、`src/main/provider-connection.ts`（连接自检）
- `tests/project-templates.test.ts`、`tests/project-preview.test.ts`、`tests/project-export.test.ts`、
  `tests/provider-connection.test.ts`
- `docs/adr/0004-desktop-first-nontechnical-audience.md`
- `outputs/product-plan-nontechnical-users-2026-10-15/**`（本方案、探针、证据）

叠加在他人在飞文件上的增量（**同一文件同时含 v5 与 v6 内容**，见下节风险）：

- `src/main/ipc-protocol.ts`（AgentApi v6 七通道 + 版本 5→6）、`src/main/model-discovery.ts`
  （失败结果补 `status` 字段）
- `apps/desktop/src/main/channels.ts`、`preload/index.ts`、`main/index.ts`（wired 七行 + 预览宿主 + 退出回收）
- `apps/desktop/src/renderer/App.tsx`（模板建项 → 自动预览 → 交付卡动作）、`Sidebar.tsx`（新建项目表单）、
  `ChangeSummaryCard.tsx`（动作行）、`PaneDock.tsx`（预览 URL 自动导航）、`SettingsPanel.tsx`
  （locale 缺陷修复、key 缺省修复、连接检查）、`styles.css`
- 对应判卷更新：`tests/ipc-protocol-version.test.ts`、`tests/settings.test.ts`、
  `apps/desktop/tests/{channels,protocol-version,settings-panel,render-structure}.test.*`

## 四、建议提交批次（按依赖顺序）

1. **core 产品服务**：第三节「新增」的四个模块 + 四个测试 + `model-discovery.ts` 的 `status` 字段。
   验证：`node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts <四文件>`。
2. **协议与桌面接线**：`ipc-protocol.ts` + `channels.ts` + `preload` + `main/index.ts` + 对应测试。
   ⚠️ 这三个文件同时含其他会话的 v5 内容——要么双方约定连同 v5 一起提交（推荐，避免 hunk 级拆错），
   要么由 v5 所有者先提交、本批 rebase 后追加。
3. **渲染层产品流**：`App.tsx`、`Sidebar.tsx`、`SettingsPanel.tsx`、`ChangeSummaryCard.tsx`、
   `PaneDock.tsx`、`styles.css` + 桌面测试。该批同样与 UI 组件栈重写同文件耦合，建议并入重写批。
4. **治理**：`docs/adr/0004-*.md`（本批）+ `docs/adr/0003-*.md`（UI 栈，属重写批）。
5. **他人遗留批**（各自所有者）：web-fetch 加固、会话面、CI/文档、运行期残留清理。

## 五、待确认项

- `.agent/providers.json`、`.agent/evolution.json` 是否为有意留存的运行数据（含本地 provider 配置）；
- `var/`、`.rivet/`、`agent-canon/` 是草稿还是运行产物，是否应进 `.gitignore`；
- `apps/desktop/preview/`（真实组件预览层）与 `apps/desktop/design/desktop-design-spec.md` 的提交归属。
- `AGENTS.md` 删除 GraphFlow 托管块是他人改动，本会话未复核其意图。
