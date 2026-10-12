# 发展与优化方案（2026-10-12）

> 出具：2026-10-12。基线：主树 `zcode` @ `57f4d4a7`，工作树 241 项在飞。
> 本文每条结论分三态：**已证**（本轮亲自跑出、可复现）／**未证**（未跑或不具备条件，明确标注）／
> **不做**（已裁决或收益为负）。
>
> 与既有文档的分工：`docs/optimization-plan-2026-10-02.md` 是工程/质量面的连续台账（含 2026-10-11
> 七次追加，本轮已复核）；`outputs/agent-capability-roadmap-2026-10-01/PLAN.md` 是能力面十条判定与
> M0-M10 分工；`docs/sema-proposal.md` 是自进化 Phase 0-3 的实施记录。本文不重复它们的内容，只做三件事：
> 复核那些清单里的问题当前是什么状态、指出四处被各自立档的结构性风险、给出下一季度的波次与验收。
>
> ⚠️ **取料状态（2026-10-12 核，读本文引用前先看这行）**：上面点的四份里，
> `docs/optimization-plan-2026-10-02.md` 与 `outputs/agent-capability-roadmap-2026-10-01/PLAN.md`
> 已入库；**`docs/sema-proposal.md` 与 `docs/m5-acceptance.md` 不在 HEAD 上**（他处在飞，台账第 1112 行
> 登记过「不代提交、不代改」）⇒ 引这两份的那几格读数请在盘上那份复现，别按「文档不存在」处理。

> **2026-10-12 复核追加（§6.1）**：本文初稿有两处判断在复跑后被推翻——comparator 不是「未立」而是已落地并
> 带身份闸（§2 D-A 的第 2 波因此改判）；`mutate-needles-check` 现读是**红的（36 条阻断）**，第 1 波要加一条
> 它自己的验收。改动集中在 §2 D-A、§3 第 1/2 波、§6，上文读数一律不涂改。

## 0. 一句话结论

这个项目的验证面已经强到边际收益转负（34 道门、5253 条判卷、1533 条变异锚点、typecheck 0 报错），
而它要验收的那一件事——agent 到底变好了还是变差了——至今一个生产读数都没有。下一步不是再加一道门，
是**把产出的收成测出来**，并把两处结构性欠账补上：本仓无远端 ⇒ CI 从未真跑过；`evolution/` 等一批
新能力面未入库 ⇒ 变异与认证两面都量不到它。

## 1. 现状（本轮亲自跑出的读数）

| 面 | 读数 | 可复跑命令 |
|---|---|---|
| 全量判卷 | 370 文件 / 5253 条全绿，Duration 200.98s | `TERM=dumb node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts` |
| typecheck | 0 条报错（约 4-8s） | `pnpm typecheck` |
| 变异锚点 | 1533 条 | `node --import tsx scripts/mutate-verify.mjs --list` |
| 门禁清单 | GATES 34 道 / CERT_GATES 23 道 | `scripts/gate-manifest.ts` |
| 体量门 | 三面全绿：取料 2503/3679 = 68.0%（帽 70%）；src 单文件最大 2566 行 / 187 支（帽 2600）；删除形状 0 条 | `TERM=dumb node --import tsx scripts/repo-hygiene-check.ts` |
| 安全门 | 54 项断言通过 / 0 红（含合并准入 H1-H7b） | `TERM=dumb node --import tsx scripts/security-check.ts` |
| 文档门 | 受检项全绿，UNVERIFIED=3（`STATE.md` 不在盘上） | `TERM=dumb node --import tsx scripts/docs-check.ts` |
| 源码体量 | `src/` 213 文件 / 49,327 行；`tests/` 353 文件；`scripts/` 132 支 | `find src -name "*.ts"` 配 `wc -l` |
| 版本控制 | 分支 27；worktree 20；`.git` 205M；`.worktrees` 1.1G | `git branch \| wc -l` 等 |
| 远端 | `git remote` = 0 条，从未配置 | `git remote -v` |
| 台账 | `PROGRESS.md` 14,531 行，被 docs-check 当审计面读，已写到第 437 页 | `wc -l PROGRESS.md` |
| bench 任务集 | `fixtures/bench/tasks.json` 12 条（路线图当初要求 ≥12，已达标） | `node -e` 读该文件 |

读法：这是一份「装备过剩、战场未见」的账单。把全绿当成做好，是本文要防的第一件事。

## 2. 四处结构性诊断

### D-A 度量与证据链：效果目标 0% 达成，且没有真模型基线（最要紧）

