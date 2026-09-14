# M2 验收总对表（三态：已证 / 未证 / M3）

> 出具：M2g 收口轮（2026-09-11）；同日收口执行轮补验后更新（终版基线见 §七）。对表对象：`agent-plan.md` §14 M2 行 + §9.11 六条 + §10.8.4 四条 + §11.6 范围收敛。
> 每行带**证据指针**（脚本名 + 断言编号 / 文件:行），审查方可按指针复跑。
> 三态口径：**已证** = 有可复跑的断言；**未证** = 断言没跑到（环境/凭据限制），**不等于通过**；**M3** = 方案明确的后续里程碑欠账，不许在 M2 偷做。
> 复跑口径：`pnpm gates`（19 道门逐道退出码 + 恒真式体检）；单门 `pnpm run <名>`。三门（sandbox:check / ipc:check / panels-check）按宿主**自动选分支**且输出显式打印走哪支（fail-visible）：沙箱可用 → 分支 A 真断言（收口终版实测走 A）；宿主拒 apply deny profile（曾见于 DSH 宿主）→ 降级分支 B（断言降级链正确），panels-check 探测式附加 `--no-sandbox`（产品 Seatbelt 工具沙箱不受影响）。

## 一、§14 M2 行验收标准（4 条）

| # | 标准 | 状态 | 证据指针 |
|---|---|---|---|
| 1 | 工具集逐项验收：grep/glob/read/edit/lsp 每个工具具备输出上限、截断提示、相对路径三项（清单勾选） | **已证**（M2g 补齐后） | `scripts/tools-check.ts`：grep ① ② ③；glob ① ② ③；read ① ② ③（目录列表相对路径，替换旧版 `check(...,true)` 空断言）；edit ①② n/a（定长摘要+有界诊断块，显式写理由）③；lsp ① ② ③（**M2g 补验**：`src/tools/lsp.ts` 新增 `capLspOutput` 32KB 上限 + 截断提示，此前 lsp 无输出帽）。结语按实际覆盖逐格打印（tools-check.ts 起） |
| 2 | skill 端到端可用 | **已证** | fixture 全链路：`scripts/plugins-check.ts` B1–B6（1536 截断/触发全文/重挂预算）；**真实官方 skill**：同脚本 F18–F21（anthropics/skills 的 `/pdf`：路由清单 1536 截断 → 触发全文进上下文 → 压缩后重挂 ≤25000 token，实测 1879）；runAgent 事件流实证 B2（tool_result 携带 SKILL.md 全文） |
| 3 | 地图在 1024 token 预算内渲染并随指纹增量更新（§6.4） | **已证** | `scripts/map-check.ts`（①渲染 token ≤1024）、（②预算收紧输出变短）、（④b 指纹不变 → 渲染逐字相同）；指纹增量路径见同脚本 ③/④ 系列 |
| 4 | MCP 工具 scoped 名进注册表过权限门（§9.11 第 2 条） | **已证**（本地端到端）/ **部分未证**（远程连接） | 本地 stdio 端到端：`scripts/plugins-check.ts` E1（scoped 形态进注册表）/E2（call 回传）/E3（统一注册表真实执行）/E4（deny 规则命中 scoped 名，经 runAgent 真事件流）；实仓：F5–F7（testdino scoped 名形态 + 真 `evaluate` 管线 deny 命中 + 无规则 auto 放行对照）。**未证**：远程 http MCP 实际连接（`mcp.testdino.com` 401 需凭据，见 §9.11-2 行） |

## 二、§9.11 六条硬验收

