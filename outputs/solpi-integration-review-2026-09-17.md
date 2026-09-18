# SoL-Pi 融合检查与决策建议

日期：2026-09-17。对象：当前工作树（含用户未提交的 UI 和内核变更）。
上游源码基线：NVlabs/SoL-Pi `2b791687a489a1d24da816cf1634d8ae1d36befd`。

本报告补充而不覆盖 `docs/solpi-port-proposal.md`。不修改只读的 `agent-plan.md`，不修改冻结判卷。本文的 P1/P2 是审查严重度，不是既有提案的阶段编号。

## 1. 结论

建议采纳 SoL-Pi 的约束式效率优化方法，但暂不直接移植四个扩展。优先级是：真实产品闭环与计量 -> 可回取观测 -> 受控融合与证据收据 -> 经济压缩。

项目已有事件日志、上下文投影、压缩/prune、权限与沙箱、worker 编排、靶场等基础；主要缺口是产品入口、组装器和验证指标尚未形成同一条闭环。模块测试通过不能证明这些能力已被桌面用户路径消费。

本轮是跨模块架构检查和关键链路复核，不是逐文件穷尽审计，也不是全面安全认证。使用 CodeGraph 定位，OCR 仅执行 `delegate preview` / `delegate rule`，未调用 OCR 的模型审查命令。

## 2. 发现（按严重度）

### F1 [P1] 主对话仍使用演示 provider

证据：`src/main/agent-runner.ts:797` 的 `createProvider`；实际调用点 `:953`。

- `:811` 在未设置 `M0A_PROVIDER=glm` 时返回冻结 mock。
- `:822` 的 GLM 请求只有 system 前缀与本轮用户文本，工具参数为 undefined。
- `:812` 缓存一个生成器，忽略下一轮 messages；生成器耗尽后没有真正的后续请求。
- `createGlmSessionProvider` 的消费者在 `scripts/gate-check.ts:233` 与 `tests/compaction.test.ts:413`，主进程只导入该模块的摘要器。

影响：真实用户无法通过这条路径完成多轮工具反馈驱动的编程。只给组装器加压缩优化不会改善桌面主对话。

建议：建立可注入的生产 provider 工厂，显式选择 demo 或真实 provider；真实配置缺失时明确报错，不能把静默回落 mock 称作 fail-closed。统一消息、工具 schema、取消和会话日志的装配契约。

### F2 [P1] UI 创建会话但发送请求不带会话 ID

证据：`src/renderer/app.js:2186` 创建并保存 real.id；`:2201` 的 `api.run` 仅带 message/mode。`src/main/index.ts:184` 只转交请求中已有的 sessionId，没有从 settings 自动补齐。

因此 `src/main/agent-runner.ts:1099` 选择非会话模式，`:1100` 使用临时日志，`:877` 每次 run 删除旧日志。会话列表条目和实际对话日志脱节。工作区默认还落在 `fixtures/todo-app`（`:1104`），除非提供覆盖。

建议：修复 run 请求归属，明确工作区绑定；通过真实 IPC 验证连续两次发送、切换后重开和重启恢复。不能仅测试带 override 的 headless 入口。

### F3 [P1] loop 未把工具执行结果加入下一轮上下文

证据：`src/agent/loop.ts:68` 创建 seen，`:79` 将其投影给 provider；只有用户消息与 provider 输出进入 seen。正常工具结果在 `:225` 只 append 到日志。权限拒绝、verify 失败与工具 ctx.emit 等分支同样未更新 seen。

已运行无网络、无文件写入的内存探针：provider 第一轮请求一个替身 read_file，工具返回 FEEDBACK_SENTINEL，第二轮捕获 messages。

```text
requests = 2
loggedResult = true
nextRequestHasResult = false
```

影响：消费 messages 的普通 provider 只能看到调用，看不到结果；冻结脚本不依赖结果，日志型 provider 则通过重新读盘绕过缺口，现有通过结果未覆盖此契约。

建议：统一本次 run 的事件提交与上下文更新，覆盖成功、失败、拒绝、verify 失败和工具发出的事件；避免重复插入用户/provider 消息。跨 run 历史恢复是另一项契约，不能与本修复混同。

### F4 [P1] 靶场还不能证明效率收益或有效反事实

