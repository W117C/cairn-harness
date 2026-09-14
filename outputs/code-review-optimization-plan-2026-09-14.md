# Agent 应用全面代码检查与优化计划（2026-09-14）

> 范围：当前工作树（含大量未提交改动与 M5 新代码）；`/oh-src` 为外来参考目录，不计入产品代码规模。方法：逐模块静态审查 + 隔离副本全量门禁 + 无害运行时探针。审查期间未修改产品源码、验收脚本或冻结判卷文件。

## 1. 审查结论

- **总体质量中高**：事件流单一事实源、权限四层管线、工具路径 realpath 校验、进程组回收、沙箱降级 fail-visible、断言体检与门禁清单护栏都有实质实现，不只是注释。
- **仍可发布前优化**：M5 相关改动（当前未提交）已引入**一条真实测试失败**；动态导入重模块存在可复现的测试悬挂；主会话生产 Provider 上下文口径与工具循环不一致，属于影响真实使用的架构缺口。
- **安全面未复现新的高置信 P0**：只读 shell 的分隔符、`rg --pre` 空格形态、密钥同行重复项均有防护；`shell_ro` 仍应视为字符串过滤的过渡方案，不建议继续无限补规则。

## 2. 动态验证基线

| 项目 | 实测结果 | 说明 |
|---|---|---|
| `pnpm typecheck` | 通过 | 真实工作树 |
| `pnpm test` | **失败：59 files / 530 passed / 1 failed** | 失败用例：`tests/provider-keys.test.ts:120` 的 `injectStoredProviderKey` 动态导入测试；探针确认卡在 `await import("../src/main/agent-runner")`，约 20s 后触发 5s 超时 |
| 隔离副本 `pnpm gates`（干净环境） | **25 绿 / 1 红 / 9 未证，exit 1** | 红门 `map-check`：隔离副本自嵌套 `.tmp/audit-*` 导致自检副本缺文件；真实工作树单独重跑 `scripts/map-check.ts` **全部通过**，判为审查环境假红，不是产品缺陷 |
| 无害安全探针 | 已验证 | 合法只读命令放行；`;`、换行、`&`、`rg --pre`、`--flag=value`、`bash -c 'git push'`、`env ... git push`、绝对路径 git 均拦截；`redactSecrets` 同行重复密钥已脱敏 |
| 冻结判卷文件 | `FROZEN_MISMATCH=0` | 工作树核对一致 |
| 未证项 | 9 项 | 主要是联网/凭据类暗卷；按项目纪律“未证 ≠ 通过” |

## 3. 已排除 / 既定取舍（不作为新 bug）

- `webPreferences.sandbox:false` 已备案，仍保留 `contextIsolation:true` 与 `nodeIntegration:false`。
- 沙箱不可用时走分支 B 降级断言，并已 fail-visible；本机真实 `ipc:check`、`sandbox:check`、`panels-check` 均通过。
- 打包为 unsigned V1、无签名公证，属于 M4 边界。
- 9 项联网/凭据未证不能宣传成“全部通过”，但当前不是代码缺陷。
- `oh-src/` 是只读对标参考，不参与构建；其扫描噪声不应继续计入产品发现。

## 4. 问题与优化计划

优先级定义：P0 = 发布前必须修的安全/可信基线；P1 = 明显功能/性能/可维护性问题，建议本迭代；P2 = 结构和技术债；P3 = 可选改进。

### P0 发布前基线

