# ADR 0006：MCP 工具懒加载（服务器级 + 大 server 按工具子集）

- 状态：**已接受**——2026-10-25 业主裁「服务器级激活；对 >20 工具的单台 server 上单工具模式；设置面板显示 active server」
- 日期：2026-10-25
- 决策者：仓库所有者
- 取代：无（承接 `docs/CODE-WIKI.md` §④ 与 `MODEL_SURFACE_TOTAL_CHAR_LIMIT` 的「按需装载」方向）
- 关联：`src/agent/plugins/index.ts`（active 集 / 目录 / 激活语义）、`src/agent/plugins/mcp.ts`（工具清单与上限）、`src/main/tool-gates.ts`（模型面/执行面/权限门同源）、`src/main/agent-runner.ts`（逐请求 `requestFace`）、`apps/desktop/src/renderer/components/AppPage.tsx` + `McpServerRow.tsx`（面板）

## 背景

MCP 的 `tools/list` 会把每把工具的 description + inputSchema 带进模型面。把多个 server 全量挂上时，固定成本随「工具数 × 每轮重送」增长；`model-surface.ts` 只能在预算已满后压描述/尾丢，属于**事后降配**，不是**按需装载**。

同时，skill 侧已经验证了同一形状：L0 只放 name + description，L1 才读正文，L2 再读资源。MCP 需要等价的三层：

- L0：server 目录（名字、工具数、激活态），不含 schema；
- L1：工具名 + 一句话描述，仍不含 schema；
- L2：激活后才把原生 scoped 工具的 schema 放进下一轮模型面。

服务器级激活先落地后，暴露了一个边界：**单台 >20 工具的 server 整台激活会直接越过 `MCP_ACTIVE_TOOL_LIMIT`**，于是它永远激活不了。只给一句「用 includeTools 收窄」不够——模型在会话中无法改配置，必须有一个运行期的逃生口。

## 裁决

### 1. L0/L1 走元工具，不把目录塞进 system prompt

新增三个常驻小工具（`mcp_list` / `mcp_activate` / `mcp_release`）：

- `mcp_list`：无参列 server 目录；给 `server` 列工具名 + 描述（描述上限 300 字符）；
- `mcp_activate`：默认整台激活；给 `tool`/`tools` 时只激活子集；
- `mcp_release`：释放整台或其中一把。

目录与激活结果都只说明「有什么、激活了多少」，不携带 schema。schema 在下一轮 `requestFace` 才进入工具面。

### 2. 默认服务器级；上限 2 台 / 20 把

- 整台激活消耗一个 server 名额（`MCP_ACTIVE_SERVER_LIMIT = 2`）与它的全部工具名额；
- 总工具帽 `MCP_ACTIVE_TOOL_LIMIT = 20`，按**实际进入模型面的工具数**计；
- 超限显式拒绝，并写出当前占用、上限与替代路径；不静默截断。

### 3. 大 server：按工具子集，不占 server 名额，但仍吃工具帽

`mcp_activate({server, tools: ["t0","t1"]})`：

- 只把选中的 scoped 工具放进 active 集；
- 不消耗 `MCP_ACTIVE_SERVER_LIMIT` 的整台名额（因此可以跨超过 2 台 server），但每一把都计入 `MCP_ACTIVE_TOOL_LIMIT`；
- `mcp_release({server, tool})` 只释放一把；
- 整台已激活时不允许单把释放（先释放整台，再按子集重新激活），避免「整台 → 子集」的隐式状态转换。

### 4. 原生 scoped 工具名保留，不做 meta-call

激活后进入模型面的仍是 `mcp__plugin_<plugin>_<server>__<tool>` 原生工具：

- 权限门继续按 scoped 名 + server 注解（`readOnlyHint` / `destructiveHint`）判定；
- hooks 的 `PreToolUse` / `PostToolUse` matcher 继续按原生名匹配；
- 事件流仍是 `tool_call` / `tool_result`，不新增事件类型，也不需要 target 映射；
- `mcp_call` 这一类「单工具取 schema 再调用」的 meta-call **不在本 ADR 范围内**。它是稳定前缀的下一档，但会把权限/hook/事件/UI 的 target 映射全部推开；先用子集激活验证收益。

