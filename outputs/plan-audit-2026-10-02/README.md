# 计划书全面检查（2026-10-02 03:20 · 会话 296 之后）

**一句话结论：计划书没跑完。**
**M0–M9 主体落地（9 格都有代码 + 判卷 + 凭证目录），但 M10 只交了 1/3；
计划书自己那 5 条「总验收」有 2 条不成立——31 道门只绿 25，「至少 6 条能力升级」没人复测过。**
另有 **1 个实测出来的新缺陷**（源文件带 NUL 字节 ⇒ 模型自己的 `grep` 搜不到它）。

---

## 一、逐模块状态

| 模块 | 状态 | 关键证据 | 缺口 |
|---|---|---|---|
| **M0** 度量底座 | ✅ | `fixtures/bench/tasks.json` **12 条**；`scripts/eval/report.ts` 321 行；噪声带实测两次跑；反向验证 6 红 / 2 红已贴 | ❌ 计划书 §9.1 点名要的 **`--reps 3` × 12 条读数没有**（只有 `--reps 2 --only B1,B6` 两条） |
| **M1** 仓库级理解 | ✅ | go/java 进图（`PATTERNS`）；`fixtures/impact/accuracy-repo-multilang/`；`tests/impact-multilang.test.ts` 100 行；冷建 ≈1200ms vs 索引命中的读数在 `outputs/impact-index-2026-10-01/readings.md:45` | 页 262 点名的 `idx-timing.mts` **没提交**（见 §三-②） |
| **M2** 精确编辑 | ✅ | `src/tools/apply_patch.ts` 297 行；五面接线（`TOOL_NAMES`/`TOOLS`/`glm-session` 规格/`SIDE_EFFECT_TOOLS`/门包装——**不含 `INJECTED_TOOLS`，那是因为它走静态面，对的**）；`tests/apply-patch.test.ts` 464 行；真仓 200 笔逐字节 0 差；反向验证日志 4 份 | — |
| **M3** 工具与环境 | ✅ | `src/tools/diagnose.ts` 124 行 + `web_search`；`tests/diagnose.test.ts` 230 行；`README.md:210` 有「网络与沙箱边界」一节 | ⚠️ 该笔搬走了 `autonomy.ts` 里一行锚点针脚却没改指（见 §三-③） |
| **M4** 长程规划 | ⚠️ **部分** | 调度器真入口 `m0 --serve` 落地 + `tests/scheduler-wiring.test.ts`；`initScheduler` 有了首个生产调用者 | ❌ 交付物「跑一条 **≥30 轮**任务、记录**目标漂移**次数」——**"目标漂移"全仓只在计划书里出现，没有任何读数**。台账第 294 页也自认：「路线图**差距 2**（长任务中途没有周期性自检）……**不在本笔**」 |
| **M5** 验证闭环 ★ | ✅ | `src/agent/verify.ts:76-80` 探到 **typecheck 面**（并写明"刻意不探 lint"的理由）；`verify.ts:101/362` 重复 N 次 → **换策略**升级处置；`tests/verify-multiface.test.ts` 293 行 | — |
| **M6** 记忆跨会话 | ✅ | `src/agent/memory/lessons.ts` 247 行，条目带 `session#callId` 证据指针；`tests/memory-lessons.test.ts` 340 行 | ⚠️ ①**该文件带 NUL 字节**（见 §三-①）；②`mutate-verify` 门超时**照贴未证**（他们自己登记了，这点做得对） |
| **M7** 安全与权限 | ✅（**换了位置**） | `src/permissions/tool-registry.ts` 46 行权威白名单；`autonomy.ts:435` 未登记名字 **fail-closed**；`loop.ts:426/491` 会话闸 `blockedBy:"unknown-tool"` | 计划书建议改 `checkPermission` 第一行——那处**加了又撤回**，理由写在代码里（会与 `loop.ts` 判两遍、且拿不到会话工具表 ⇒ 两条判卷红）。**方向对、位置不同，属正当偏离** |
| **M8** 人机协作 | ✅ | `m0 --fork` / `--replay` 两扇入口（`src/cli.ts:156/158/191`）；worker diff 逐文件接受/拒绝；`tests/cli-fork-replay.test.ts` 246 行；反向验证日志 4 份 | — |
| **M9** 工程化 | ✅ | `.github/workflows/verify.yml`；`scripts/ci/README.md` 67 行（含两道被排除的门逐条登记）；L2 pre-commit 已裁决不做 | ⚠️ CI 本机验不了（他们如实标注了） |
| **M10** 防降智与架构 | ⚠️ **1/3** | ①降智信号清单 ✅（6 条，4 条已修）②`no-progress` 接线 ❌ **仍 0 个生产消费者** ③拆分 ⏸️ 分支 `feat/m10-split-prompt-face` **未合并**（`src/agent/system-prompt.ts` 不存在） | 见 §四 |

---

## 二、计划书 §9「总验收」5 条，逐条对

