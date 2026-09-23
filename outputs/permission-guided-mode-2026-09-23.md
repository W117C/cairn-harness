# 第 4 档 `guided`：中间档落地（judgment-layer §7 第 1 步 / gap-fix P1-4）

日期：2026-09-23。用户裁决：**造中间档，默认档不动**。本页只记这一笔；
前序（档位集合收成唯一事实源）见 PROGRESS 能力 25，尺（`askByLayer`）见能力 24。

## 一、这一档到底是什么

一句话：**只拆「每一笔写向都要问」这一条，风险线反而比自主档严一级。**

| 档 | 写向 | 风险送审线 | 「本会话允许这类」 | critical / L0 / L1 / L2 / MCP 无注解 |
| --- | --- | --- | --- | --- |
| `read-only` | L0 摘除（deny） | high | 走不到（写向已摘） | 全部生效 |
| `default` | 逐笔问 | high | 生效 | 全部生效 |
| **`guided`（新）** | **不问** | **medium** | **生效** | **全部生效** |
| `auto` | 不问 | high | 不吃（无卡可跳） | 全部生效 |

`guided` 与两侧的距离都靠**实测**撑住，不靠文案：见 §三。

## 二、政策从 if 链换成一张表（这一笔的真身）

落地前 `evaluate` 的档位分支是 `if (s.mode === "default") … if (s.mode === "auto") …`。
**表外档位既不报错也不出卡**——它一路掉到 L4 风险层，静默拿到 auto 的行为。
RED 阶段当场量到：构造一个不存在的档位名，`write_file` 直接 `L4-pass` 放行
（那条用例在实现前**就是绿的**，因为放行本来就是旧代码对未知档的答案——这正是要钉的洞）。

现在是一张 `Record<PermissionMode, ModePolicy>`（`src/permissions/autonomy.ts`）：

```
"read-only": { writeAsk: true,  scopeMemory: true,  riskAskAt: "high",   label: "只读档" }
default:     { writeAsk: true,  scopeMemory: true,  riskAskAt: "high",   label: "默认档" }
guided:      { writeAsk: false, scopeMemory: true,  riskAskAt: "medium", label: "引导档" }
auto:        { writeAsk: false, scopeMemory: false, riskAskAt: "high",   label: "自主档" }
```

三个字段各自都有「只有这一档在此格给出不同答案」的用例（否则字段是装饰）：
`writeAsk` 分 default vs guided/auto；`scopeMemory` 分 default+guided vs auto；
`riskAskAt` 分 guided（medium）vs 其余（high）。缺行 = 编译不过；运行时兜底取**默认档**，不取最松档。

**出口顺序一字未动**（critical → 风险线 → MCP 未注解 → 网络）。换顺序会让同一调用换一层，
`askByLayer` 读数与既有判据一起漂——本笔只换「哪条线」，不换「谁先答」。

## 三、读数（同一把尺、同一份语料、改动前后各一次）

复跑：`node --import tsx scripts/replay/ask-density.ts`（19 files / 282 tool_call / **97 受管**）。

| 臂 | ask | askByLayer | 与能力 24 基线的差 |
| --- | --- | --- | --- |
| `read-only`（新臂） | 0 | — | 写向 89 条落 `risk=none:8 deny:89`（L0 摘除，不是放行） |
| `default` | **89** | `L3-mode:89` | **逐字不变** |
| `guided`（新臂） | **58** | `L4-risk:58` | 新档：出卡全部落在风险层，`L3-mode` 归零 |
| `auto` | **1** | `L4-risk:1` | **逐字不变** |
| `auto` + 沙箱不可用 | **89** | `L4-risk:89` | **逐字不变** |

三条承诺各自被数一次：
1. 「default / auto 不动」——三臂的 ask 数与层分布与基线完全一致（不是"没测到变化"，是同口径复跑）。
2. §7 第 1 步的**位置判据**成立：`L3-mode` 掉到底（89→0）、`L4-*` 非 0（58）——
   出卡从「档位规定要问人」挪到了「风险判要问人」，第 3 步的概率有了落点。
3. 中间档不是第二份默认档：`default` 89 vs `guided` 58 vs `auto` 1，三个数互不相同。

**诚实的边界（别把 58 读成"少了 35% 的麻烦"）**：
- 减下来的 31 次全在 `risk=none` 那一格（`write_file` 与低风险命令）；**`edit_file` 每次仍出卡**——
  静态威胁表给"编辑文件（写向操作）"底线 medium（`src/permissions/risk.ts:122`），medium 恰是 guided 的线。
  要把 edit_file 也降下来，得动**风险模型**（按路径/内容判写向），那是另一次裁决，不在本笔偷做。
- guided 稳态下的真实减免来自 `scopeMemory`：非 shell 工具的 scope 键是**工具级**
  （`scopeKey`），一次「本会话允许这类」之后同类写向不再问；断路器（50 连自动放行）触发后退回逐次审批。
- `read-only` 臂的 ask=0 **不是**低成本臂：它是 89 次 deny。

## 四、"少一份没跟上"这次全部变红的位置（接入面清单）

档位是四值之后，以下每一面都得跟；漏掉任何一面的后果都**不报错**，所以先立判卷再加值：