`docs/m5-acceptance.md` 现读（scripted 基线冻结于 `2026-09-19T01:15:39Z`）：

- 4 个 case、成功率 100%、总计 1416 tokens；2026-10-11 复跑仍 1416 tokens ⇒ 提案要求的
  「token 用量降 ≥20%」读数 = 0%。
- review-fail 的生产自愈率 ≥50%：**未测量**。`supervisor-check` 的 81 条绿证的是规则与边界，不是发生率。
- 「所有生产 spawn 都留 `routing_decision`」：只有测试路径覆盖，无生产样本。
- 真模型暗卷：因无 `CAIRN_API_KEY` 显式跳过（`scripts/gym-run.ts:52`）。不是 0 分，是未考。

这四条不是哪一格没修完，是整条路线的产出端没有仪表。往后任何一波优化（上下文压缩、路由、成本）
都只能互相声称变好了——这正是路线图 §0 自己写过的次序（先补尺子，再动引擎）。

**⚠️ 本文初稿在这里写错过一句，现读更正**（复跑证据在 §6.1）：与初稿「comparator 尚不存在、
按未立写」，**`scripts/eval/report.ts` 已经落地且相当完备**（711 行）——它读两份 `readings.json`、
算两点噪声带、逐指标判 `beyond-noise`/`within-noise`、带合取闸（`outcomeGate`：结果类超带退化时，
成本类再漂亮也不许读作改善）、带身份闸（`identityOf`：`headSha`/`ranAt`/`model` 任一缺章即整表降级为
「只当量级」），出口码 3/4/5 分别对应身份闸／合取闸／两道都咬。路线图 §9.1 的出口条件**已经建起来了**。

那为什么 M0 还是没完工？缺口已经从「没有尺」挪到了**「旧读数喂不进这把尺」**，两处，都是机械的：

1. **写侧已盖章、盘上旧语料全没章**。`scripts/loop-eval.ts:957` 现在把 `headSha`/`ranAt`/`maxSteps`/
   `reps`/`arm` 盖进每条读数——这是 **HEAD `57f4d4a7` 上已有的代码**，不是未提交改动（`git show
   HEAD:scripts/loop-eval.ts` 核过）。但盘上 **31 份存量 `readings.json` 全部未盖章**（现读逐份核过：连
   `outputs/bench-head-d0ffe15e-{a,b}` 这对专门用来算噪声带的孪生读数，也只有 `rep` 一个键）。
   ⇒ 当时拿任何两份旧读数去喂 report，身份闸必咬、出口码 3、整表降级为「只当量级」。
   （**2026-10-12 后续：第一批带章读数已产出并喂通，出口码 0；见 `PROGRESS.md` 第 440 页与
   `outputs/eval-first-stamped-readings-2026-10-12/`。那一批走 `--scripted=` 离线合成面，
   证的是「章能被认」，**不是**真噪声带。**）
   ⚠️ **同批带出一个面键的洞（第 445 页登记）**：`identityOf` 的面键是
   `headSha|model|maxSteps|reps|arm`，**不含 `providerFace`**，而 `--scripted=` 那批的 `arm` 也是
   `base` ⇒ 合成臂与真会话臂**会被配成同一张脸**。后果是「拿合成批当基线去比一次真跑」不会被任何闸
   挡下，而那个 0 宽噪声带是构造出来的、不是机器的抖动底。**在那之前：合成批只当"管道通不通"的证据，
   不许当任何真跑比较的基线。** 治本那笔（把 `providerFace` 纳进面键，或让 `loop-eval` 在 scripted
   档改写 `arm`）动的是共享面，等 `scripts/eval/report.ts` 与 `scripts/mutate-verify.mjs` 两处在飞
   落库后再做。
   **这不是缺陷，是设计意图**（`report.ts:249` 原文：「这道闸今天一定会咬」，写侧该往哪盖章交 `#63`）。
2. **单趟重复仍然看不见**。`loop-eval` 有 `--reps`（缺省 1）且行内记 `rep`，但 `tally` 把 k×12 池成一个
   汇总数 ⇒ **重复跑了也不出分布**；而 `--reps 3` 那 36 趟实测 **32 趟死在 429 日配额**
   （`outputs/bench-reps3-2026-10-02/README.md`：请求数 0、token 0）。`bench-noise-verify-2026-10-05`
   同分母实测单趟逐靶翻转 **3 条 / 12**（8–25%）⇒ **这把尺现在测不出「一次改动带来 1 条靶提升」**。

