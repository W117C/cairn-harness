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
- 门另跑：`autonomy-check` ✅（UNVERIFIED=1 暗卷无 key）、`ipc:check` ✅（分支 A 靶子修复）。
- ⚠️ **一条红，测过、不归我**：主树首跑 `panels-check` 报 1 项失败（日志被 tail 截掉没留下断言名），
  第二跑报 **B21 两条**（「键盘退路也不写确认位」实测 `onboarded=true` + 连带「第三次启动仍然弹」红）——
  这是**因果对**（Escape 把确认位写了盘 ⇒ 第三次当然不弹），形态不像时序抖动。
  但同码第三跑**全绿**，且为定性做了对照：干净 worktree（真 `node_modules`）里
  `8b48ee2`（无 guided）两跑全绿、`bbac176`（有 guided）两跑全绿 ⇒ **本笔被排除**；
  红只出现在被他会话在飞文件污染的主树（`package.json` / `scripts/gate-check.ts` / `src/frozen.ts` 等）。
  根因**未定位**，B21 的 Escape 落点是否会把焦点上的「完成引导」当成点击，留给下一次动引导向导的人查。

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

## 八、加档顺带照出来的第二件事：设置页那格「权限默认模式」根本没有消费者

给设置页补 `guided` 按钮时才发现：**那格控件在 2026-09-23 之前从未影响过一次执行**。

### 8.1 实测的假控件形状

三条独立事实叠成一个谎：

1. 设置页那格副标题写「新对话开始时使用的权限档」，`settings.mode` 在渲染层的**唯一**读取点是点亮
   按钮的 `aria-pressed`；
2. 权限看板的初值是 `let permMode = PERM_MODES[1]` —— 按**数组下标**取，不认设置；
3. `run` IPC 真发出去的档位来自 `app.js` 里另一份 `PERM_MAP` 字面量（行 id → 档位）。

⇒ 用户把它设成「严格审批」并重启，看板显示「标准」，而每一笔 run 仍按 `default` 送出。
这不是读代码读出来的，是给这一跳**建真窗口判据（panels-check B30）时**第一次有人观察
「盘上的 mode → 芯片上的字」而看到的：没有这条判据，这条通道可以一直绿着骗下去
（同 §四 那处文案谎一个根：**界面能选，不代表执行端在听**）。

### 8.2 修法：一只表 + 一处时机，两端都不再抄字面量

- 档位 ↔ 看板行 id 的别名表搬进 `projections.PERM_ROW_BY_MODE`，类型是
  `Record<AgentPermissionMode, string>` ⇒ **少一档编译不过**；反向表 `permModeMapByRow()` 由它派生，
  `app.js` 的 `PERM_MAP` 改成调用它（消掉第二份字面量）。
- 回灌时机收成 `seedPermRowId({ storedMode, currentRowId, userChose })`，三种情形都返回 `null`：
  ⑴ 用户刚手动点过 ⇒ 异步到达的设置不得撤销那一下；⑵ 设置认不出 ⇒ **不降级到默认档**（保持现场）；
  ⑶ 与当前行相同 ⇒ 不重复渲染、不弹「已切换」toast。
- 看板初值改按 id 查（`permRowById(PERM_DEFAULT_ROW)`）。旧写法 `PERM_MODES[1]` 今天仍对，
  但它对的原因是"下标 1 恰好还是标准"，不是"取的是标准"——`guided` 正是插在中间那一档。
- `permTouched` 只在人点的路径上立起来；启动回灌走 `{ silent: true }`，既不弹 toast 也不立旗
  （否则第二次及以后的设置变更再也进不来——这是"两边都别管"那种修法，被反向用例钉住）。

### 8.3 判卷：单测判形状，真窗口判那一跳

- `tests/renderer-perm-default-mode.test.ts` 9 条：正反两向互逆、看板行 id 集与别名表键集同源、
  认不出的五种输入（含原型键 `constructor`）都返回 `null`、回灌时机四格。
  其中"认不出不得回落到默认行"那格**故意**用 `currentRowId: "yolo" / "strict"` 写——
  全部拿 `PERM_DEFAULT_ROW` 当现值，这条判据就永远绿。
