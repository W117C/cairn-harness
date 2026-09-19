# 文档分层与字数预算 · 设计（spec）

日期：2026-09-19 · 分支：`codex/dsh-structural-hardening` · 状态：**设计已批，执行待主会话在飞簇收口**
作者口径：本文件是**施工清单**。它自己不豁免于自己定的规矩——文中所有观测值都带 `[obs]` 标记 + 复跑命令，
且本文件落 `docs/superpowers/specs/`（属 L3，日期即版本），**不进每轮上下文**。

## 0. 问题（实测，非推断）

散文从资产变负债。四条**机制**在长，不是"某份文档恰好长了"：

| # | 机制 | 证据（复跑命令见右列语义） |
|---|---|---|
| M-1 | **账本与规矩同体**：AGENTS.md 62% 的字节是"当前状态"段（`awk '/^## 当前状态/{f=1} f' AGENTS.md \| wc -c` vs `wc -c AGENTS.md`） | 每轮自动进上下文的文件里，多数内容是**上一轮的历史** |
| M-2 | **纯追加、零删除**：`git log --numstat -- PROGRESS.md` 连续多轮 均为 `+N / -0` | 没有任何收缩压力；三份文档 `[obs]` 26KB / 235KB / 100KB |
| M-3 | **就地追注代替改写**："⚠️ 上面那句已过期，但当日快照不得改写"（AGENTS.md 环境注意/当前状态多处） | 后果不是长，是**真相不可判定**——同一段里两个值并存，读到哪条算哪条 |
| M-4 | **手抄机器已算出的量**：`scripts/gates.ts:64-71` 已产出每道门 `{name, code, ms}`，AGENTS.md 仍写死 "~800s" 的 test 门 | 同一行 15 倍漂（本 spec 复跑前，用户 2026-09-19 独立实测该门 52s）——根因是**宿主负载相关量被抄成了常量** |

同类病灶（本轮只登记、不处理）：`agent-plan.md` 223KB / `agent-plan.bak-0908.md` 193KB /
根目录 `overview*.md` 三份 dated 快照 / `outputs/` 33 份 10MB / `docs/*.png` 25 张 React 时代截图
（`docs/README.md` 自己已声明全部过时，且用一张散文表登记散文的过时——该表本身在自我膨胀）。

**已有正确先例，但它也漂**：`docs/ui-fact-baseline.md` 的口径（"本页只放实测数字 + 各自复跑命令"）
就是本设计要泛化的东西。它页首自证：20 行里 5 行**隔日复跑即变**，且 F4 原值「1」是"自证过度"。
⇒ 结论：**值与命令并排手抄**仍会漂；必须让值**由命令生成**。

## 1. 目标 / 非目标

目标：① 每轮必进上下文的字节砍一个量级；② "读到哪条算哪条"变成**结构上不可能**（过期字无法存在于现行层）；
③ 观测值不再手抄，改由生成物承载；④ 上述三条由一道门守住，不靠自觉。

非目标：不动代码/测试/门禁逻辑（除 §5 四处文档指针与 §8 一处截图落点）；不改 `agent-plan.md`；
不追求"文档更少信息"——档案层一字不改，只是**换个读取默认值**。

## 2. 分层契约

| 层 | 文件 | 预算（docs-check 硬门） | 写入语义 | 默认进上下文 |
|---|---|---|---|---|
| **L0 规矩** | `AGENTS.md` | **8,000 B** 棘轮 | 只写"不知道就会这一轮做错事"的规则。**零状态、零观测值** | 是（harness 自动） |
| **L1 现态** | `STATE.md`（新） | **6,000 B** 棘轮 | **整体重写，永不追加**；首部含 `rev: <sha>` | 开工按需读一次 |
| **L2 档案** | `archive/{progress,blocked,reports}.md` | 无 | **只追加不改写**（不可变） | 否；按锚点 grep |
| **L3 说明** | `docs/**`、`agent-plan.md` | 无（但受 §4/§5 判据） | 生成物不手写 | 否；按节 fetch |

L0 段落去向（六段实测占比：怎么跑 4% / 技术栈 4% / 目录与约定 2% / 环境注意 20% / 判卷纪律 5% / **当前状态 62%**）：
预算不是一次拍出来的：去掉 当前状态 段即 ~10KB，再把 环境注意 里的日期叙述压成规则本体，落点 ~7KB ⇒
**8,000B 是"装得下且留 12% 余量"**。装不下时的合规答案是继续往 archive 挪，**不是放宽预算**（§6 棘轮）。