⇒ 第 2 波的活儿因此**不是写 comparator**，而是：① 重跑两份带章的同配置读数（语料有了尺才有意义）；
② 把 429 日配额那一格堵上再谈 `--reps`；③ 给 comparator 自己补反向验证（路线图 §9.1 第 2 项要求它
「喂一份故意退化的 fixture 必须报越出」，这一格至今没有判卷钉住）。

### D-B 交付面：本仓没有远端 ⇒ CI 一次也没真跑过

`.github/workflows/verify.yml` 写着 typecheck + 全量判卷 + desktop test + 23 道 CERT 门，
但 `git remote -v` 为空 ⇒ 这份 workflow 的正确性只由本地 head-cert 保证（workflow 自己的注释也这么写）。
这不是配置缺陷，是一个未裁决项：是否接远端、接到哪、是否公开（`private:true` 未摘、LICENSE 未选型，
见 `docs/b2-checklist.md` 六项）。副作用是：**「非本地自评」这一路视点目前完全不存在**。

### D-C 协作面：多会话并发 + 未入库的新能力面

- 主树 241 项在飞（含别人的 WIP，不可 reset/stash）；另有 27 分支 / 20 worktree / `.worktrees` 1.1G。
- `src/main/evolution/`（7 文件 1568 行）与 `src/agent/evolution/`（4 文件）**全部未 tracked**；
  同行未入库的还有 `catalog-store.ts`、`custom-provider-store.ts`、`feedback.ts`、`file-revert.ts`、
  `providers/catalog.ts` + `catalog-snapshot.json`、`model-discovery.ts`、`project-create.ts` 等一批新面。
- 后果是机械的：`mutate-verify` 量的是 HEAD 不是工作树，`head-cert-check` 同样 ⇒ **这批代码既不变异校验、
  也不被认证覆盖**；`prose-needle-scan` 用 `git ls-files`（索引面），未 `git add -N` 的新文件会被判成 drift 红。
  它们在树里活得像是已交付，实际连被验证的资格都还没拿到。
- 并发纪律（AGENTS.md 已写，这里重复因为它是真风险）：跑全量前必须先确认
  `pgrep -f "mutate-verify|head-cert|vitest"` 为空，否则 `mutate-verify` 就地改 `src/` 再还原的动作会撞出假红。

### D-D 能力面：三条未达标项没有 owner，且都被外部依赖卡住

路线图 2026-10-01 判定的三条未达标，按它自己的口径**内核栏与外部依赖栏都要记一笔**：

| 能力 | 缺口 | 外部依赖 | 本文复核 |
|---|---|---|---|
| 1 仓库级理解 | 无向量检索 | 嵌入模型 | 语法面已扩到 **9 种**（ts/tsx/js/mjs/cjs/jsx/py/go/java，见 `src/agent/map/parse.ts` 的 `SUPPORTED_EXTS`），不再是当初的 4 种 |
| 3 工具与环境 | 无浏览器/调试器；无 issue/CI API | 外部服务与凭据 | 浏览器/调试器已裁决不做；issue/CI API 与 D-B 同源，接远端即解锁一半 |
| 9 工程化与集成 | IDE/PR 集成 = 0 | GitHub 凭据 | `.github/` 目前只有 workflow，无 PR/issue 面 |

其余七条按当初口径已达「已实现」，本轮复核未发现反例。

## 3. 波次方案

排序原则：**先做出能证伪的读数，再动引擎；先把未入库的欠账入库，再加新的面**。
每波结束必做三个动作：入库 → 全量认证 → 台账一页。每波指定一个集成 owner，
共享热文件（`src/cli.ts`、`src/main/agent-runner.ts`、`src/main/settings.ts`、
`scripts/gate-manifest.ts`、`PROGRESS.md`、`package.json`）只由他写。

### 第 1 波 把未入库的欠账入库（一笔提交，一个独占窗口）

为什么排第一：D-C 那一批未 tracked 文件让「同时被几个会话改写的面」都量不到生产行为。
在它们入库之前，任何针对 evolution / catalog / feedback 的优化或变异，都是在没有验证资格的代码上叠东西。

- 动作：把 `src/main/evolution/*`、`src/agent/evolution/*`、providers 新面、`feedback.ts`、`file-revert.ts`
  等逐个 `git add` 成笔提交。别人的在飞改动不动；同名文件若有冲突留给 owner 裁决。
  对本波新文件先 `git add -N`（intent-to-add，不落内容、可随时撤），使 `prose-needle-scan` 恢复索引面全绿。
