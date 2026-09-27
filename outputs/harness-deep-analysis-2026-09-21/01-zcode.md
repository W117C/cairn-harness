# 01 · zai-org/ZCode 源码级深挖

> 抓取：`/tmp/dsh-deep/ZCode-main`（main，tip `872ad960`，2026-09-21）。Apache-2.0（含 NOTICE.md）；包 `zcode` v3.14.0（private monorepo）；Node 24.14.0 / pnpm 10.33.2 由 mise.toml 锁定。

## 0. 一句话结论

**ZCode 是「AI 编程工作台」而非单一 CLI**：Electron 桌面 + 浏览器工作台 + 终端 Agent CLI（`zcode`）三入口共享一套 client/server/rpc/provider 包，且用 `architecture-policy.yaml` 把「模块归属、公共入口点」做成了机器可校验的架构政策。

## A. 形态

- README（中文为主）：桌面应用、浏览器界面、终端 Agent 三形态；`apps/zcode-cli`（Agent CLI 与运行时，普通目录随仓克隆，非 submodule）；`pnpm bootstrap` 一键初始化（装依赖 + 桌面本地资源 + build:bootstrap）。
- workspace：apps/zcode-cli（**内嵌独立 pnpm workspace**：有自己的 packages/、turbo.json、skills-lock.json、tools/、dependencies/）+ packages/{client,desktop,formal-proof,model-option-map,provider,provider-node,rpc,server,services,shared,ui,web,zcode-cua,zcode-server-cli} + harness/remote + third-party + config + public。
- LOC：TS 3140 文件 642,155 行 + TSX 756 文件 201,180 行 + CSS 4,124 行（+1 个 Swift 文件）≈ 85 万行 TS。

## B. 架构政策即代码

`architecture-policy.yaml`：逐模块声明 id / roots / managed(legacy→managed 迁移状态) / requires（依赖白名单）/ publicEntrypoints / owner（如 session 模块 owner: conversation，唯一入口 `services/src/session/contract.ts`）。配套 knip.json（死代码门）与 DESIGN.md（面向 coding agent 的设计系统：强制 `text-ui-*` 字阶、禁用 Tailwind 默认字级、禁改 html fontSize）——**三个文件都是写给 AI 协作者看的架构约束**。

## C. 包职责与进程模型

- `packages/rpc`：跨进程 RPC 层（typecheck 顺序首位，被 provider/client/server 依赖）。
- `packages/provider` + `provider-node` + `model-option-map`：模型抽象与 Node 侧适配；`packages/catalog`〔未深入〕。
- `packages/server` + `services`（session 归 conversation owner）：后端服务与领域服务；`zcode-server-cli` 服务器形态。
- `packages/client` + `web` + `ui` + `desktop`：三形态前端共享 UI。
- `packages/zcode-cua`：**Computer Use 的 API 兼容占位包**——发布构建不含 CUA：runtime、broker RPC、Helper 安装/启动、PiP 会话客户端、原生插件加载器全部 fail-closed 报 unavailable（zcode-cua/README.md）——「能力缺位也要显式缺位」的隐私设计。
- `packages/formal-proof`：形态化证明相关〔仅目录证据，用途未深入〕。
- `harness/remote`：远端 harness 子工作区。

## D. 主循环与工具

- Agent 运行时在 `apps/zcode-cli`（skills-lock.json 表明技能体系；tools/、dependencies/ 独立管理）。〔本轮未逐行验证循环文件，未证〕
- 桌面/Web/CLI 三端经 rpc/server 会聚于同一 session 服务层（architecture-policy 中 session 的 owner/entrypoint 是唯一定义的公共入口）。

## E. 工程与发布

- oxlint + tsc -b 分包增量 typecheck（typecheck 脚本显式列出 9+ 包顺序）+ knip；release-it 发布流；mise.toml 锁工具链版本。
- 飞书 + Discord 双社群；中文第一语言（README.md 与 README.en.md 并列）。

## F. 亮点 / 风险 / 事实

亮点：1) 架构政策 YAML 化（owner/requires/publicEntrypoints 可校验），是六仓中最显式的「架构治理 DSL」；2) CUA 缺位也 fail-closed 的占位包设计；3) 内嵌子 workspace 组织 agent 运行时，边界清晰；4) 设计系统文档直接面向 AI 编辑者。
风险：1) 大量模块仍 managed: false（legacy），政策覆盖不完整；2) 代码与文档主语言中文，国际贡献门槛；3) provider/server/cli 三层叠加的调试面复杂。
事实：1) v3.14.0 private；2) Node 24.14.0 + pnpm 10.33.2（mise.toml）；3) 14 个 packages/ + 1 个 apps/；4) zcode-cua 是显式降级占位；5) session 唯一公共入口 contract.ts；6) oxlint/tsc -b/knip/release-it 工具链；7) TS 85 万行规模；8) harness/remote 子工作区。