- **留 L0**：怎么跑（命令）、目录与约定、判卷纪律、环境注意里**去掉日期叙述后的规则本体**
  （safe-delete 逃生舱及其 `state dir` 原理、沙箱内跑不了 `pnpm test`、`--no-sandbox` 探测、
  底栏节点格式契约、BSD grep 三扩展静默失效、提交前相交检查、renderer 预览须走 vite）。
- **出 L0**：当前状态整段 → L1 现态 + L2 档案；技术栈的 React 归档史 → L2；
  所有 flake/时序归因史（panels-check 三连跑那类）→ L2，L0 只留一句"该门有已观测 flake，单跑复验优先，见 `archive/progress.md#<锚点>`"。
- **新增 L0 一张 4 行 role 表**：哪层写什么、过期字只能出现在哪、每轮该读哪层。
  这是防"下一轮又新建一份 PROGRESS.md"的唯一 L0 位置。

## 2.1 STATE.md 骨架（唯一必填形状，超出即红）

`STATE.md` 只允许这四段，**每段一行一条、一条一个指针**，正文不展开推理（推理归 archive）：

```
rev: <sha>            # D-5 校验其真存在
## 在飞原子簇          # 文件清单 + 归属会话 + 拆开会不会致 HEAD 悬空（本仓最贵的坑，独占一段）
## 开放裁决            # 只放**未结案**条目；结案即从本段删除，正文进 archive/blocked.md#<标签>
## 下一步（≤3 条）
## 未证面              # 由 pnpm facts 生成，不手抄（哪些断言因联网/凭据没跑到）
```

`archive/blocked.md` 的"待裁决/已结案"是审计面，`STATE.md ## 开放裁决` 是行动面——**同一个裁决只在前者留全文、
后者留一行**，这是本设计里最容易写回双份的地方，故 D-1 预算 + "整体重写"语义共同兜住。

## 3. 语义替换（本设计的关键，不是排版）

M-3 的死结是：团队要审计链（"当日快照改写即伪造历史"），于是用**追加反驳段**来纠错 ⇒ 文档永不收缩且真相要顺读全文。

拆法是把两个东西分成两个物理文件：

- **archive 不可变** ⇒ 你要的审计价值原样保住，一字不改（`git mv`，非 `git add` 新写）。
- **STATE.md 不是历史** ⇒ 所以重写它不构成伪造；过期句子当场消失，不需要留第二句去反驳第一句。

L1 超预算的**唯一**合规瘦法：把仍有下游价值的结论**迁进 archive 对应里程碑段**，然后重写。
不是"字号调小"、不是"分两栏"、不是加 `## 附录`。docs-check 的 D-4 判据（§6）就是钉这条的。

## 4. 观测值：生成，不抄

`pnpm gates` 已在内存里持有 `{name, code, ms, output}`（`scripts/gates.ts:71`）。改为**顺带落一份**：

- `docs/facts/gates.json`：每条 `{ts, host, gate, exit, ms, unverified}`；按门保留最近 N 次的**环形上限**
  （N 由该文件内常量给出，防它自己长成第三份账本）。这是**生成物**：`.gitignore` 掉，不入库、不 review、不进上下文。
- `pnpm facts`（新，只读）：打印每道门最近一次 exit/ms/未证 + 未证合计；`pnpm facts --all` 打环形全量。
  ⇒ **读真值的代价 = 一条命令，不是一份文件。**
- **D-2 适用面 = "现行层"**：`AGENTS.md` + `STATE.md` + `docs/` 根下被 L0/L1 指针可达的现行页
  （`README.md`、`CODE-WIKI.md`、`ui-fact-baseline.md`）。**豁免**：`archive/**`（不可变历史）、
  `docs/superpowers/specs/**`（文件名含日期 ⇒ 日期即版本，其观测值不需再漂）、`docs/m*-acceptance.md`
  （判卷证据，本仓纪律"只读不改"）。判据是**可达性**不是"重要不重要"：不在豁免表且被现行层指向 → 受管。
  受管页里要表达"这门慢"，写 `pnpm facts` 指针而不是值。
- `docs/ui-fact-baseline.md` 保留人写口径与局限说明，但每行的**值**改由该页登记的复跑命令生成
  （`pnpm facts --ui`）；页首"隔日 5/20 漂移"的自证段随生成化删除——生成物不存在抄错。

## 5. 指针语法：禁行号

四处代码在用**行号**引用文档（`scripts/renderer-arch-check.ts`、`scripts/a11y-check.ts`、
`scripts/lib/harness.ts` 两处，均引 `BLOCKED.md:432`）。重排即静默打断，且没有任何门会知道。