| # | 标准 | 状态 | 证据指针 |
|---|---|---|---|
| 1 | anthropics/skills 官方 skill 免改加载：渐进披露全链路（路由清单 1536 截断 → 触发全文 → 压缩重挂预算） | **已证**（M2g 补验：真实 skill × 全链路，不再是「fixture 跑全链路 + 真实 skill 只 parse」两半分离） | `scripts/plugins-check.ts` F2（51 个 SKILL.md 免改解析）、F18（真实 `/pdf` 路由清单超 1536 截断）、F19（触发全文进上下文，len>200 且 ===SKILL.md 正文）、F20（压缩后重挂）、F21（重挂 ≤25000 token，实测 1879） |
| 2 | claude-plugins-community 实仓插件免改加载：testdino（7 skills + 远程 http MCP）与 tres-finance（userConfig sensitive）；MCP 工具 scoped 名进注册表过权限门；sensitive 值入 safeStorage 不落明文 | **已证**（manifest/skill/配置/scoped 名/权限门/sensitive 存储）/ **未证**（远程 MCP 连接） | `scripts/plugins-check.ts` F1（**容器**免改解析 4 个 ≥2——修掉旧版 walker 跳过 `.claude-plugin` 的根因）、F3（testdino 7 skills）、F4（.mcp.json → http+url 免改解析）、F5–F7（scoped 名 + 权限门）、F9（DEBANK_API_KEY sensitive=true 解析）、F11–F17（sensitive 值入安全后端 / 明文文件只留占位符 / **三处零明文**（落盘/日志/事件流）/ 往返一致 / 无后端 fail-closed 拒存）；实现：`src/agent/plugins/secrets.ts` + `manifest.ts:parseUserConfigFields` + `src/main/index.ts`（safeStorage 装配）。**未证**：远程连接（401，无凭据）——已证项不含「连接成功后 tools/list 进注册表」 |
| 3 | hooks 端到端：PreToolUse exit 2 阻断 + JSON decision 放行双路径；PostToolUse 上下文回注；SessionStart 注入；项目级插件未信任不激活 | **已证** | `scripts/plugins-check.ts` C1（exit2 真阻断）/C2（JSON 放行 + PostToolUse 回注 tool_result 尾部）/C4–C5（超时强杀引擎级计时）/C6（SessionStart 经组装层注入）；信任门 D1–D5（未信任 hook 不执行、MCP 不连接、信任后同样本生效、决议持久化） |
| 4 | agents/*.md 被编排采纳：stages[].role 引用插件角色，经 depends_on sugar 跑通一环（§4.4.7 V1 范围） | **M3**（§16 纪律 1：M3 之前禁止写编排代码；本行**不得留空**，留空会被误读为漏项） | 方案：`agent-plan.md` §4.4.7 / §4.4.11；解析面已备：`src/agent/plugins/discover.ts` agents/*.md → `PluginRuntime.agentRoles()`（采纳留 M3，见 `src/agent/plugins/index.ts`） |
| 5 | 单插件损坏只影响自身（坏 manifest / 坏 hook JSON），其余正常加载 + 面板报错 | **已证** | `scripts/plugins-check.ts` A6（坏 manifest 隔离报错）/A7（JS 入口拒载 + 警告）/A8（坏插件不影响其他插件）+ A9（警告面在场）；单测 `tests/plugins-discover.test.ts` |
| 6 | 代码插件明确拒载：含 JS 入口的包跳过 + 警告（能力边界落地） | **已证** | `scripts/plugins-check.ts` A7；实现 `src/agent/plugins/manifest.ts:detectJsEntry`（根 index.js / package.json main·bin） |

## 三、§10.8.4 M2 验收（4 条）+ 内部实施序（4 项）

### 内部实施序

| # | 实施序项 | 状态 | 证据指针 |
|---|---|---|---|
| 1 | sidechat 会话类型 + 面板 + 引用式问答 | **已证** | `scripts/sidechat-check.ts`（首行 `session_meta.kind="sidechat"`）；面板 `src/renderer/panels/registry.tsx`（sidechat，SSR 冒烟 `tests/panels.test.ts`）；只读投影 `src/agent/sidechat.ts:buildMainProjection`（sidechat-check 段，逐条断言标签定位） |
| 2 | 只读工具白名单接入（复用 §6.2 整形规则，零新实现） | **已证** | `scripts/sidechat-check.ts`（write/edit/run_shell 不在工具表）（read_file 保留）；三重硬闸：`src/agent/sidechat.ts`（SIDECHAT_TOOL_WHITELIST）+ loop `allowedTools` + 权限层 read-only 档 |
| 3 | /promote 内置模板 + origin 注入 + promote 卡 + 输出扫描 | **已证** | `scripts/sidechat-check.ts`（+1 user_message、origin 四字段、徽标反向投影、重放无损、密钥脱敏而非阻断）；promote 卡 `src/renderer/cards/promote.tsx`（SSR 冒烟 `tests/sidechat.test.ts`）；输出扫描 `src/agent/sidechat.ts:promoteToMain`（redactSecrets） |
| 4 | token 面板按会话 kind 分解（§4.4.10 扩展）——**M1 §10.2「按时间/按 agent/按任务分解」欠账一并清账** | **已证**（M2g 落地） | 投影：`src/renderer/projections.ts`（`projectTokenUsageByKind` / `mergeTokenProjections`，总量=各分解之和）；渲染：`src/renderer/panels/registry.tsx` TokenPanel（`data-m2g-token-bykind`）；数据源：`SidechatPanelSnapshot.sessions[].usage`（`src/main/agent-runner.ts:handleSidechatState`，从各自 JSONL 投影）；单测：`tests/sidechat.test.ts`「M2g token 归因分解」①②③ + `tests/panels.test.ts` |

### M2 验收（4 条）

| # | 标准 | 状态 | 证据指针 |
|---|---|---|---|
| 1 | 主 agent 忙碌期间 sidechat 问答 ≥3 轮：主会话事件流零写入、主上下文 token 零增长 | **已证** | `scripts/sidechat-check.ts`（问答 ≥3 轮）（主会话 JSONL 行数零变化）（**字节逐字不变**）（主上下文 token 零变化）；结构保证：`src/agent/sidechat.ts` 全文件无主会话 append 路径（唯一写口 = 用户显式 /promote） |
| 2 | /promote 一条 → 主流 +1 user_message（origin 完整）→ **主 agent 下一 turn 明确引用其内容**；promote 卡可跳回源消息 | **已证**（后半句 M2g 补验） | 前半句：`scripts/sidechat-check.ts`；**后半句（提升内容真的进主上下文）**：`tests/sidechat.test.ts`「promote → 提升内容进主上下文」②（`projectContext` 产物含提升正文 = 主 agent 下一 turn 输入）③（`composeTurnMessages` 模型输入可见）④（端到端可追溯：主流正文 == 源 sidechat 事件重建正文）⑤（徽标反向投影定位）；跳回源消息：promote 卡 `jump_source` → sidechat 面板定位（`src/renderer/main.tsx:onCardAction`） |
| 3 | 杀进程重启 → sidechat 会话与 promote 历史从 JSONL 重放无损（§3.1 判据验收化） | **已证** | `scripts/sidechat-check.ts`（重放无损断言：promote 段 + 会话文件重放）；`listSidechatSessions` 只读重放（`src/main/sessions.ts`）；`tests/sidechat.test.ts`（事件落自己 JSONL + 主会话字节不变）；面板快照 `handleSidechatState` 全部从 JSONL 投影 |
| 4 | sidechat 全程无写工具/shell 写路径可触达（只读白名单硬闸，非提示词自觉） | **已证** | `scripts/sidechat-check.ts`（工具表断言）；三重硬闸（工具表摘除 + `allowedTools` + 权限层 read-only）；单测 `tests/sidechat.test.ts`（三个写向工具不在工具表） |

## 四、§11.6 M2 范围收敛（只交付第 1 段静态快筛）

| # | 标准 | 状态 | 证据指针 |
|---|---|---|---|
| 1 | 静态快筛（零 token、本地）：diff 范围密钥扫描（熵 + 已知模式）+ 危险 API 六类规则表；report 卡复用注册表；触发点 = 验证门收敛后 hook；默认 report | **已证** | `scripts/security-check.ts`（默认 report）/114–122（变更集重建）/129（六类全命中）；触发面 `src/main/agent-runner.ts:shouldRunSecurityReport`（safeMode==="report" **且** 存在 `verify_result(ok)`——既有 mock 流零影响）；卡片复用 `report` 类型（`src/renderer/main.tsx` EventView）；注入防线（被审内容是数据）+ 报告过输出扫描 |
| 2 | LLM 两段流水（BYOK）+ 第二遍 FP 过滤 + findings 行级定位接 diff_comment + gate 模式 | **M3**（§11.6 V1/M2 范围收敛明文：M2 只交付第 1 段） | 方案：`agent-plan.md` §11.6；`edit_file` findings 绝对行号（需写前快照）同属 M3（M2f 轮裁决 6） |

## 五、未证项汇总

| # | 未证项 | 原因 | 已证到的边界 |
|---|---|---|---|
| 1 | testdino 远程 http MCP **实际连接**（tools/list 进注册表） | `mcp.testdino.com` 返回 401，需 TestDino 凭据；无 key 不伪造连接成功 | 已证：`.mcp.json` http 配置免改解析（F4）+ scoped 名形态（F5）+ 真权限管线 deny 命中/放行对照（F6/F7）+ 本地 stdio MCP 全链路端到端（E1–E4）；连接成功分支有真断言（F8 scoped 名形态校验），有凭据环境下重跑即自动闭合 |

> 原第 2 项（真机 GUI 四通道点击链路的截图证据）**已补齐**（收口执行轮）：`docs/m2g-preload.png`（2×2 实录：删除 3→2 / run 中批准→已信任 / 提问→回答落面板 / 跳回→sidechatState promoted=2，逐通道点击效果经脚本断言，见 PROGRESS「收口执行轮补验」）。

## 六、M3 欠账清单（M2g 明确不碰，M2 收口后由 M3 任务书承接）

- §9.11-4：`agents/*.md` 角色被编排采纳（`stages[].role` + `depends_on` sugar）。
- §11.6 gate 模式（critical|high → 合并卡红标 + 二次确认）+ LLM 两段流水（BYOK）+ FP 过滤 pass。
- `edit_file` findings 绝对行号（需写前快照）+ findings 行级定位接 `diff_comment`。
- §11.7.7 编排侧审批通道与继承（§4.4.3）。
- 多 agent 面板 / git 合并控制塔 / usage 按 agent 归因（§4.4.10）。
- 记忆多工作区路径粒度（M1c-3 裁决）。

## 七、门禁基线（`pnpm gates`，2026-09-11 收口执行轮终版实测）

19 道（清单即事实源）：typecheck / test / e2e / ipc:check / sandbox:check / build / fork-check / gate-check / autonomy-check / compaction-check / panels-check / tools-check / map-check / prune-check / providers-check / memory-check / plugins-check / sidechat-check / security-check。

- **全部 19 道 exit 0 + 恒真式体检零命中 + 总退出码 0**（实录 `.tmp/m2g-gates-final2.log`，渲染件 `docs/m2g-gates.png`）。本机沙箱可用 → 三门走**分支 A 真断言**（DSH 宿主等拒 apply 环境自动走降级分支 B，输出显式打印走哪支）。
- test = **37 files / 285 passed / 0 skipped**（≥ 任务书硬底线 279。本表初版曾记 286，1 例计数偏差，以实测为准——见 BLOCKED M2g 备案 4）。
- 恒真式体检：收口基线复跑曾见 **3 命中**（plugins-check F8 `assert(true,…)` 空断言 + gates.ts 文档注释/日志头自扫误报 2 条），已修复（F8 改 scoped 名形态真断言；gates.ts 剥行内块注释 + 日志头去字面模式），终版零命中——「零命中」声明以修复后终版为准。
- 冻结判卷 sha256 3/3 一致；`scripts/frozen-sha256.json` 本体逐字节未改（sha256 = `9b7f44f9ce0b4da12d82b18643eb13fff936a4b0fe2db6500428059d1858c4ba`）；演示区 `frozen-demo-sha256.json` 校验 ok。
- 反向验证（收口执行轮复跑，红→绿各一条实录）：①scoped 名绕权限门 → plugins-check F6 红 → 还原绿；②摘 token kind 归因 → 单测红 → 还原绿；③摘 sidechat 预算帽 → 单测红 → 还原绿；④`--bogus-root` 强制分支 A → 断言①红 exit 1 → 正常绿（`--force-available` 红相需沙箱不可用宿主，本环境不可构造）。