- 验收：① 属于本波的文件在 `git status --porcelain src/` 里清零；② `git add -N` 后 `prose-needle-scan` 全绿；
  ③ `pnpm mutate-verify` 全表跑完一轮——这是第一次让那一千五百多条锚点真正覆盖 evolution 面；
  ④ `pnpm head-cert-check` 一把（历史读数 120-270s）；
  ⑤ **`mutate-needles-check` 必须从红转绿**——见下面「先修的一道红」。

> **⚠️ 本波冒出一笔初稿没记的账（2026-10-12 现跑，`exit=1`）**：`mutate-needles-check` **今天是红的**，
> `36 条锚点针脚/改法失效`。这不是建议，是入库那一波必须先解掉的闸——否则波次 1 做完仍停在红灯上。
> 按 `mutate-needles-check` 自检输出的自分类，**阻断 36 条 = 22 ＋ 9 ＋ 4 ＋ 1**，四类成因各不相同、
> 修法不许混为一谈：
>
> | 条数 | 成因（机器自报） | 归属 | 修法 |
> |---|---|---|---|
> | 22 | **未入库面**（被测面 + 判卷两面都在盘上、不在 HEAD） | 就是 D-C 那批：锚点行入了库、被锚的实现没入 | 第 1 波本体——把源文件提交，不是改针脚 |
> | 9 | **钉在飞文本**（锚点行已入库、HEAD 那份里针脚 0 处） | 别人的在飞改动改了所锚文本 | 等那笔入库；不许把针脚改成 HEAD 旧写法（那等于废掉这条锚点） |
> | 4 | **判卷标题还没跟上**（锚点行入库、那条用例标题还没） | 判卷文件改名/改写，指针写旧标题 | 指针改指新标题（这一类的唯一合法修法） |
> | 1 | `recovery-orchestrator-unreachable-after-restart`——多半是被锚的实现搬走了 | `b0868806` 搬的 | 改指新位置 |
>
> ⇒ 第 1 波的实际顺序因此是：**先把这 36 条按上表分类处理掉，再做全表变异**。
> 别把它们读成「同一类债一次清」——22 条是本波要干的活，另外 14 条是等别人那笔落地。
> 读法提醒：`--check-needles` 是静态体检，看的是**盘上（工作树）文本**；而 `mutate-verify` 跑的是 HEAD ⇒
> 在入库之前，这两把尺给出的是两个不同的面，不要拿体检那一把的读数去替另一把背书。
- 反向验证：向 `src/main/evolution/registry.ts` 注入一处等价改写（把「未过全门不得激活」改成恒真）
  ⇒ 判卷必须转红，且 `mutate-needles-check` 的针脚在源文件里。针脚钉不上去（变异未被杀）就不算验收。
- 禁区：这一波是搬运，不许顺手改业务语义。

### 第 2 波 M0 收尾：让读数能分辨噪声（价值最高，决定后面所有波能不能证伪）

- 动作一：**不要再写 comparator**——`scripts/eval/report.ts` 已经在 HEAD 上（711 行、带身份闸＋合取闸＋
  逐靶配对面，见 D-A 更正段）。这一格真正缺的是「喂得进它的语料」：在同一 commit 上跑两趟
  `--reps 1`（现有 `loop-eval:957` 已经会把 `headSha`/`ranAt`/`arm` 盖上），产出**第一对有身份的
  孪生读数**，喂进 `--baseline a --baseline b` 拿到第一个真实噪声带。**这一步才是从零到一**：
  盘上现存 20 份读数一份都盖不了章，所以今天连「这个改动大不大」都问不出来。
  四列读数（`成功率/tokens/墙钟/峰值内存`）**早已输出**，不用补。
- 动作二：给 comparator 补它的反向验证——喂一份故意退化的 fixture，`report` 必须判「越出」
  （路线图 §9.1 第 2 项自己立的判据），并把这条判据钉进变异针脚（`tests/eval-report.test.ts` 已存在，
  要确认 coverage 到 `outcomeGate` 与 `identityOf` 两支，缺哪支补哪支）。
- 动作三（并行、低票价）：把 `docs/m5-acceptance.md` 那三条至今只能写「未测量」的格——
  review-fail 自愈率、生产 `routing_decision` 覆盖率、真模型暗卷——变成三个跑出来就印数的采样器。
  有采样器才谈得上「什么时候达成」，否则那三格永远是非真非假的第三态。