### 5. active 生命周期 = 一次 run

`activeMcpServers` / `activeMcpTools` 都在 `PluginRuntime` 实例内（与 `skillScopes` 同生命周期）。不落盘、不跨 run、不继承父会话。server 掉线、插件撤销信任、`disabled` 配置都会清掉对应的 active 项。

### 6. 配置面裁剪在连接期发生

`.mcp.json` / 插件 MCP 配置支持：

- `includeTools`：只注册列出的工具；
- `excludeTools`：排除列出的工具；
- `disabled`：保留配置但不连接。

过滤发生在 `tools/list` 之后、进注册表之前；被排除的工具连名字都不进目录。

### 7. 设置面板读同一份快照

`PluginPanelSnapshot` 增加：

- `activeMcpServers`：整台激活的 key；
- `activeMcpTools`：按工具激活的 scoped 名；
- `mcpServerSummaries`：`{key, toolCount, active, activeMode, activeToolCount}`。

面板的 MCP 行显示 `整台已激活` / `按工具激活 N 把` / `未激活` / `未记录`。旧快照缺这三格时显示「未记录」——**缺席 ≠ 零**。这是一次协议形状变更，`IPC_PROTOCOL_VERSION` 同步从 21 → 22。

## 备选与为何不选

| 方案 | 不选的理由 |
| --- | --- |
| 全量挂所有 MCP schema | 固定面随 server 数线性增长；`model-surface` 只能事后压/丢，模型会看到被丢工具却不知道为什么 |
| 只做服务器级，不支持子集 | 单台 >20 工具的 server 永远无法激活；`includeTools` 是配置面，模型无法在当前会话改 |
| 单工具 `mcp_get` + `mcp_call`（Qoder 同款） | 前缀最稳，但权限、hooks、事件、UI 都要加 target 映射；先用原生 scoped 名拿收益，再评估是否值得 |
| 外部 MCP gateway | 单机单客户端收益不足；它也不自动减少模型侧工具名，除非网关自己做过滤 |

## 后果

- **正面**：未激活 server 不再付 schema 成本；大 server 可以只买需要的几把；权限/hook/事件保持原语义；模型面与执行面仍由同一 active 谓词裁决。
- **代价**：激活会改变工具面，导致一次可缓存前缀变化（`surface_account.faceChanged` 可见）；整台 server 上限 2 台，超出需 `mcp_release`；按工具模式跨 server 时不占 server 名额，但 20 把总帽仍然会限制。
- **连接仍是启动期**：目录需要 `tools/list`，所以受信 server 在 run 起点仍连接；本 ADR 只懒加载 schema，不懒连接。连接期懒加载是另一笔（启动时延/鉴权噪音），未在本轮。
- **面板是快照**：`setPluginSnapshot` 在 run 收尾落一次；运行中的 active 变化要下一次 state 读取或 run 结束才在设置页可见。

## 判据

- `pnpm plugins-check` 的 E 段：先 `mcp_activate` 再调原生 scoped 工具；未激活/权限/无注解/只读四态仍走原门；
- `tests/mcp-current-permissions.test.ts`：整台激活 + 重连 + 撤销；按工具激活后可执行、未选工具不可见；
- `tests/plugins-mcp.test.ts`：>20 工具整台拒绝、子集激活、总帽拒绝、`mcp_activate` 规格含 `tool/tools`；
- `tests/mcp-bounds.test.ts`：`includeTools/excludeTools` 在进注册表前生效；
- `apps/desktop/tests/mcp-server-row.test.tsx`：整台/按工具/未激活/未记录四态；
- `pnpm model-surface-check` / `pnpm prompt-surface-check` / `pnpm tools-check` 保持绿。