| # | 问题 | 证据 | 优化建议 | 验收标准 |
|---|---|---|---|---|
| P0-1 | **当前未提交 M5 代码使完整测试套红** | `pnpm test` 实测 `1 failed / 530 passed`；失败为 `tests/provider-keys.test.ts:120`，5s 超时 | 先修红测试再合入 M5；把“逐文件隔离线程池”下的导入耗时纳入测试预算或拆轻导入面 | `pnpm test` 60 文件左右全绿；同类动态导入用例显式覆盖；`pnpm gates` 不依赖人工解释 |
| P0-2 | **动态导入 `agent-runner` 可复现悬挂，产品模块边界过重** | 临时探针输出停在 `before import`；单文件复跑也 20s 后超时；`tests/provider-keys.test.ts:121-122` 注释已承认“导入面大” | 将 `injectStoredProviderKey` 等轻量启动逻辑移出 `agent-runner.ts` 到独立小模块；测试只导入小模块；逐步把 provider/session 初始化从巨型 runner 中拆出 | 相关测试稳定 <2s；无 5s 超时；删除临时探针后工作树零残留 |
| P0-3 | **生产主会话真实模型上下文不含工具规格，与 mock 闭环语义不一致** | `src/main/agent-runner.ts:797-812` 的 `createProvider` 对 GLM 缓存单次 `streamGlm([...prefix,user])`，不传 `tools`；而 `runLoop` 每轮调用 `stream(projectContext(seen))`；工具事件被 mock 剧本驱动时才工作 | 把 provider 抽象改为每轮接收 `messages/tools/signal`；真实 GLM 会话按同一路径走多轮；加入“真实 provider 配置下的多轮工具循环”离线契约测试（可注入 fetch，不联网） | 至少两条测试证明：① 首轮后 assistant tool_call → tool_result → 次轮消息包含结果；② 工具规格进入请求体；类型检查和 provider-check 通过 |
| P0-4 | **门禁可信度依赖本机手跑，未进入 CI 严格模式** | `gates.ts` 已支持严格未证，但项目文档要求 CI/凭据环境显式开；当前工作树没有 CI 配置证据 | 增加 CI 工作流：运行 `pnpm gates --strict-unverified`（有凭据 runner）与离线 `pnpm gates` 分层；失败必红，不允许人工覆盖 | CI 记录中能看到 26 门逐道退出码、未证清单；有凭据任务未证=红 |

### P1 本迭代建议

| # | 问题 | 证据 | 优化建议 | 验收标准 |
|---|---|---|---|---|
| P1-1 | **并发 run 仍共享全局插件运行时与 TOOLS 注入面** | `agent-runner.ts:888-897` `setCurrentPluginRuntime(rt)`、`installPluginTools(rt)`；`agent-runner.ts:1043-1052` finally 读取全局并 shutdown/删全局工具；`plugins/index.ts:286-293` 是模块级单例；H3 文档已声明 v1 边界 | 把 PluginRuntime 与注入表放进 RunScope；shutdown 只作用于本 run 的 runtime；MCP 工具名按 run 隔离或集中注册 | 新增并发双 run 测试：U 结束不关闭 I 的 MCP/hooks/skill；I 后续插件工具仍可用 |
| P1-2 | **全局 clarify/plan 门按 callId 共享，跨 run 污染风险仍在** | `agent-runner.ts:149-151` 全局 `appClarifyGate/appPlanGate`；`agent-runner.ts:941-957` 所有 run 复用；测试 `runscope.test.ts` 只覆盖 AskGate | 门实例随 RunScope 创建；UI 决议事件携带 run/session 标识路由到对应门；历史事件回放不注册 pending | 双 run 同名 callId 不互相结算；无人值守门 60s 后只影响自身 |
| P1-3 | **`shell_ro` 仍是字符串白名单过渡层，参数面会长期追赶** | `orchestrator.ts:126-190`；探针证明已修 `&`、换行、`--flag=value`、`rg --pre`；但仍靠人工枚举危险 flag | 治本改为原生只读命令工具（只实现明确 read 操作）或 Seatbelt 只读 profile；短期保留过滤器时，把 flag 解析统一成 argv parser，同时拒绝“危险 flag 的赋值/空格两种形态” | 建立参数面矩阵：每个白名单命令列出允许 flag；危险 flag 两种写法红→绿；对照组合法命令不误伤 |
| P1-4 | **git `-o` 空格形态未被黑名单覆盖，但端到端未证明可写** | `orchestrator.ts:140` 仅 `--output` 精确匹配；探针 `git log -o <path>` 当前 git 把它解释为 revision 而失败，未写文件 | 不把它宣传成已证实漏洞；按“同一危险能力的所有语法形态”补 `-o/--output` 与 `git -c` 配置注入；同时加负向端到端测试 | 对 `-o`、`--output`、赋值/空格形态均有拒绝测试；合法 `git log -- <file>` 不误伤 |
| P1-5 | **主进程 `getState`/会话状态读取存在全量 replay 热点** | `agent-runner.ts:1336` `replay(lastLogPath)`；`events/index.ts:471-524` 已有 `replayIncremental` 未接此路径；性能探索报告也独立指出 | `handleAgentState`、sidechat/调度终态等读路径接入 `replayIncremental`；会话删除/重建时按 inode/路径失效 | 长会话连续 100 次 state 拉取耗时显著低于基线；投影结果与全量 replay 逐字一致 |
| P1-6 | **renderer 每个事件触发多个 O(events) 投影** | `main.tsx:774-783,1173-1188`；`store.ts:86-123`；`projections.ts` 全量扫描 | 投影按事件类型增量维护，或在 reducer fold 时同步增量更新；至少合并 `clarifySubmittedOf` 与 `planStatusesOf` 的单遍扫描 | 5000 事件流式压测下 renderer 主线程投影耗时可测下降；panels-check 全绿 |