- 验收：① 存在**两份带章的同配置读数**，喂给 report 后身份闸不咬（出口码 0 / 4，不再是 3）；
  ② comparator 在故意退化上判「越出」、在同一 commit 的两趟上判「噪声内」；③ comparator 的两道闸
  （`identityOf` / `outcomeGate`）各有针脚钉住（新判据不许活在门外）。
- 反向验证：把 comparator 的阈值面磨掉 ⇒ 它变成恒不报警 ⇒ 针脚红。
- 禁区：不许为凑「降 20%」去动基线。纪律照旧——保留旧基线，另起新基线并记差异。

> **`--reps` 那条路先别走**：`--reps 3` 那 36 趟实测 32 趟死在 OpenRouter 免费档日配额（1000 次/天），
> 请求数 0 ⇒ 跑不出来、且会把「跑不成」混进「没做到」（`eval-retry.ts` 头上记的就是这次）。
> 要让 1 靶可测需要 k≈6（`bench-noise-verify-2026-10-05`：k=6 才把每靶噪声压到 ±0.35），
> 而 k=6＝72 趟≈56 分钟≈666 请求，会再次撞同一道配额。⇒ **先确定配额/端点策略，再谈提高 reps**；
> 顺序反了只是把同一笔债再借一次。

### 第 3 波 把自进化走到运行面（SEMA Phase 4 的一半入口）

- 动作：Installer 目前只到「指针切上、账本可回滚」（`docs/sema-proposal.md` §11/§12 已立案的边界）。
  这一波接 canary 观察期与自治分级：① installed 包装载进 `src/agent` 的工具面 / prompt 面；
  ② desktop-panel 挂进桌面壳；③ 此时才第一次有 staging 流量可查 ⇒ 立 `evolution-check`
  （此前不立是对的：没有实质判据的门等于没有门）。
- 验收：能在真实路径上装一包 tool 并被实际调用；回滚 30 秒内恢复旧版本且自动判定；
  `evolution-check` 在 staging 集合与账本不一致时转红。
- 反向验证：摘掉 Installer 的「staging 安装前重验」那一拍 ⇒ 有判卷转红（sema 自己写过的损伤面）。

### 第 4 波 交付面：接远端，让 CI 第一次真跑

这是 D-B 的业主决策项，不是纯技术活，动手前须先确认（公开化牵扯 LICENSE / 遥测 / 桌面交付面，
见 `docs/b2-checklist.md` 六项）。

- 最小且不必要冒险的第一步：配一个远端（私有即可）+ push + 让 workflow 跑第一趟，
  把结果——无论绿红——连同原始日志记进台账。**这一波的成功判据不是 CI 绿，
  是「终于有了一份非本地自评的读数」。**
- 之后才谈：GitHub PR/issue 面（能力 9）、公开的 npm 面（B2 清单 1/2）。
- 反向验证：故意推一处类型错误 ⇒ CI 必须红，且由 workflow 抓到（本地跑不算）。

### 第 5 波 质量面降本（不要提前）

34 道门与 5253 条判卷已经够密，这一波不是加门，是让它们更便宜：

- `mutate-verify` 全表墙钟在 18-25 分钟量级（历史同分母 1.065-1.55s/条 × 约 1533 条），
  并行那一臂已实测 3.10× 加速。这一波的目标是墙钟，不是覆盖面。
- 只做两件：① 把 `pnpm prompt-cost` 的固定开销读数做成趋势面进 CERT（只印不拦，
  避免新增红源）；② 把 20 棵 worktree 收到 5 棵以内、`.worktrees` 1.1G 清一轮
  （先 patch + tar 存档到仓库外，照路线图 §8 的做法）。

### 第 6 波 能力面三条收口（排在第 2/4 波读数出来之后再定优先级）

- 能力 1：语法面已从 4 种扩到 **9 种**（`src/agent/map/parse.ts` 的 `SUPPORTED_EXTS` 现读 =
  ts/tsx/js/mjs/cjs/jsx/py/go/java）。
  跨包调用不进图是登记过的设计边界，不是 bug——这一波把它写清即可；
  向量检索与嵌入依赖继续不做（与零新依赖纪律冲突）。
- 能力 3/9：浏览器/调试器继续不做（已裁决）；issue/CI API 待第 4 波接远端后重估。
- 这一波的可交付物是**把三条未达标的边界写成带出处的文档**，而不是硬凑条数。

## 4. 明确不做（已有裁决，本文不翻案）