| 面 | 位置 | 谁在守 |
| --- | --- | --- |
| 集合与类型 | `src/permissions/modes.ts` | 事实源 |
| events 抄本 | `src/events/index.ts` | 单源对账用例 + 锚点 |
| 粗档裁决表 | `SIDE_EFFECT_DECISION` | 编译（Record）+ 用例 |
| 细档政策表 | `MODE_POLICY`（新） | 编译 + 4 条锚点 |
| worker 名次 | `clampTier` | **删掉本地数字表**，改读 `permissionModeRank`（用例 + 源码对账用例） |
| remember 门 | `createGatedRemember` | if 链 → 表；未知档 fail-closed（2 条用例 + 1 锚点） |
| 插件 hook 档位 | `plugins/hooks.ts`、`plugins/index.ts` | tsc（两份三值 union 收成 `PermissionMode`） |
| 设置页 | `index.html` `data-setting="mode"` | 渲染层对账用例 |
| 权限看板 | `app.js` `PERM_MODES` + `PERM_MAP` | 同上（+ 1 锚点钉 `PERM_MAP`） |
| 复跑面 | `ask-density` `ARMS` | 用例（臂覆盖每档）+ 脚本内运行时守卫 + 1 锚点 |
| 工具表面 | `tests/session-tools.test.ts` | `it.each` 改成从 `PERMISSION_MODES` 取（原先手抄三档 = 新档零观测者） |

两处「刻意不做」要有名字：
- **断路器在 `auto` 零作用面**：`noteScopeApproval` 只在 `L3-scope` 放行时计数，而 auto 不吃 scope ⇒
  计数永不涨。本笔不动（动它 = 改 auto 语义）。留此名，下次量产后单裁。
- **`L4-network` 在 guided 不可达**：guided 的线已是 medium，网络命令（≥medium）先被风险层拦下 ⇒
  该出口服务的是 auto。用例只钉可达侧（guided 的网络命令断"出卡"，不假装断层名）。

## 五、判卷与锚点

- 新 `tests/permission-mode-guided.test.ts` 19 条（4 describe）；`tests/remember.test.ts` 5→**7** 条；
  `tests/permission-mode-single-source.test.ts` 的名次/表两处期望随集合更新（这正是它们存在的意义）。
- 锚点 795 → **803**（+8）：guided 风险线 / guided scope / default writeAsk / 表外兜底 /
  clampTier 第二份表 / 复跑臂 / `PERM_MAP` 抄本 / remember if 链回潮。
- 针脚体检：803 条，改法语法体检全 ✅；在飞期间「钉在飞文本 9 + 未入库面 7 = 阻断 16」，
  全部是"锚点已写、被锚定的实现还没进 HEAD"这一族 ⇒ 提交后必须复跑归零（见 §六）。
- 一条新踩的坑（已写进锚点注释）：**html 面不能做锚点**。`mutantSyntaxProblem` 用
  `ts.transpileModule` 检查改法产物，整份 `index.html` 在它眼里就是语法错 ⇒
  任何 `src: "*.html"` 的锚点必然被判「改法致语法错」。设置页按钮仍由对账用例覆盖。

## 六、验证

- `pnpm typecheck`：0 错。新增值后 tsc **主动叫醒三处**（`clampTier` 的 `Record<AgentPermissionMode, number>`、
  两份插件 hook union）——这就是"表外即编译错"想要的形状。
- 全量 `test`（主树，含他人在飞文件）：216 files / 2316 tests 全绿，exit 0。
- **HEAD-only 复跑（同提交 `bbac176`，干净树 + `cp -al node_modules` 真依赖）**：
  tsc 0 错 · 全量 `test` **215 files / 2311 tests 全绿**（与主树差的 1 file / 5 tests 是别人未跟踪的
  `tests/arch-boundary.test.ts`，不在 HEAD）· 针脚体检 **803 条、阻断 0、钉在飞文本 0、未入库面 0**、
  改法语法体检全 ✅。提交前同一道门报的是「阻断 16 = 钉在飞文本 9 + 未入库面 7」，
  提交后归零——这条正是"锚点门读盘 ⇒ 对在飞态诚实、对 HEAD 归属也诚实"的两侧读数，留作该族判据的样本。
- ⚠️ §三的读数**只能在主树复跑**：`scripts/replay/ask-density.ts` 的语料含 `~/Library/Application Support/m0-agent-loop/sessions`
  （会话流不进 git）。在干净 worktree 里它按 P0-1 的三态守卫**红着退出 1** 并说清扫了哪些根——
  那是正确行为，不是命令坏了（换到有历史会话的树上再跑）。
- 邻域先跑：`permission-mode-guided` 19/19、`permission-mode-single-source` 8/8、`remember` 25/25、
  `gate-audit` 31/31（`GATE_LAYERS` 穷尽断言未动）。

## 七、待用户批准（本笔未动）

`agent-plan.md:1442` 写「**不做六档**：…我们三档已覆盖同语义面」，§11.7.2 是**三档矩阵**。
中间档不是搬回那六档，是补 §3.4 实测出的空格（default=每写必问、auto=每写必放、中间无），
但它确实让"三档"这句失效。按 §3.7 最小 diff 流程，建议改法（**未落盘，等批准**）：

```diff
-（§11.7.2 三档矩阵：read-only / default / auto）
+（§11.7.2 四档矩阵：read-only / default / guided / auto）
+  guided：写向不逐笔问；风险≥medium 送审；scope 记忆与断路器同 default；
+          L0/L1/L2/critical/MCP 无注解 fail-closed 一律照旧。
```
以及 `:1442` 那行「我们三档已覆盖同语义面」→ 改为「三档曾覆盖 §3.4 实测的全部语义面；
guided 补的是实测出来的中间空格（默认档 89/89 出卡在 L3-mode），不是 CLI 模式堆叠」。