改法：`archive/blocked.md#<既有标签>`。仓里已有 MAINT-06 / G-1 / G-2 / H4 这类标签，
**不新造 ID 体系**（新造 = 又一层要维护的表）。规则一句话：
**文档指针用标签，不用行号；标签不存在即门红（§6 D-6）。** 本 spec 描述那四处时也只给文件名、不给行号——
行号会在它被读到的那天之前漂掉。

## 6. `docs-check` 门（进 `scripts/gate-manifest.ts` 的 GATES，红即阻断）

判据一律写在 JS 侧（本仓既有纪律：BSD grep 的 `\b \s \|` 静默返空）。

| # | 判据 | 红相 | 放行通道 | 已知弱点（诚实记） |
|---|---|---|---|---|
| D-1 | L0 ≤8,000B、L1 ≤6,000B | 超标即红，**打印实测字节数** | 无（只能瘦） | — |
| D-2 | **现行层**（§4 定义，含其豁免表）出现"数字 + 时长/条数/体积单位" | 红 | 行内 `[facts]` 标记；**带比较符的规格阈值**（`≤` `≥` `<` `>` `上限` `阈值` `至少`）永不判红 | 靠**前缀排除**而非观测词：实测 "~800s 的 test 门" 这句**不含任何观测词**，若按"实测/耗时"字样匹配就会漏掉真实病灶（设计时已用它当反例校准） |
| D-3 | `src\|scripts\|tests` 里 `[\w.-]+\.md:\d+` | 红 | 无 | — |
| D-4 | L0/L1 出现追注模式（"已过期"/"上面那句"/"不表示当前值"/"当日快照"） | 红 | 无——这类字只准存在于 archive | 词表要随真实用法补；漏判由 D-1 预算兜底（追注必然涨字节） |
| D-5 | `STATE.md` 含 `rev: <sha>` 且该 sha 在 git 里存在 | 红 | — | 只证 sha 真，不证内容新（新鲜度靠 D-1 + 整体重写语义） |
| D-6 | 文档内锚点 `foo.md#bar` 的 bar 在目标文件里不存在；或指向不存在的文件 | 红 | — | 锚点匹配大小写/标点需与 GitHub 规则一致，先只校"文件存在 + 标签串存在" |
| D-7 | `docs/` 下存在 `*.png` | 红 | 无 | 需同步改 `scripts/panels-check.ts` 的 `M1E_SCREENSHOT` 落点 → `outputs/`；不改则红在既有流程上 |

预算常量单一落点在 `scripts/docs-check.ts` 顶部，**只准下调不准调高**（棘轮）。放宽 = 一次裁决，写进
`archive/blocked.md` 并等领导裁决，不接受"就先放宽一点点"。
门禁语义沿用本仓既有风格：红必须带实测数字（fail-visible），**不允许真空通过**。

## 7. 测试与变异锚点

- `tests/docs-check.test.ts`：判据是纯函数（输入字符串/文件树 → findings），**不触真实文档**即可全量断言。
  每条 D 都要**双向**用例（红相命中 + 反相不误伤），尤其 D-2 的"阈值放行 vs 观测判红"。
- 变异表：`scripts/mutate-verify.mjs` 的 `MUTATIONS` 追加锚点（预算比较符翻转、规格前缀豁免漏计、
  锚点存在性判据短路），沿用"存活即红"的既有语义。
  ⚠️ 该门拒收在飞/未跟踪文件（`mutate-verify.mjs` 内的 tracked/diff 双闸），故锚点**入库后**才生效——
  这是正确红，不是回归。

## 8. 迁移：一个原子提交

本仓有实踩过"拆开提交必致 HEAD 悬空"的教训（归档一个模块时，新定义位置 + importer 改指 + 依赖变更
不同提交 ⇒ 单独 checkout HEAD 即坏）。本迁移的 importer 面恰好覆盖代码 + 门禁，**必须同提交**：

```
git mv PROGRESS.md  archive/progress.md      # 一字不改
git mv BLOCKED.md   archive/blocked.md       # 一字不改
git mv outputs/<dated>.md … archive/reports/ # 清单不手选：= D-6 跑出的「被现行层指向」集合
git mv docs/*.png   docs/archive-shots/
新增 STATE.md · 重写 AGENTS.md · 重写 docs/README.md（过时登记表删，改为 role 表指针）
新增 scripts/docs-check.ts + scripts/facts.ts
scripts/gates.ts 落 facts/gates.json · .gitignore 加 docs/facts/
scripts/gate-manifest.ts 登记 docs-check · package.json 加 docs:check / facts
改 4 处代码指针为标签（§5）· 改 panels-check 截图落点（D-7）
新增 tests/docs-check.test.ts · mutate-verify 追加锚点
```