1. pre-commit 钩子（`scripts/ci/README.md` L2 裁定）：多会话共享树里别人的在飞脏文件会把你的提交卡死，
   一次卡住只会训练出 `--no-verify`；L1 已在 push 时跑同一条 `pnpm typecheck`。
2. 浏览器 / 调试器集成（能力 3）：已裁决不做。
3. 向量检索 / 嵌入依赖（能力 1）：与零新依赖纪律冲突。
4. `private:true` 摘除、LICENSE 改选、文档双语、桌面纳入 v1 交付面（`docs/b2-checklist.md` 1-5）：
   触发条件是「出现第一个真实外部用户」，未触发只记账不施工（ADR 0002）。
5. 改冻结判卷或夹具当作绕行手段（`scripts/frozen-sha256.json`）。判据有缺陷就换判据，不改被测代码绕。
6. 为凑「降 20%」那条去调基线。

## 5. 每波的出口与反向验证

| 波 | 出口条件（可机器判） | 反向验证（必须转红） |
|---|---|---|
| 1 入库 | 本波文件 `git status` 清零；`mutate-needles-check` 从红（36）转绿；`mutate-verify` 全表跑完且含 evolution 面条目 | 摘掉 registry 的「未过门不可激活」 ⇒ 判卷红 |
| 2 度量 | 存在两份带章的同配置读数（出口码不再是 3）；comparator 能分辨故意退化与噪声 | 磨掉 comparator 阈值面 ⇒ 恒不报警 ⇒ 针脚红 |
| 3 运行面 | 真装一包并被实际调用；回滚 30s 内且自动判定 | 摘掉 Installer 的 staging 重验 ⇒ 判卷红 |
| 4 CI | 远端存在且 workflow 跑过第一趟（绿红都记） | 推一处类型错 ⇒ CI 红 |
| 5 降本 | 墙钟读数下降；worktree ≤ 5；开销趋势面可见 | 趋势面不许拦（否则是新增红源） |
| 6 能力 | 三条缺口的边界文档落盘 | — |

## 6. 本文自身的验证状态

- **已证（本轮亲手跑出、可复跑，命令与取料在 §6.1）**：
  ① `pnpm gates` **34 道门里跑了 25 道（`test` 与 `e2e` 是本轮补跑的）**：24 道 exit=0，
  1 道红——`mutate-needles-check` exit=1（36 条阻断），**该红已归因并解掉**（见下「落地」）。
  ② 全量判卷 **5253 passed / 5253**（215.4s，`test` 门本轮实跑，不再是「未跑」）。
  ③ D-A 的 comparator **已存在**（`scripts/eval/report.ts` 711 行，身份闸 + 合取闸 + 出口码 3/4/5）——
  初稿那句「尚不存在」是错的，已按现读改判；盘上 **31 份存量 `readings.json` 全部未盖章**（逐份核过，
  0 份含 `headSha`）⇒ 身份闸今天必咬。**第一批带章读数由第 440 页产出**（3 份，命名
  `readings-{a,b,c}.json`，喂进去出口码 0／故意退化出口码 4），走的是 `--scripted=` 离线合成面。
  ④ D-B（`git remote` = 0 条）、D-C（`git status` 244 项；`src/` 下 60 项含 18 个未 tracked 面）。
  ⑤ 能力面复核：`SUPPORTED_EXTS` = 9（不是 6）；调度器有生产调用方；`apply_patch` 在工具面内。
  ⑥ **`head-cert-check` 已跑，且在修完两条红之后 exit=0**（新 HEAD `6081383b`）：判卷
  **348 文件 / 4971 条全过**、**认证门面 23/23 全绿**、两端独占、墙钟 256.80s、判决六维全过。
  取料 `outputs/head-cert-6081383-2026-10-12-0306/provenance.md`。
- **未证（不许读成绿）**：
  ① **`mutate-verify` 全表仍未跑**（单价 1.065-1.55s/条 × 1533 条 ≈ 18-25 分钟）——它不在
  `head-cert` 的门面里，本轮没花这笔钱，因此「整张变异表在 HEAD 上全杀」这句话**没有读数**。
  ② `mutate-needles-check` 由红转绿靠的是**把配套实现与判卷同笔落库**（§6.1「落地」）；
  工作树里别的那批未入库面（7 个 `git add -N` 的 `src/main/*` 新面、`scripts/docs-check.ts` 的 D-13 实现
  及其判卷、`scripts/mutate-verify.mjs` 里那批 d13 锚点）**入库前仍是第三态**，既不变异校验也不被认证覆盖。
  ③ **任何真实模型 / 生产行为一概未证**：无 `CAIRN_API_KEY`／`OPENAI_*`，真模型暗卷与 bench 全程未跑；
  `--reps 3` 历史上 32/36 趟死在 429 日配额，配额策略未定前提高 reps 只会重借同一笔债。
  ④ evolution / catalog / feedback 那批未入库面的变异与认证读数此刻是第三态：按既有口径报「等入库」。
