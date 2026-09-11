# M2 ponytail-audit（§16 纪律 5：从零自研最大的风险是给自己造抽象）

> 出具：M2g 收口轮（2026-09-11）。方法：对每个「对外声明但无消费路径」的抽象做 `grep -rn "<名>" src/`，
> 命中只有声明点 = 无第二消费者。**处置三选**：删 / 保留待 M3 用 / 记 BLOCKED。
> 审查方点名的候选逐条给处置；另自查补充两条。

## 一、审查方点名的候选（逐条处置）

### 1. `manifest.userConfig`（M2g 任务 2 已消费 → 关闭）

- **审计前状态**：`parsePluginManifest` 把 userConfig 解析成裸 `Record<string, unknown>`，全仓零消费——「造了抽象没有消费者」的教科书样本。
- **处置**：**本轮消费掉（不删）**。`src/agent/plugins/manifest.ts:parseUserConfigFields`（解析 CC 形态字段表）→ `src/agent/plugins/secrets.ts:writePluginUserConfig`（敏感值入 safeStorage / 非敏感明文落 `.agent/`）→ `src/main/index.ts`（Electron ready 装配 safeStorage 后端）→ `scripts/plugins-check.ts` F9–F17（真实 tres-finance 仓上断言）。
- **消费链**：manifest 解析 → 敏感判定 → 安全后端 → 实仓验收。第二个、第三个消费者都在场（主进程装配面 + 检查脚本面）。

### 2. `manifest.unknownFields`

- **审计结果**：声明于 `manifest.ts:48/:130`；消费者 = `discover.ts:186`（透传进 `DiscoveredPlugin`）→ `scripts/plugins-check.ts:115`（A4 断言）+ `tests/plugins-discover.test.ts:41`。**面板不展示**（warnings 面板展示，unknownFields 只进 warning 文案 `manifest.ts:132`）。
- **判定**：有真实消费路径（超集契约的**验收面**——「未知顶层字段忽略 + 警告不阻断」是 §9.2 的明文行为，A4 直接断言它）。
- **处置**：**保留**。它不是给 UI 的，是给契约测试的；删掉等于删掉「超集不阻断」的可证性。

### 3. `manifest.warnings`

- **审计结果**：消费者三处：`panels/registry.tsx:549/:574/:579`（面板「加载清单异常」块）、`plugins-check.ts` A9（断言警告面在场）、`tests/plugins-*`。
- **处置**：**保留**（消费充分：UI + 验收 + 单测）。

### 4. `manifest.hooksRef`

- **审计结果**：`manifest.ts:55` 声明三态（inline / path / none）；唯一消费 = `discover.ts:139–148`（据此装载 hooks）。**第二消费者不存在**。
- **判定**：它是 `parsePluginManifest` → `loadContainer` 之间的**内部数据通道**，不是对外抽象——「一个解析函数返回结构化结果给唯一调用方」不构成自造抽象。
- **处置**：**保留**。若 M3 出现第二个 hooks 装载点再议。

### 5. `SidechatPanelSnapshot` 的未用字段

逐字段：

| 字段 | 消费者 | 判定 |
|---|---|---|
| `sessions[].id` | 面板 tab 键 + active 定位 | 消费 ✓ |
| `sessions[].parentId` | 面板 `parent: {cur.parentId}`（registry.tsx:314） | 消费 ✓ |
| `sessions[].lines` | 面板 tab 右侧计数 | 消费 ✓ |
| `sessions[].mtimeMs` | **无消费者**（renderer 零引用；main 里只用于排序） | 见处置 |
| `sessions[].messages[].eventId` | 面板 `#id` 徽标 + promote 源定位 | 消费 ✓ |
| `promoted[]` | 面板「已提升进主会话」块 | 消费 ✓ |

- **处置（mtimeMs）**：**保留**。理由：它是快照的**排序依据**（`sessions.ts:192` 按 mtime 降序），删掉字段但排序逻辑仍在 = 把事实源藏进函数；面板虽未展示，但「会话列表稳定按最近活动排序」依赖它。若嫌冗余，正确动作是在面板展示（如悬停提示），不是删。

### 6. `M2B_MAP_WORKSPACE` / `M0B_WORKSPACE` 合并可能

- **审计结果**：两者都是 env 门控演示通道（缺省零行为，不进验收链）：`M0B_WORKSPACE` 覆盖**整个 run 的工作区**（agent-runner.ts:689）；`M2B_MAP_WORKSPACE` 只覆盖**地图演示的扫描工作区**（agent-runner.ts:606）。语义不同：前者换靶子，后者只换地图输入。
- **判定**：**不合并**。合并 = 让「只想看地图效果」的用户被迫连 run 工作区一起换（或反过来，写工具落到演示工作区——语义事故）。两个变量同名不同义才是问题，现在名字已经把差异说清了。
- **处置**：保留，并在各自注释里交叉引用（已做：agent-runner.ts:687 注明「M2B_MAP_WORKSPACE 同族」）。