证据：`src/agent/gym/runner.ts:35` 的 scriptedUsageOf 是冻结剧本内容的函数；`:95` 使用它计量，压缩投影不会改变数字。`:96` 的 turns 实为 tool_call 数，不是模型请求数。`:57` 的 real provider 与 F1 同样为单生成器、无工具请求。

另一个独立问题：forkCase 在 `:145` 截取事件前缀，却在 `:147` 复制父运行最终工作目录，不恢复 eventId 时的文件状态。不能据此声称从相同中间状态比较策略。

建议：分别保留 legacy 脚本指标和新增的实际请求指标；真实请求计数、发送上下文大小、usage/cache、墙钟时间、验证结果分别记录。反事实实验从不可变初始快照重跑，或有经验证的检查点恢复后再 fork。

### F5 [P2] 组装器不能直接替换而不补运行时契约

证据：`src/agent/glm-session.ts:354` 的 stream 未接收/转交 call.signal；`:420` 先把整轮网络输出缓冲入 queue，再在 `:424` yield，失去逐字实时上屏；`:380` 将压缩事件直接写日志，没有经过主进程的 UI 事件管线。

建议：F1 接线前先保证流式、取消、压缩卡事件和 system/tools 总开销计量。已有提案将此工作估为一处分支替换，低估了这些契约修复。

### F6 [P2] shell 尾部丢弃，自动 prune 回取未接线

证据：`src/tools/run_shell.ts:21` 在达到上限后丢弃 chunk；`:74` 与 `:75` 同时收集 stdout/stderr，因此不是完全丢弃 stderr，而是两者共享头部截断缓冲。上限比较使用 JS 字符串 length，不是真实 UTF-8 字节数。

`src/agent/glm-session.ts:322` 只计算 prune 投影，未配置附件与写档；已进入事件日志的原始 tool_result 仍可重放，但 shell 提前丢弃的尾部无法从该日志恢复。

建议：工具采集阶段有界落盘，模型请求阶段再做投影替换。存储必须有配额、生命周期、明确的截断状态和会话隔离；不能把无限落盘称作无损安全方案。

### F7 [P2] 多 provider 的适配与桌面配置范围不同

证据：`src/providers/registry.ts:23` 白名单是四家；`src/main/provider-keys.ts:24` 仅 glm；`src/main/provider-key-inject.ts:11` 只注入 glm。档位表在 registry 的注释中明确标为待校准占位。

结论：四家 worker 适配能力存在，但不能等同于桌面 BYOK 四家均已完成。外部 env 可供适配器使用，不代表 UI 配置链已验证。

## 3. 应当借鉴什么

上游四个机制均为 opt-in Pi 扩展，不是能直接装进本 Electron runtime 的通用 SDK。最值得借鉴的是：预先冻结能力底线，在独立评测中尝试效率假设，用能力与净成本决定是否晋级；仓库扩展和研究流程不能混称为已经开源的完整自我研究系统。

| 机制 | 本项目落点 | 推荐范围与边界 |
| --- | --- | --- |
| ObservationPack | 工具输出采集 + projectContext 替换槽位 + 会话附件 | 首先试验。归档与投影分离；稳定句柄、hash、UTF-8 分页、恢复与删除；归档失败时保持可见证据，不静默产生失效句柄 |
| Action Fusion | 现有受权限保护的工具执行包装层 | 合并有依赖的 edit/write 与后续检查，保持独立执行结果；命令仍过授权、沙箱与取消，不因名称是 lint/test 而豁免 |
| Evidence-Preserving Reducer | shape/prune 的诊断输出投影 | 先做确定性收据，记录真实退出状态、来源 hash、精确引文和回取；引文真实不等于摘要完整或推理正确 |
| Online Context Compact | 统一组装器 + compaction coordinator | 后做。任务进度边界、剩余请求估计、缓存重建代价与压缩债务；经济拒绝不能阻断上下文窗口硬保护 |

不照搬 10KB、前两次全文发送、16KB 分页或 12.5 缓存价比作为本项目已验证最佳值。上游价格假设及节省比例不等于我们的收益。

## 4. 对现有提案的补充裁决建议