- **待业主裁决**：是否接远端（第 4 波的前置）。

## 6.1 本轮审计轨迹（2026-10-12 复核追加，本文的证据面）

本文是**复核稿**：初稿成文后又复跑了一遍，推翻了初稿两处判断（comparator「未立」、`mutate-needles-check`
「未提」）。这一节把那一遍的账摊开，让下一个人不必重跑就能判断哪些能信。

### 环境

- 实路径 `/Users/ze/Downloads/Cairn/deepseek harness`（**不是** `~/Downloads/deepseek harness`；仓挪过，
  旧笔记里的命令要重指向）；分支 `zcode`，HEAD `57f4d4a7`；工作树 **244 项在飞**（含别人的 WIP，
  全程未 reset / 未 stash）；`git remote` = 0 条。
- 跑前与跑中均确认 `pgrep -f "mutate-verify|head-cert|vitest"` 为空（并发纪律，AGENTS.md）。
- `scripts/gate-manifest.ts` 是门的唯一事实源：现读 **GATES 34 / CERT_GATES 23**。

### 跑过的门（两批，`--only=` 分批跑，取料在 `outputs/gates-plan-2026-10-12/`）

| 批 | 门 | 结果 |
|---|---|---|
| 1 | 30 道（除 `test`/`e2e`/`mutate-verify`/`head-cert-check` 四道长门） | 29 道 exit=0，**`mutate-needles-check` exit=1** |
| 2 | `test` + `e2e` | `test` exit=0（**5253 passed / 5253，215.4s**）；`e2e` exit=0（2.3s） |

抽检复跑过：security-check 54 断言 0 红；desktop-boundary-check；desktop-test；memory-check；
no-progress-check；prompt-surface-check；cost-per-progress-check。

### `mutate-needles-check` 的 36 条（机器自报的自分类，逐字引自它的输出）

| 条数 | 成因 | 归属 |
|---|---|---|
| 22 | 被测面不在 HEAD 的树里（`goal-handlers.ts` / `tool-gates.ts` / `sandbox-test-command.ts` / `compact-and-report.ts` / `state-handlers.ts`） | 第 1 波本体：提交源文件，不是改针脚 |
| 9 | 盘上判得通过、HEAD 那份里针脚 0 处（钉在飞文本） | 等那笔入库；**不许**把针脚改成 HEAD 旧写法 |
| 4 | 判卷文件里找不到那条用例标题 | 改指新标题 |
| 1 | `recovery-orchestrator-unreachable-after-restart`——`b0868806` 搬走的 | 改指新位置 |

机器同时印了几个不该被读成红的旁证：待复认 2（针脚命中 2 处）、未覆盖 1（apply 非通行写法）、
逐行式 5（多处命中即设计）、松钉指针 10、选择子 1533/1533。**「改法语法体检：1533 条改法全部产出合法
源文件 ✅」**——红的是针脚位置，不是改法本身。

### `scripts/eval/report.ts` 复核（推翻初稿 D-A）

- 现读 711 行：`identityOf` / `outcomeGate` / `exitCodeOf`（3=身份闸咬、4=合取闸咬、5=两道都咬、0=可信）
  全在；per-target `pass@k` / `pass^k` 与翻转对也印。
- 写侧 `scripts/loop-eval.ts` **在 HEAD 上就已经盖章**（`git show HEAD:scripts/loop-eval.ts` 里
  `headSha`/`ranAt`/`maxSteps`/`reps`/`arm` 俱在）⇒ 缺的确实只是语料，不是尺。
- **盘上 31 份 `readings.json` 逐份 `rg '"headSha"'` ⇒ 0 份命中**（本行是修复前那一刻的读数）。
  这一格因此是：尺已立、料未盖章 ⇒ 当时喂任何两份旧读数都是出口码 3（整表降为「只当量级」）。
  这是设计意图，不是缺陷。**修复后的第一批带章读数见第 440 页**。

### 能力面复核（为「其余七条已达已实现」找反例，未找到）