| # | 要求 | 判定 | 依据 |
|---|---|---|---|
| 1 | `pnpm bench -- --reps 3` 在 ≥12 条上给四读数 + `report.ts` 判噪声带 | ⚠️ **部分** | 工具全在（12 条任务、四读数、噪声带判定 + 反向验证）；**但 `--reps 3` × 12 条的读数不存在**（`outputs/eval-reps-check` 只有 2 条任务） |
| 2 | 十条能力至少 **6 条**从"部分"升到"已实现"（按审计口径复测） | ❌ **未验证** | 模块都落地了，但 **`outputs/` 下没有任何"落地后复测"的再审计**——只有 10-01 那批**旧**审计（`_audit2-*`，在模块落地前写的）。**"改了"不等于"按原口径复测过"** |
| 3 | 每一条"防降智"结论都有反向验证 | ⚠️ **部分** | M2/M5/M7/M8 有反向验证日志；M6 的 `mutate-verify` **超时照贴**；**M10② 压根没接线 ⇒ 无从反向验证** |
| 4 | 全量判卷 ≥3,512 且全绿；**31 道门全绿** | ❌ **不成立** | 全量 **3684 条**（条数达标）**但 2 红**；31 道门 **绿 25 / 红 6** |
| 5 | ≥1 条真模型外部基准读数，或明确登记"因无凭据未做" | ✅ | `outputs/impact-index-2026-10-01/readings.md:52`：「能力 10（真模型基准）**无凭据，未做**——沿用 258 页裁决④「不造假读数」」 |

---

## 三、31 道门那 6 条红，逐条定性（**这条比"红了"重要**）

| 门 | 退出码 | 定性 | 谁的红 |
|---|---:|---|---|
| `test` | 1 | **已入库的红**（`src/cli.ts` 无在飞改动） | 见下 ① |
| `docs-check` | 1 | **已入库的红** | 见下 ② |
| `gate-check` | 1 | **登记的已知红**（H7 冻结表 ↔ `fixtures/impact/accuracy-repo/*`，任务 #9） | 计划书签过字 |
| `mutate-needles-check` | 1 | **3 条锚点失针，逐条点了搬走它的提交** | 见下 ③ |
| `mutate-verify` | **124（超时）** | 20 分钟预算打满；M6 的证据里**主动照贴为超时**，没写成全绿 | 已知性能账 |
| `head-cert-check` | 1 | 220 秒跑完判红；判卷本来就红（同 ①②），属**级联** | ①② 的果 |

### ① `test` 红在 `tests/cli-surface.test.ts`——**Ctrl-C 的纪律被弄反了**

```
AssertionError: expected 9751 to be greater than 9892
FAIL tests/cli-surface.test.ts > … > 第一次请 run 收束、第二次才硬退——硬退那一支必须整个在 `cancelling` 守卫里
```

这是**源文本位置断言**（看两个标记在源码里的先后）。现在"硬退那一支"跑到了 `cancelling` 守卫**前面** ⇒
**第一次 Ctrl-C 就可能硬退**，而事件流在退出前来不及收束 = **转录对不上账**（这条纪律的存在理由）。
`src/cli.ts` 没有在飞改动 ⇒ **这是入库的回归**，不是别人正在修的东西。

### ② `docs-check` 红在 D-11——**一页点名的证人没提交**

```
❌ D-11 PROGRESS.md
   第 262 页 点名 outputs/impact-index-2026-10-01/idx-timing.mts，但 HEAD 里追不到
```

那个文件**就躺在盘上没提交**（`git status` 里的 `??`）。**修法是 `git add` 它，不是改判据**——
门的原话也这么写：「证人要与页同笔落库；这一格若由本笔未提交的工件造成，**提交即归零**，别当成旧账登记掉」。
同一根因还红了一条判卷（`tests/docs-check.test.ts` 的"真仓那一趟"）。

### ③ `mutate-needles-check`——**3 条锚点失针，门自己点了凶手的名**

| 锚点 | 被谁搬走的 |
|---|---|
| `sandbox-mapping-copy-reintroduced` | `404249c`（修 verify 假红那笔） |
| `openai-never-reads-finish-reason` | `e76ed13`（P2 流内 5xx 重试那笔） |
| `webfetch-network-scope-memory-dropped` | **`0b37ad2`（M3 那笔）** |

**这正是我上一笔（M10 拆分）专门去还的那类账**：搬代码必须同步改指锚点。
有人显然计划过——M1 的提交信息写着"阻断 5 归其他会话提交（`4c10272`/`404249c`/`e76ed13`/`0b37ad2`），**各自作者改指**"——
**但至今 3 条没改指**。⇒ 这类账只要"各自的作者"没空还，就会一直挂在那儿。

---

## 四、M10 为什么只算 1/3

| 交付物（计划书原文） | 状态 |
|---|---|
| 降智信号清点（信号 → 谁会误读 → 判据），逐一处置 | ✅ `outputs/m10-degradation-signals-2026-10-01/`（6 条，4 条已修） |
| **把 `no-progress` 接进运行循环**（配判卷 + 反向验证） | ❌ **实测仍是 0 个生产消费者**（`grep` 全 `src/`，除自己以外零命中）。我只交了**接线请求**，接线点在 `loop.ts`（M5 写范围） |
| 拆分（只做一轮）行数与扇入读数改善 | ⏸️ **代码在分支 `feat/m10-split-prompt-face`（两笔），从未合并**（`zcode` 自基点没动过、干跑 `merge-tree` 零冲突）。只有读数在主树 |