## 二、自查补充（横向扫了全部 M2 新增面）

### 7. `src/agent/plugins/secrets.ts` 的 `PluginSecretBackend` 抽象

- 自查问题：为了 headless 可测造了一个「后端接口」——这是不是为测试造抽象？
- 判定：**不是**。它有两个非测试消费者：Electron safeStorage 装配（`src/main/index.ts`）与插件 userConfig 写入（`writePluginUserConfig`）；注入式 IO 是「src/agent/** 不 import electron」既有边界的必然形态（与 AskGate/ClarifyGate 同族）。**保留**。
- 风险注记：`memorySecretBackend`（plugins-check 里的内存替身）只在检查脚本里存在，不进 src/ ——没有泄漏。

### 8. `projectTokenUsageByKind` / `mergeTokenProjections` / `EMPTY_SIDECHAT_USAGE`

- 自查问题：三个导出是不是过度设计（一个 `byKind` 字段就够）？
- 判定：`projectTokenUsageByKind`（多源归因）与 `mergeTokenProjections`（main 事件流 + sidechat 聚合的合成）对应**两个不同的数据到达路径**（renderer 订阅 vs getState 拉取），都有真实消费者（单测 + TokenPanel）；`EMPTY_SIDECHAT_USAGE` 是后者的缺省值。**保留**。
- 观察项：`TokenPanel` 每次渲染都拉一次 getState（useEffect 依赖 `base`）——事件流高频时请求放大。M3 做「usage 按 agent 归因」时应改为事件驱动推送。**记入 M3 交接，不在 M2 动**（改它要动 renderer 状态流，超出本轮白名单的精神）。

## 三、M0–M2 既有抽象的抽查（非本轮新增，顺带过一遍）

- `session_meta.branch_of`：消费者 = `forkSession`（events/index.ts:232）+ `tests/fork.test.ts`。✓
- `EventLog` 接口（`append` 单方法）：消费者 = loop / runner / 全部检查脚本。✓
- `CompactionCoordinator`：消费者 = glm-session / compaction-check。✓
- `truncationNotice`：消费者 = run_shell / sandbox / lsp（M2g 新增第三个）。✓（本轮消费 +1）
- `sidechatToolSpecs()` / `SIDECHAT_FORBIDDEN_TOOLS`：消费者 = sidechat-check + 单测（FORBIDDEN_TOOLS 原本只有测试消费；M2g 起 tools-check 之外无新增——**观察项**：它是「验收断言的常量面」，与 unknownFields 同性质，保留）。

## 四、结论

- **无第二消费者且处置为「删」的：0 个。** 审查方点名的 6 项里 1 个被本轮真实消费（userConfig），其余 5 个都有明确保留理由（契约验收面 / 内部数据通道 / 排序依据 / 语义不同的两个门 / 注入边界）。
- **记入 M3 的观察项 2 个**：TokenPanel 的 getState 拉取频率；（随 §9.11-4 一并处理的）agentRoles 采纳面。
- 本轮新增面（secrets 后端 / token kind 分解 / demo 冻结表）都带第二消费者或明确验收面，未新增「造了没人用」的抽象。

## 五、收口执行轮补记（2026-09-11 晚）

收口执行轮以「四通道真机点击链路」复核上述结论时，暴露三个**边界断裂类**接线缺陷（均属实现缺陷、非「自造抽象无消费者」问题；已修复，判据零改动，详见 PROGRESS「收口执行轮补验」与 BLOCKED M2g 备案 2）：

1. `agent:run` IPC 的 `over` 未转交（renderer 传入的 `sessionId` 在边界丢弃）——「UI run 落会话 JSONL」路径在 IPC 缝上断裂；panels-check 直种 JSONL 的验收路径掩盖了它。修复后该参数有了贯通的消费者（renderer → preload → RunOverrides）。
2. 三面板（sidechat/memory/plugins）快照只取挂载时一次——「面板数据可见」此前依赖「run 后再开面板」的时序巧合。修复 = `payload.eventCount` 信号 + 防抖 reload（纯投影，零私有状态）。
3. `handlePluginDecide` 运行间隙无消费者可达（runtime 回收后 no-op）——补轻量发现回退后，插件运行时配置（`pluginRuntimeOpts`，含信任文件路径）成为 run 装配与间隙决议两处共用的事实源。

**方法论教训**：本审计的 `grep -rn` 能抓「声明无消费者」，抓不到「消费者路径在边界断裂」；后者的验收手段是真机端到端点击（`docs/m2g-preload.png` 的四通道断言即为此设）。建议 M3 任务书为 IPC 接线缝补一条机械检查（候选：ipc:check 增加 over 转交断言）。