**验证（按本仓既有手法，逐条要有退出码）**：
① `git worktree add <tmp> HEAD` + 在 tmp 里 `pnpm typecheck`（抓悬空 importer，一次性抓全）；
② `pnpm run docs-check` 绿；③ **反向验证**：临时把 `STATE.md` 撑到超预算 → 必须红且打印实测字节；
临时往 `AGENTS.md` 塞一句 `test 门实测 800s` → D-2 必须红；把某代码指针改回 `x.md:12` → D-3 必须红；
④ `TERM=dumb pnpm gates` 逐道退出码全 0（panels-check 若报滚动/CDP 类红，先单跑复验再判回归——
本仓已实证该门有宿主负载 flake）；⑤ 迁移提交后立刻复跑 `pnpm facts`，确认 facts 里没有 hand-copy 值。

## 9. 验收标准（不抄数字，只给判据）

1. 一个全新会话，默认读入的规矩面 = `AGENTS.md` 一份，且 ≤ D-1 预算。
2. 想知道"当前在哪/在飞什么/还有什么没裁" → 只需 `STATE.md` 一份，≤ D-1 预算。
3. 全仓现行层**不存在**任何可漂的观测值（D-2 绿）；`pnpm facts` 能给出门的真实耗时。
4. 现行层里**找不到**"已过期/上面那句"式追注（D-4 绿），但 archive 内容逐字未变
   （`git diff --stat <迁移提交>^ <迁移提交> -- archive/` 只显示 rename，不显示改动行）。
5. 下一轮追加时超预算会红（用 ③ 的反向验证已证）。

## 10. 已声明代价

- **L1 丢"当前状态自己的历史"**：每次整体重写，旧现态只活在其那个提交的 `git log STATE.md` 里。
  缓解即 §3 的瘦法（有价值的结论迁 archive），但**确有丢失面**：跨轮"当时我以为如何"的推理轨迹会消失。
  这条是本设计与 M-3 团队价值观的**唯一实质摩擦点**，需领导确认。
- **纪律 → 机制的迁移不彻底**：D-1/D-2 能机械守住预算与抄数；"该写进哪一层"守不住——
  靠 L0 role 表，主会话习惯往 PROGRESS.md 追加的惯性仍在（该文件迁移后不存在，误写会新建，D-1 抓不到未跟踪文件）。
  可选加固：`gate-check` 侧加一条"根目录不得出现 `PROGRESS.md`/`BLOCKED.md`/新 dated 快照名"（本轮留位，未纳入 §8 清单）。
- **一次性人力**：AGENTS.md 逐段拆分要判"这条是规矩还是历史"，边界不少（如 panels-check flake 整段——
  规则本体留、归因史走 archive）。这部分不可自动代劳。
- **docs-check 有假阳性面**：D-2 的词法判据最弱，靠 `[facts]` 标记逃生；标记滥用会把门空转，
  故 D-2 的红相计数进 facts 汇总，供人抽查。

## 11. 留位（本轮不做，登记即止）

- `agent-plan.md`（223KB，权威方案，只读）+ `agent-plan.bak-0908.md`（193KB 备份）：加 `pnpm plan-index`
  生成分节索引（§号 + 一行摘要），让会话 fetch 一节而非全文；bak 走 archive。
- `outputs/` 33 份 dated 报告：只把被现行文档引用的挪进 `archive/reports/`，其余原位（D-6 只校指针有效性）。
- 「未证项」与 facts 环形账的联动：`pnpm gates` 已有未证汇总（`DSH_STRICT_UNVERIFIED`），
  未来可让 `STATE.md` 的未证面直接由 facts 生成而不是手抄。
- 根目录三份 `overview*.md`：等各自对应里程碑收口时并入 archive。

## 12. 施工顺序（下一步 = writing-plans）

A 建 `scripts/docs-check.ts`（纯函数 + 单测，先只 D-1/D-3/D-5）→ B `scripts/facts.ts` +
`gates.ts` 落盘 → C 反向验证 + 变异锚点 → D 补 D-2/D-4/D-6/D-7 并逐条双向用例 →
E **等主会话在飞簇落库** → F §8 原子迁移提交 → G worktree 实测 + `pnpm gates` 全量 → H 更新 L0 role 表并向
主会话广播"新写在哪儿"。A–D 全部只新建文件、不碰那三份，可与主会话并行；F 起必须独占。