---

## 五、一个新发现的实测缺陷（不是猜的）

**`src/agent/memory/lessons.ts` 第 198 行有一个裸 NUL 字节**（`"\x00"` 而非转义写法），
后果是 **ripgrep 把这个文件当二进制、整份跳过**：

```
$ file src/agent/memory/lessons.ts        → data        # 不是 text
$ rg "const sig = c\.name" src/           → No matches found   # 而它就在第 198 行
```

**为什么这条要紧**：harness 自己的 `grep` 工具**就是用 ripgrep**（`src/tools/grep.ts:3` → `runRgJson`）。
⇒ **模型在这个仓库里搜代码，搜不到这个文件的内容**；人用 `rg` 审也会漏掉它。
全仓扫描：`src/`+`scripts/`+`tests/` 的已跟踪文本文件里**只有这 1 个**带 NUL。

**修法**：把那个裸字节写成转义（`"\u0000"`），或换一个可见分隔符。**一行。**

---

## 六、挂着的状态（不是红，但会咬人）

1. **`scripts/docs-check.ts` 在飞 8 小时**（最后修改 10-01 18:48，现在 10-02 02:44）。它带着一条**没有判卷的新规则 D-12**（省略式点名，帽 7）；我补的 2 行类型管道撑着 `typecheck` 绿。**别人的笔，我没动它、也没提交它。**
2. **`idx-timing.mts` 未提交**（见 §三-②）。
3. **`docs-check.ts` D-12 零判卷**：新规则进了门，`tests/` 里没有任何一条测它（`grep checkAbbrevRefs|D-12` 0 命中）。
4. 工作树 **98 棵**（我上笔回收了自己那棵）。

---

## 七、计划书之外的新工作流（不算计划书的账，但要让你知道）

`0375034` 之后进来了 **桌面端 Electron 驾驶舱**：`apps/desktop`（Electron 38 + React 18 + Vite 7）+
设计 spec `docs/superpowers/specs/2026-10-02-desktop-shell-design.md`，四笔提交（`49888b6`→`e2828a8`）。
它**不在 M0–M10 里**，是另一条线；`e2828a8` 的提交信息称"根门不受影响"——**但这几笔落地后 `test`/`docs-check` 是红的**，我没能证明"不受影响"。

---

## 八、要修的话，按这个顺序（都不大）

| # | 修什么 | 代价 | 谁 |
|---|---|---|---|
| 1 | `git add outputs/impact-index-2026-10-01/idx-timing.mts` ⇒ `docs-check` 与那条判卷同时转绿 | 一条命令 | 页 262 的作者 |
| 2 | `src/cli.ts` 把"硬退那一支"挪回 `cancelling` 守卫里（或按新语义改判据并说明理由） | 小 | 动过 CLI 的那笔的作者 |
| 3 | 3 条失针锚点改指到新位置（`gate-check`/`mutate-needles-check` 的同类账） | 机械 | 三条各自的作者 |
| 4 | `lessons.ts` 的裸 NUL 写成转义 | 一行 | M6 作者 |
| 5 | M10②：把 `no-progress` 接进 `loop.ts`（接线请求在 `outputs/m10-degradation-signals-2026-10-01/` §五之二） | 中 | M5/集成 owner |
| 6 | M10③：合并 `feat/m10-split-prompt-face`（干跑零冲突） | 一条命令 | 集成 owner（你） |
| 7 | M4：补"≥30 轮 + 目标漂移"读数 | 中（要真模型长跑） | M4 作者 |
| 8 | §9.2：按原审计口径**复测十条能力**，给出"哪几条升了" | 大 | 你派人 |

---

## 九、诚实标注

- 这份检查**没跑 31 道门之外的东西**：`head-cert-check` 我只看了退出码与耗时，没逐条读它的输出；
  `mutate-verify` 是**超时**（124），不代表"内容红"。
- §三-①/② 的"已入库"判定依据是：`git status` 里 `src/cli.ts` 与 `PROGRESS.md` **都没有在飞改动**，
  所以那两条红只可能来自已提交的内容。这个推理我贴了命令输出，但没有逐笔 bisect 到具体提交。
- §二-2「能力复测」我判"未验证"而不是"没做"——**我没找到复测产物，但这不等于没人做过**（可能做在别的会话里没落盘）。
- "桌面端不受影响"我没能证实也没能证伪：我这轮门表是红的，无法用它当"受影响/不受影响"的证据。

*检查方式：全表 `node --import tsx scripts/gates.ts`（31 道，含 mutate-verify 20 分钟超时）；全量 `vitest run`；
逐模块对着计划书原文核工件是否真的存在；对可疑处一律实测复现（`file`/`rg`/`git log --oneline`/`merge-tree` 干跑）。
本报告**没有修改任何产品源码**。*