### P2 结构与技术债

| # | 问题 | 证据 | 优化建议 | 验收标准 |
|---|---|---|---|---|
| P2-1 | 巨型文件继续承载多个域 | `orchestrator.ts` 2548 行、`agent-runner.ts` 1757 行、`main.tsx` 1485 行、`panels/registry.tsx` 1262 行 | 按域拆分：orchestrator 拆 shell 策略/spawn/pipeline/approval/security；agent-runner 拆 provider key/session/schedule/plugin wiring；renderer 拆会话侧栏、事件视图、设置 | 文件行数下降且 import 边界稳定；typecheck、test、panels-check 全绿 |
| P2-2 | renderer 打包进 agent 域实现 | `main.tsx:45-46` import `../agent/compaction`、`../agent/security/scan` 仅为 payload 构造函数 | 将纯 payload 构造函数移到 `src/renderer` 或共享 types 模块 | renderer bundle 不包含 Node/agent 依赖链；build 成功 |
| P2-3 | Scheduler 内存索引不随 journal 收敛裁剪 | `scheduler.ts:389-396` journalKeys/journalByTask/completions 增长；磁盘收敛在 `scheduler.ts:113-127` | compact 时同步裁剪内存索引，completions 设 LRU | 构造 10k+ journal 后内存索引有界；schedule-check 通过 |
| P2-4 | 启动时静态导入重依赖 | `tools/lsp.ts`、`plugins/mcp.ts`、`scheduler.ts` 顶层导入 LSP/MCP SDK/croner；构建产物未压缩 | 重依赖动态 import + 单例缓存；`electron.vite.config.ts` 开 minify；入口启用 `module.enableCompileCache()` | 冷启动和二次启动有基线对比；build/dist 全绿，无新依赖 |
| P2-5 | map-check 对仓库自嵌套副本敏感 | 隔离副本内 `.tmp/audit-*` 触发 `map-check` 缺文件假红；真实工作树单跑通过 | `scripts/map-check.ts` 的复制过滤增加排除自身临时副本祖先（如 `.tmp/audit-*`）或复制清单改为白名单源码目录 | 在含 `.tmp/audit-*` 的工作树中 map-check 仍绿；不触碰真实源码 |

### P3 可选改进

- 会话列表、diff 列表、运行历史等长列表上 `react-virtuoso` 或“最近 N 条 + 展开”。
- `tree-sitter-wasms` 发行包只保留实际 grammar，预计 dmg 减少约 40MB。
- `SENSITIVE` 沙箱目录列表集中为安全资产并配单独测试/评审钩子。
- 对 `updater` manifest 下载 URL 增加域名白名单/证书钉扎策略；当前仅 http(s) 协议白名单。
- 给性能基线新增门禁脚本并登记进 `scripts/gate-manifest.ts`，避免优化只靠口头估算。

## 5. 推荐执行顺序

1. **先修可信基线**：P0-1/P0-2 测试红与动态导入悬挂；然后 P0-3 真实 provider 多轮工具循环；最后把 CI 严格门禁接上。
2. **再修并发隔离剩余面**：RunScope 已解决 session/orchestrator，继续收插件 runtime、TOOLS、clarify/plan 门。
3. **随后做性能**：getState 增量 replay → renderer 增量投影 → 启动 bundle/minify/compile cache。
4. **最后做结构拆分**：先拆 agent-runner 与 orchestrator 中已经被反复修补的策略模块，再拆 UI 大文件。拆分时只搬代码、不改行为，用现有 26 门作为防回归网。

## 6. 审查局限

- 原计划并行子审查服务不可用，最终由主审直接完成；因此本报告不宣称“多代理交叉验证”。
- 未用真实 `M0_API_KEY` 调外部模型；所有 provider 结论基于静态代码与可注入 mock 验证，真实网络行为仍属未证。
- `shell_rw` 的目标是允许任意非 git 命令，本报告不把“非 git 命令本身可写”当漏洞；重点只审 git 破坏命令防护。
- `git -o` 空格形态当前端到端未证明能写出文件，因此列为加固项而非已证实 P0。