- `apply_patch` 在工具面内（10 把工具之一）；调度器有生产调用方（`serveScheduler` 由 `src/cli.ts` 与
  `apps/desktop/src/main/index.ts` 拉起）；未知工具名现在返回 `ask` 而不是 fail-open
  （`src/permissions/autonomy.ts`，`L4-mcp-unannotated` 那一格）。
- 地图解析器 `SUPPORTED_EXTS` = **9**（ts/tsx/js/mjs/cjs/jsx/py/go/java）——初稿写 6 是错的，已改。
- `src/cli.ts` 有 `fork` / `replay` 两个入口面。

### 本文改动清单（相对初稿）

§2 D-A（comparator 已立、缺口挪到语料）｜§3 第 1 波（加验收 ⑤ + 36 条分类表）｜§3 第 2 波（从「写
comparator」改成「产第一对带章读数 + 补 comparator 反向验证」）｜§5（波 1/波 2 出口按上述重写）｜
§6（本轮真实读数）｜能力 1 的 6 → 9（两处）。

### 落地：HEAD 上那两条红（`6081383b`，已认证）

上面那张 36 条的账**在 HEAD 侧不是红**：干净 HEAD 树上 `mutate-needles-check` 是 exit=0，
36 这个数全部来自工作树里别人的在飞改动（22 条「锚点行已入库、被锚实现还没」＋9 条钉在飞文本
＋4 条判卷标题＋1 条搬走）。**真正堵住所有会话认证的是另外两条判卷红**，都在干净树上复现：

| 红 | 归因 | 修法 |
|---|---|---|
| 顶包候选 11 > 帽 10 | `tests/docs-check.test.ts` 三条断言整句复述生产措辞（`rev` 41 个生产者、`pnpm facts` 2 个、`STATE.md` 2 个）——规则 302 的顶包形状 | 改判卷侧：取生产者独有的那半截（`首部必须写` / `手抄了观测值` / `过期字随写消失`），三个突变各自仍转红、逐条验过 |
| 暂存树命名假红 | `package.json` 把两道门的树名写死成 `gate-mutate-verify`／`gate-head-cert`，它们是长期复用工具树、名字没 sha 是设计 | 豁免 `gate-` 前缀 + 两条合成用例钉边界（豁免不放大；同批 `verify-` 树仍逐条查），突变下两条转红 |

两处都**没有动帽**（帽只准下调）、也没有改判据去绕。连带一处：①改完后顶包候选 11→8，
真仓的「裸名字」那一族归零，触发 `tests/prose-needle-scan.test.ts` 里「谓词不空转」的活证断言——
把证人换成合成树那条（真仓只证帽内、谓词由合成输入证），不是把断言删掉了事。

**本笔踩到并修掉的一个真错误（值得记下来）**：第一版提交（`fc3ce80a`）把另一会话**未完成的**
D-13 判卷（`tests/docs-check.test.ts` 里那 90 行）与它那批 import 一起带进了 HEAD，而
`scripts/docs-check.ts` 的 D-13 实现还躺在工作树里没入 ⇒ **HEAD 的 typecheck 与 head-import 当场转红**。
是 `head-cert` 抓出来的（`认证门面=23 道｜❌ 红 1 道`、`typecheck exit=2`），不是我自己发现的。
回退后按「**判卷与被测实现必须同笔落库**」重建提交：只取属于本次的三处 needle 修复，把那 90 行
原样留在工作树。⇒ 规则（本仓已有一条同族的）：**一笔提交里出现判卷新面而没有它测的实现，等于在 HEAD 上
埋一个必红**；动手前先问一句「这行判卷测的东西，在 HEAD 里存在吗」。

认证读数（`head-cert` 自己印的原文）：
`TREE=6081383 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有`；
`Test Files 348 passed (348)｜Tests 4971 passed (4971)｜exit=0`（基线 `57f4d4a7` 是
`4966 passed / 2 failed`，两条红同口消失，多出的 5 条是本笔新增合成用例）；
`认证门面=23 道（跑到 23）｜绿 23 道｜⚠️ 超预算 0`；两端独占（起前 0 套／跑完 0 套）；
`本趟墙钟 256.80s`；`本次退出码=0`。

**没碰的**：7 个 `git add -N` 的 `src/main/*` 新面、`scripts/mutate-verify.mjs` 里那批 d13 锚点、
`scripts/docs-check.ts` 的 D-13 实现与其判卷块、以及同树里其余在飞改动，提交用 `--only` 只 add 四个路径。