- 真窗口观察者 = `panels-check` **B30** 四格（四次启动，逐格打印实测文本）：
  设置 mode=read-only ⇒ 芯片「严格审批」；aria-label 同步换档（读屏看到的与眼睛看到的同一档）；
  设置里没有 mode ⇒ 留默认「标准权限」（反向一侧：证明上一条不是把芯片写死）；
  新档 `guided` 在产品面真选得出来 ⇒ 别名表少一行时这一格就是 `null`。
  "app.js 真的跑过"的证据用 `aria-label` 前缀 `权限模式：` 卡住——静态标记本身就能满足"标签非空"，
  只断非空等于没断（首版即为此假绿过一次）。

### 8.4 锚点：一条活着的锚点是怎么被自己抓出来的

新钉四条（旧的 `renderer-perm-map-copy-missing-mode` 随 `PERM_MAP` 搬走一并替换）：
别名表少一档、字面量抄回渲染层、回灌覆写用户选择、认不出时猜默认行。

按「提交 → 逐条跑新锚点」的顺序复跑时，第四条报 **变异存活**。原因不在判卷：针脚扎的是
`permRowIdForMode` 尾部 `return typeof row === 'string' ? row : null` 那条回落支，
而它上面已经有一道 `hasOwnProperty` 闸、表又由 `Record` 保证每档都是字符串 ⇒
**那条回落在所有测试可达的输入里根本进不去**，`?? PERM_DEFAULT_ROW` 与它语义等价。
改扎调用方 `const row = permRowIdForMode(opts.storedMode)` 后当场 ✅ 杀掉。

同格还留一条**刻意不钉针**的裁决（署名而非沉默）：「陌生档位不许被猜成默认」其实由两支**互为冗余**的闸
共同成立，单独撤掉任何一支行为一字不变 ⇒ 单行锚点在这里必然存活，写它等于写一条恒真锚点。
教训已收成记忆规则 109：**锚点存活先做可达性预检（什么输入能执行到这一行），冗余双闸不钉单行针。**

### 8.5 顺手量到的两条判卷面事实

- 改 `const PERM_MAP` 那一行**没有**惊动四支按标记切 `app.js` 的渲染层切片测
  （`renderer-session` / `renderer-workspace` / `renderer-history-live` / `renderer-panels-real-data`）——
  它们的切片区间不含该行。这是运气不是设计，所以记下来：下次把符号搬进 `projections` 之前，
  仍要先确认切片区间（规则 41/44/62 同族）。
- `panels-check` 首跑出现「只测新相、旧相全红」的形态（B20/B24/B26 + B30 一起红），
  而干净 worktree 同码全绿 ⇒ 真因是**陈旧的 Electron 仍占着按 pid 算出的 CDP 端口**，
  而 `requestSingleInstanceLock` 让新起的进程直接退出，于是 `Cdp.connect()` 读到的是**上一个窗口**。
  修法按「等状态不等事件」写成前置闸：起窗口的**次数**不再当判据，改成等端口空出来（12s 内不空即
  fail-visible 红并打印占着它的读数）。B23 这个标签已被"审阅页"那相占过 ⇒ 新相编到 B30。

### 8.6 追记（同日下一笔）：那条等待已经搬到唯一出口

上面这条等待当时**只写在 B30 那一相**，而 `panels-check` 有四个起窗点暴露同一个坑——
"同一件事只硬化一支"是本仓点名的同族缺陷。现已收成 `scripts/lib/cdp-port.ts`（三态 + 可注入时钟）
并由 `spawnElectron` 独家用；判卷 9 条、锚点 3 条、红侧当场造相各见 PROGRESS「能力 29」。
另记一条口径：本相的判据是"设置里的档位必须在真窗口里换掉芯片"——
主树后来出现的 3 格 B30 红由**同 HEAD 的真依赖 worktree 全绿**定名，不归本笔（触发器在另一会话在飞的渲染层改版里，机制未定位）。