1. 保留“先接真实路径”的大方向，但加入 F3 与 F5 的契约修复，不能仅替换 provider 工厂。
2. W6 的“无 key 回 mock”改为真实模式配置错误；demo 模式必须显式可辨。
3. “配置里的 lint 天然只读且无需审批”不成立：配置、package scripts 和其调用程序都可能改变行为。使用既有审批/执行边界，必要时将获批命令与配置版本绑定。
4. “无 cache_control 就没有缓存”不成立：部分 provider 自动缓存。未知计量不能记作零；缓存启用、计量与压缩策略分别评测。
5. verify 成功在 `loop.ts:118` 立即结束 loop，不适合作为同任务继续执行的唯一阶段完成信号；改过 plan.files 也不证明步骤完成。需要定义可信的边界契约，缺失时退回既有窗口策略。
6. “所有机制不能改变模型工具调用序列”过度限制。关闭机制时维持旧行为，开启时新增独立用例；如既有冻结标准与新规格冲突，走 BLOCKED 裁决，不利用运行时注入绕过工具数量判据。
7. “精确原文”应注明是脱敏后授权文本还是原始进程字节。两者 hash 与可回取契约不同；不能同时声称先脱敏和恢复原始字节。
8. `agent-plan.md` §7.7 禁止远程/服务端压缩，但现有 createGlmSummarizer 本身会调用模型。该边界需单独澄清；首轮不新增 reducer 外发，不能简单推导为 BYOK 禁止所有远程摘要。

## 5. 建议执行顺序与退出条件

| 阶段 | 交付 | 退出条件 |
| --- | --- | --- |
| A 闭环基线 | F1/F2/F3/F5；统一生产/评测请求装配；明确 demo/真实模式 | 连续多轮工具反馈、工具 schema、取消、实时上屏、会话恢复、工作区归属均经集成测试；旧冻结用例不改 |
| B 计量与观测 | 修复 F4；有界归档和 recall；开关默认关闭 | 相同初始文件状态 A/B；发送量可测；分页拼接与约定源字节相等；失效对象、磁盘满、删除恢复都有可见降级 |
| C 单机制试验 | 分别加入融合和确定性收据 | 保持成功率/验证覆盖，比较模型请求数、验证重复次数、延迟与成本；明确写入成功但检查失败的复合状态 |
| D 经济压缩 | 边界事件与请求 horizon，provider 定价/cache 计量 | 长任务和短任务分别验证净收益；窗口保护必保留；恢复后债务状态一致；未知价格不伪造收益 |

每个试验固定任务集、初始快照、模型配置、预算和不可变验证器；开发集与留出集分开，做单机制消融，再测组合。真实模型有方差，需要重复运行与区间，不把一次胜出作为晋级依据。

核心指标：任务正确率与新鲜验证证据、实际模型请求数、累计发送 token/字符、输入/输出/cache 使用、工具时间、压缩/reducer/recall 额外成本、端到端延迟、单成功任务总成本。模拟估算与真实账单分列。

进一步自动化应先局限于离线候选实验：人批准预算与变体，隔离工作区，验证器只读，输出实验记录并由人决定晋级。不让优化器自行修改权限策略、判卷或生产配置。

## 6. 本轮验证与未证项

- `TERM=dumb pnpm typecheck`：通过。
- `TERM=dumb pnpm test`：61 files / 600 passed，退出码 0。
- `TERM=dumb pnpm build`：通过。仍有 web-tree-sitter eval、memory 静态/动态导入混用及 install-app-deps bin 警告。
- 内存 provider 探针：确认 F3；两次请求、结果已落日志、下一次请求缺结果。
- OCR delegate：已读取工作树文件选择和解析规则。它排除了部分文档/测试，因此未把其文件清单当作完整审查范围。
- 未运行完整 `pnpm gates`、Electron 交互/e2e、真实模型凭据请求、SoL-Pi 性能对比或完整依赖安全扫描。不得声称全部门禁或线上能力通过。
- 本轮仅新增此报告；源码、现有提案、计划、冻结用例及用户未提交改动均未修改。

## 7. 上游依据

- 项目与使用范围：https://github.com/NVlabs/SoL-Pi
- 研究方法：https://nvlabs.github.io/SoL-Pi/
- 固定版本：https://github.com/NVlabs/SoL-Pi/tree/2b791687a489a1d24da816cf1634d8ae1d36befd
- 核读源码：`action-fusion/then-run.ts`、`observation-pack/observation.ts`、`evidence-preserving-reducer/receipt.ts`、`online-context-compact/economics.ts`，路径均位于 `src/sol-pi/extensions/`。
- 同时核对 README、配置、兼容说明与 SECURITY。上游 MIT；若复制实现，保留版权与许可证声明。
