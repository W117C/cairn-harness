// 门禁清单 + 漂移护栏（从 gates.ts 抽出，便于单测——gates.ts 顶层有 `await main()`，
// 直接 import 会跑起全套门禁，与 assertion-health.ts 同一处置理由）。
//
import { join } from "node:path";
// 「清单即事实源」的缺口：GATES 是手写的，package.json scripts 也是手写的，
// 两者之间没有机械校验——新增一条 `pnpm xxx-check` 却忘了登记进 GATES，
// 就得到一道**从不运行的门**（provider:check 即历史实例）。
// 本模块用「scripts 侧无孤儿」的方向兜底：凡是 *-check / *:check 形态的验收脚本，
// 必须在 GATES 里，或在 EXEMPT_SCRIPTS 里**显式**列明豁免理由。
// 它不能证明 GATES 里的每一项都值得跑，但能保证没有验收脚本被静默冷落。

/** 全部门清单（清单即事实源）：六道基建门 + 验收门。新增门只改这里。 */
export const GATES: readonly string[] = [
  "typecheck",
  "test",
  "e2e",
  "sandbox:check",
  "fork-check",
  "gate-check",
  "docs-check",
  "autonomy-check",
  "compaction-check",
  "tools-check",
  "map-check",
  "prune-check",
  "provider:check",
  "memory-check",
  "plugins-check",
  "security-check",
  "gym-check",
  "routing-check",
  "supervisor-check",
  "model-surface-check",
  "prefix-churn-check",
  // 第 174 页登记（任务 #13）：模型可见文本里点到的工具名，要在**每一档的工具面**上真拿得到。
  // 动因：`BASE_SYSTEM` 是一份文本对四档（现读 read-only 面 8 把、其余三档 20 把），而同类事故已命中四次
  // （glob 那句逃生口 / maxFiles 死参数 / prune 附件说 read_file 够不到 / verify 指向 .agent/ 禁写面）。
  // 存量按豁免表逐条带理由登记（3 条 odd，全在 read-only），**只准调低、过期即红**；真修法是拆 per-mode 文本（任务 #16）。
  // 同轮声明代价：取的是 runner 印的那一道门。第 174 页首测 **981ms**（一份文本对四档）；
  // 第 175 页拆成 per-mode 文本后 **814ms**（两份系统文本）；第 176 页加 68 份工具描述面后 **773ms**；
  // 第 177 页再加 8 份 goal 续跑提醒（共 78 份面）复测 **829ms**——单次读数，与前三次同量级（不是复测求出的噪声底）。
  // 第 178 页再加 189 份**参数描述**面（共 267 份，面数 ×3.4）：runner 三次读数 800/716/703ms，中位 **716ms**
  // ⇒ 与第 177 页那一次同量级、没有可分辨的涨幅（代价主要在 tsx 启动，不在面数）。
  // 第 179 页加覆盖率那一格（只印不拦）＋两把写向工具的 path 说明（参数面 189→195）：
  // runner 三次 846/744/741ms，中位 **744ms**——仍在同一噪声带内，同样没有可分辨涨幅。
  // 相对 mutate-verify 一轮（单价×条数见上面那段）可忽略。
  "prompt-surface-check",
  "replay-determinism-check",
  "no-progress-check",
  "cost-per-progress-check",
  // 第 146 页登记：0.26s 的一把尺，量的正是「消费者入库了新文件没入库」这一格——
  // 那一格从第 131 页起让认证树连续多笔读不到东西（167 条格子量不出来），而默认门表里没人问它。
  "head-import-check",
  // web_fetch 出网门（走明卷：判据是纯函数、传输层打 loopback ⇒ 不需要 key 也不需要出网，
  //  所以它进常跑路径而不是降级成"没 key 就不跑"——缺席当通过比跳过更坏）。
  // 第 146 页当初写的是「刻意不进 `CERT_GATES`：那张表的 `budgetMs` 是实测读数，本轮没量过就不占那个位」——
  //   **那个前提在第 273 页没了**：`pnpm gates` 全表那一趟实测它 `exit=0 568ms`（取料 `outputs/gates-outside-cert-2026-10-01/gates-all.log`，
  //   入库日志＝免费同分母，规则 250）⇒ 按门面那条线（「≤1.5s 全进」，见下面 `CERT_GATES` 头上）买入，预算 1200ms 是两倍档。
  //   同一趟里门面外 11 道按 ms 排开后**只有这一道**落在线内，所以这一笔只买它，不顺手多买（判卷钉的就是"线内的不许留门外"）。
  "web-fetch-check",
  // 第 149 页登记（任务 #4 结案）：认证**干净 HEAD** 的整棵树（切树→核 rev→补依赖→import 面→门表→typecheck→全量判卷）。
  // 为什么要进默认门表：`"test"` 那道门量的是工作树，而工作树可以替 HEAD 遮红——第 123 页数过：86 笔提交跑在红灯上。
  // 代价实测（本文件同笔，`gates --only=head-cert-check` 于 `123835b`）：**这道门 123.7s**（其中全量判卷 86.66s，其余是切树/补依赖/import 面/门表/typecheck）。
  // 对照的那一道必须带分母（第 170 页改的这句：从前只写「一道 16.9 分钟＝1/8」，条数一变就替错误背书——规则 245/250）：
  //   那 16.9 分钟是 26 道门那一趟里 mutate-verify 的墙钟，同一趟自己印的是 `跑了 568/568 条`＋`未证 265 条（236 条源文件在飞/未跟踪 ⇒ 根本没跑；29 条判卷文件在飞）`
  //   ⇒ 买到的只有**跑到的 568 条**＝单价 1.77s/条，当时表长 833 条（568＋265 对得上），今天的表 950 条。取料：`outputs/mutation-selector-scan-2026-09-28/old-mode-price-from-logs-2026-09-28.md`。
  //   现读同分母（第 170 页 selector 跑法、独占窗口、`6172a62`）：`跑了 949/949 条 · 本次耗时 1472.3s`＝1.55s/条 ⇒ 这道门相对是 **1/11.9**（不是 1/8）。
  //   再一份现读同分母（第 197 页：一棵干净树、独占、无预算、`aefc50b`、整表 1019 条）：
  //     `本次耗时 1085.3s · 跑了 1019/1019 条`＝**1.065s/条** ⇒ 这道门相对 **1/8.8**。单价从 1.55 掉到 1.065 的机制是第 173 页⑩
  //     把「还原后再测一遍」那一拍换成逐字节比对（每条少付一次 spawn），不是运气。
  //     取料：`outputs/mutation-parallel-shard-2026-09-29/serial-whole-table-1019.log`（这份原文逐条成本格抽得到 1019/1019 条）。
  //   并行那一臂（同一份 1019 条、四棵干净树、按实测秒装箱）墙钟 **350.2s＝5.8 分钟** ⇒ 串行 ÷ 并行 = **3.10×**，
  //     代价是每条单价被四棵树抬到 1.307s（＋22.7%）；同目录 measurements.md §十，那里还说清了"3.10× 与重叠度 3.54× 是两个口径"。
  //   逐条秒之和＝1036.4s，比机器自报墙钟 1085.3s 少 48.9s（4.5%）＝编排/换盘/git 那部分不在逐条账里 ⇒ 别拿逐条之和÷条数当墙钟单价。
  // 第 204 页（#21 笔1）把表从 1019 条长到 **1023 条**，并新增一个判卷宿主 `tests/impact-cap-policy.test.ts`。
  //   增量账的形状还是「单价×条数＋出处」：这 4 条各付 2 拍（第 173 页⑩之后没有第三拍）；
  //   **单价本笔不猜**——由认证那趟机器自报（`本次耗时 …s · 跑了 N/N 条`）回填，凭证页取料。
  //   这一笔真正贵的是**运行时**而非门：建图从「帽 400」放到全量，本仓候选 512 实测 1071ms → 1247ms＝**＋176ms／次建图**
  //   （独立进程、帽 400 与全量两种顺序各跑一次，同臂散布 ≤13ms；同进程连建两图那趟读数是反的，已作废）。
  //   取料：`outputs/impact-cap-decision-2026-09-30/decision-input.md` §三。付账对象是**默认开着**的那两条
  //   （`settings.ts` 的 `impactAnalysis: true` ⇒ 语义租约管 spawn 准入；每写一次就回注一句 `[impact]`），不是待配置路径。
  // 第 206 页（#33）再把表长到 **1027 条**（＋4 条：地图自述／地图分母退回切片后／ok:false 那支不出声／注入侧 catch 不出声）。
  //   同样**不猜单价**：判卷宿主 `tests/map-self-report.test.ts` 走 selector 跑法，量级参照第 205 页那批
  //   （同族合成靶子：7 条 7.4s、selector 中位 0.49s/拍）——认证那趟由机器自报回填。
  //   这一笔改的是**注入面的文本**（地图正文多一句自述、降级时多一行说明）⇒ 代价记在 A-4 那一格：
  //   地图文本本来就先进 `mapChars` 再进压缩判定，多这一句跟着一起被算，不需要新预算位。
  // 第 208→211 页把表从 1027 条长到 **1031 条**（#26 三条普查第三态＋#8 两条树闸证人），单价本笔**有实测**：
  //   同表整跑两趟（四棵干净树、`0513d13`）里逐条自报——新增五条中四条各 **0.7s／2 拍**，
  //   只有钉接线那条（`tree-guard-refusal-not-wired`）要 **2.0–2.5s／2 拍**；四条都在 selector 跑法那一支
  //   （体检行里既不零命中也不多命中），所以**这一格不是「整文件 vs 精确」能解释的**，机制本笔未量，只登记读数
  //   （取料：`outputs/0513d13-credential-2026-09-30/`）。
  //   同一趟还第一次有**同分母 A/B**：按条数装箱 377.7s vs 按实测秒装箱 349.0s＝**省 28.7s（7.6%）**，
  //   机制不是少干活（逐片之和 1345.1s vs 1357.4s，差 0.9% 在噪声里）而是把最长那片从 375.2s 压到 346.9s；
  //   臂内散布的底＝两次按条数装箱（`7da5c50` 379.8s／`0513d13` 377.7s，表只差 2 条）差 2.1s ≪ 28.7s ⇒ 符号稳、幅度只有一个 pair。
  // 第 217 页（#38）表从 1038 条长到 **1044 条**（六条锚点全钉在 `scripts/replay/verify-cause-mix.ts` 与 `corpus.ts` 这把尺自己身上）。
  //   单价**有实测**（认证树 `70eab48`、两端独占、锁标签 p217-new、机器自己印的分母）：
  //   `本次耗时 3.8s · 跑了 6/6 条`、`判卷 spawn 12 次／6 条（每条次数分布 2×6）`、
  //   `跑法单价：selector 12 拍·中位 0.29s·坏拍（选中≠1）0`、最贵一条 0.6s ⇒ 这一批的增量账 ≈ **每条 0.6s／2 拍**。
  //   为什么比第 208 页那批（0.7s／2 拍）还便宜——**机制本笔未量，只登记读数**（取料：`outputs/exec-cause-mix-2026-09-30/kill-6-new-anchors-at-70eab48.log`）。
  //   同一趟 `whole 0 拍·这一支本次没有 spawn ⇒ 没有分母`——这句照抄，不拿别的臂的单价顶。
  // 第 219 页（#42）表 1044 → **1046 条**（两条都钉在 `src/tools/*` 那两句超时文案上，判卷宿主是纯文本普查尺）。
  //   实测（认证树 `d672e10`、两端独占、锁标签 p219-timeout）：`跑了 2/2 条 · 本次耗时 1.2s`、`spawn 4 次／2 条（2×2）`、
  //   `selector 4 拍·中位 0.26s·坏拍 0` ⇒ **每条 ≈0.6s／2 拍**，与本仓最便宜的一格同量级
  //   （判卷不起真进程，只扫 `src/**/*.ts` 做文本普查）；"为什么便宜"的机制本笔未量，只登记读数。
  //   第 218 页（#41 折层）**增量 0**：表长不变、判卷文件数不变、用例 +1 条 ⇒ 那道门不补单价行。
  // 第 221 页（#39）表 1046 → **1051 条**：撤一条（尺侧 `no-exit-code` 那格的针脚随收敛一起消失）、加六条
  //   （谓词那一行／ENV 集合那一项／两只出口各自的正文说明／分子名单／尺必须继续 delegate）。
  //   实测（判卷树 `gate-mutate-verify` @`9f19c84`、锁标签 p221-new、机器自己印的分母，
  //   取料 `outputs/not-run-cause-2026-09-30/kill-6-new-anchors.log`）：
  //   `本次耗时 5.0s · 跑了 6/6 条`、`判卷 spawn 12 次／6 条（每条次数分布 2×6）`、
  //   `selector 12 拍·中位 0.43s·坏拍（选中≠1）0`、最贵一条 `verify-cause-not-run-folded-into-code` 0.9s
  //   ⇒ 这一批的增量账 ≈ **每条 0.83s／2 拍**，比第 217 页（0.6s／2 拍）与第 219 页（0.6s／2 拍）都贵。
  //   贵在哪一支**本笔未量**：四条判卷宿主是 `tests/verify-cause.test.ts`，那个文件里有 `defaultExec` 真起进程的用例
  //   ⇒ 单价里含真 spawn 的成本是**猜想不是读数**（selector 只跑一条用例，理论上不含别的用例），要拆要先做同分母 A/B。
  //   独占口径只到一半：起前 `pgrep -fl "mutate-verify|head-cert|vitest"` 为空，跑完之后我自己另起了认证树
  //   ⇒ 这批发的是「起前空＋锁由本进程持有」，**不写成两端独占**（第 220 页同一条纪律）。
  // 第 222 页（#44）表 1051 → **1055 条**（一条同 id 重指到取料层的表、四条新增；判卷宿主是 `corpus.ts`/两只读数脚本 + 新普查文件）。
  //   实测（判卷树 @`2becb8e`、锁标签 p222-retry、机器自己印的分母，取料 `outputs/env-cue-fold-2026-09-30/kill-5-anchors-at-2becb8e.log`）：
  //   `跑了 5/5 条 · 本次耗时 3.2s`、`spawn 10 次／5 条（2×5）`、`selector 10 拍·中位 0.29s·坏拍 0`、最贵一条 0.7s
  //   ⇒ **每条 ≈0.64s／2 拍**，与第 217/219 页那两批（0.6s）同量级——本批判卷全是纯文本/纯函数尺，不起真进程。
  //   同一批在**上一笔** `fcd521d` 上先跑出 4 杀 1 存活（`kill_exit=1`、`REDKINDS=survived:1`）：
  //   存活那条不是没观测者，是 `expectFail` 指到了「摘掉判据之后仍然成立」的那一半（负控）——
  //   选择子只跑被点名的那格 ⇒ 改指正向那格后 5/5。这笔账记在第 222 页补⑵，别拿 3.2s 那次替第一次背书。
  // 第 224 页（#36）表 1055 → **1059 条**（四条新增全钉在 `tests/cert-gate-face.test.ts` 一支上：三条行为格＋一条接线格）。
  //   实测（判卷树 @`419a5ef`、锁标签 p224-new、取料 `outputs/cert-gate-face-2026-09-30/kill-4-anchors.log`）：
  //   `跑了 4/4 条 · 本次耗时 2.5s`、`spawn 8 次／4 条（2×4）`、`selector 8 拍·中位 0.27s·坏拍 0`、最贵一条 0.6s
  //   ⇒ **每条 ≈0.62s／2 拍**。本格真正的成本不在变异表而在**认证那一趟**：+18.63s（`CERT_GATES` 那段写着实测出处）。
  // 第 225 页（#40）表 1059 → **1064 条**（四支钉 `tests/tool-block-witness.test.ts`、一支钉 `tests/replay-verify-cause-exec.test.ts`）。
  //   主树现读：新判卷文件单跑 `11 条 / 346ms`（纯函数＋假 provider，不起真进程）。
  //   五支锚点的**每条单价**＝认证树现读 `≈0.9s／2 拍`（`跑了 5/5 条 · 4.5s`、`spawn 10 次／5 条`、
  //   `selector 10 拍·中位 0.44s·坏拍 0`、最贵一条 1.0s；出处 `outputs/hard-gate-block-witness-2026-09-30/kill-5-anchors.log`）
  //   ⇒ 比第 224 页那批 0.62s 贵：本笔两支判卷文件各要真起一次 `runLoop`（行为证人，不是文字证人）。


  // 第 202 页之后新增：仓库体量门（2026-10-02 全量实测立项）。两条面，各带分母：
  //   面① `outputs/`（取料）在已跟踪文件里的占比 —— 实测 1449/2443 = 59.3%，帽 60%；
  //   面② src 单文件行数 —— 实测最大 2761（agent-runner），帽 2800。
  // 为什么进门：取料与源码同仓把 `git ls-files` 的信噪比压到 41%，而 docs-check / 断言体检 /
  // 变异选择子都以 git 清单为取料面；巨型文件则是多会话并发的冲突源（实测冲突从 5 处涨到 13 处）。
  // 帽取现状上取整而非理想值：**一道永远红的门等于没有门**。W4 拆分落地后再逐波降帽，一次一档。
  "repo-hygiene-check",
  // 从前挂在这道门上的「整表 20 分钟」这个反对理由，量的其实是整张变异表——两把尺的数不许互借。
  // 它排在 mutate-verify 之前：这道门红的时候，先知道「HEAD 本来就红」比先花上面那 18.1 分钟（1085.3s）跑变异更有用（跑法再变，这个次序都不变）。
  "head-cert-check",
  "mutate-verify",
  "mutate-needles-check",
  // 第 259 页（任务 #4）：证据面（`outputs/**/*.mts`）里"读一个不存在的东西"那一族类型错——
  // 主 tsconfig 的 include 只有 src/scripts/tests，探针全在门外，而 tsx 只剥类型：第 249 页一把探针因此印了 12 圈假「不变」。
  // ⚠️ 第 259 页当初写的是「单价 2.06s 高于 <1.5s 那条线 ⇒ 只进 GATES、不进 CERT_GATES，由交笔时手动跑覆盖」——
  //   **那句补偿在 4 笔之后被证伪**（我在 268/269/270/271 都没手动跑，于是自己入库的探针带着 TS7053 落了库）。
  //   第 272 页按「每笔交笔都要成立的判据」这一类把它买进 `CERT_GATES`（单价与预算的现读出处都在那张表里那道门旁边）。
  "evidence-typecheck-check",
  // 逐名判卷规格与盘上现读的配平门（2026-10-22 登记的那笔债：`fixtures/bench/` 五份清单
  //   12/12 条一条 `judge` 都没有 ⇒ 机制在、生产零流量，「该转绿的没绿」与「该保住的坏了」
  //   在这批基准上同形于同一枚退出码）。进门理由不是「补了规格」，而是**规格会漂**：
  //   靶子加一条测试、改一个标题，JSON 里那份不会跟着动，而漂掉的那一列要么恒真
  //   （把本来就绿的写进 failToPass ⇒ 永远转绿成功）要么整格 unmatched。所以这道门每次现跑靶子。
  //   实测（同笔，主树，独占）：**这道门 1.76s**（16 条靶子各跑一次判卷命令；B12/L30 那两条最贵，
  //   各 20/30 个文件，合计约 1.2s）；`--check` 在配平的盘上退 0。
  //   **为什么不进 CERT_GATES，尽管它落在 1.5s 那条线内**：那条线是「买得起」不是「必须买」，
  //   而这一格有更便宜的同源观测者——`tests/bench-judge-spec.test.ts` 在 `test` 那道门里，
  //   它判「形状成立 ＋ 两列与盘上现读逐字一致」（逐条 spawn 靶子，约 5s）。真正只在本门里量的
  //   只剩「漂了但形状仍成立」这一种，而它已经被那条判据的同一次 spawn 覆盖 ⇒ 双买等于付两次同样的账。
  //   登记在 GATES 而不在 CERT_GATES，理由换成：**它的价值在交笔那人跑一次 `--check`**，
  //   而不是替 HEAD 遮红（HEAD 若漂了，`test` 那道门先红）。
  //   判据宿主 `tests/bench-judge-spec.test.ts` 在 `test` 那道门里，规格漂到「形状不成立」会被它当场咬，
  //   而「形状仍成立、内容与盘上不符」只在这一道门里量 ⇒ 这一格必须留人手跑，不许假装它在认证面上。
  "bench-judge-spec-check",
  // 桌面端单向依赖红线（AGENTS.md 分层规则的机器面）：src → apps/desktop 或 electron 即红。
  // 原先只挂在 apps/desktop test 链尾——core-only 会话跑根门永远不触发；注册进默认门表补上这个洞
  // （终审 #4）。快尺：纯文本扫 src/，亚秒档；不进 CERT_GATES——门面预算线快到头（见那张表头），不再顺手多买。
  "renderer-layer-check",
  "event-semantics-check",
  "session-semantics-check",
  "session-search-check",
  "motion-policy-check",
  "desktop-boundary-check",
  // SEMA Phase 3（docs/sema-proposal.md §12）登记：桌面判卷进 GATES。动因：desktop-panel 包
  // 进自进化流水线后，§3.5 的「必须通过 pnpm --filter cairn-desktop test」要能在账本上表达——
  // 包的 manifest.gates 只认 GATES 名单里的门，桌面判卷不是门 ⇒ desktop-panel 提案声明不了它，
  // 必需门注入面（requiredGatesByKind）就无从钉死。分钟档，不进 CERT_GATES。
  // ⚠️ **「分钟档」这句 2026-10-12 被实测推翻**（第 453 页）：在一棵 detached 干净树里
  //   `pnpm --filter cairn-desktop test` 两趟 **4.66s（冷）/ 2.28s（热）**——它跟「分钟」差两个数量级，
  //   当初那句是照门表头那句量级话抄的，没有拿这棵树量过。**但它照旧不进认证面，理由换了**：
  //   当日我按「这是一次裁决」先只改了理由；**下一笔（第 454 页）就把它按规则买进来了**——
  //   因为体检发现同一格里还有 `e2e`（理由同样是假的），而第 272 页立的规则正是
  //   「每笔交笔都要成立的判据不许因单价线被挡在门外；挡在门外的每一道都得有真证人」。
  //   买入后它在 `CERT_GATES`（预算 10000ms＝实测两倍档），那条线同笔 60000 → 75000ms。
  //   代价（写明）：在 2026-10-12 两笔之前，`apps/` 的 145 条判卷**不在任何 HEAD 口径的认证面里**
  //   （`pnpm gates` 量的是工作树，不是 HEAD）——第 446 页入库的 52 个 `apps/` 文件正落在那一格里。
  "desktop-test",
];

/** 认证面**替它跑**的那几道门（第 224 页 #36）。
 *  为什么要有：`head-cert` 从前只把门表数一遍（「门表：29 道，缺同名 script 0 道」）却不跑，
 *  于是 `cert exit=0` 与「某道门红着」可以并存（规则 292），每笔凭证页再靠人肉自报"本笔另跑了 docs-check／prose"。
 *  取哪几道由**实测秒**决定，不靠感觉：`outputs/gate-cost-for-cert-face-2026-09-30/measurements.md`
 *  在认证树 `2becb8e` 上逐道量过 13 道（墙钟 46.7s、逐道之和 45.8s；分母＝认证树自报判卷 `Duration 122.02s`）。
 *  名单只收**亚秒档 8 道 ＋ 每笔交笔本来就要跑的两道**（gate-check、mutate-needles-check），
 *  合计**第一次实跑实测 18.63s**（10 道逐道 `ms` 之和，`419a5ef` 那趟认证自报），
 *  对认证树判卷 `Duration 121.14s` 是 **+15.4%**——第 223 页那句「≈+13.7%」是买之前的推算，被这个实测替掉（规则 260）；
 *  `tools-check`(8.6s)／`map-check`(4.8s)／`plugins-check`(15.2s)
 *  与那 16 道**没量过的**门都不进——"全吞进来"的性价比要另一笔单独量（第 224 页 §未证）。
 *  ⚠️ 上面这三行数字已被第 226 页的现读替掉一半：另 14 道逐道量完后按「实测 <1.5s 全进」又买十道 ⇒ 那趟是 20 道；
 *  第 272 页按**类**买一道＝21 道、第 273 页按**线**买一道＝**现读 22 道**（两道各见下面 `evidence-typecheck-check` 与 `web-fetch-check`）。
 *  门面预算之和现读 **56500ms**，距判卷那条 60000ms 只剩 3500ms ⇒ **这条线快到头了**：
 *  再往门面买门之前要先裁"要不要抬 60000"，而那条线是判卷钉着的（`tests/cert-gate-face.test.ts`），抬它＝单独一笔说明＋单独一次认证，不许顺手改。
 *  而 `map-check` 在主树现读是 **53.0s**（这里曾记 4.8s，量的是认证树 @`2becb8e`）——差的十倍来自取料面：
 *  主树刚被本会话写过，影响面要重建；认证树整棵同秒、"按 mtime 取前 N" 那条帽见规则 276。
 *  ⇒ **门的单价要连着"跑它的那棵树"一起记**，否则下一条预算是拿别的机器的账编的（规则 260）。
 *  仍不进门面的四道（全超这条线，且**不属于**下面那一类）：`tools-check` 8.6s／`supervisor-check` 8.0s／`plugins-check` 15.4s／`map-check` 53.0s；
 *  要不要为它们单独花一次认证，属第 223 页 §5⑶ 那一格裁决。
 *  ⚠️ 「<1.5s」这条线在**第 272 页**有了一个按类开的例外：`evidence-typecheck-check`（2.6s）买进门面，
 *  因为它和 `mutate-needles-check`（9.7s）一样是「每笔交笔都要成立的判据」，而给它的那条补偿（「交笔时手动跑」）被四笔漏跑证伪了。
 *  ⇒ 这条线的准确说法不是「单价 ≤1.5s」，而是「**≤1.5s 全进；超线的只有『每笔都要成立』这一类能买**」，判卷钉的就是这一类（`tests/cert-gate-face.test.ts`）。
 *  `budgetMs` 是**读数不是判决**：超预算只出声，不把认证判红（规则 256，秒数会被本机负载与隔壁会话挪动）。 */
export const CERT_GATES: readonly { name: string; budgetMs: number }[] = [
  { name: "no-progress-check", budgetMs: 1100 },     // 实测 514ms
  { name: "prune-check", budgetMs: 1100 },           // 实测 524ms
  { name: "fork-check", budgetMs: 1100 },            // 实测 545ms
  { name: "compaction-check", budgetMs: 1200 },      // 实测 574ms
  { name: "docs-check", budgetMs: 1300 },            // 实测 606ms
  { name: "memory-check", budgetMs: 1300 },          // 实测 638ms
  { name: "head-import-check", budgetMs: 2400 },     // 实测 1180ms（2026-10-02 本机现读，中位；三趟 1.17/1.18/1.33）
  { name: "autonomy-check", budgetMs: 1500 },        // 实测 737ms
  /* 第 226 页：另外 14 道**没量过的**门逐道量完（主树现读、@`8966310`，取料
     `outputs/hard-gate-block-witness-2026-09-30/gates-14-unmeasured.log`），按「实测 <1.5s 全进」这条线买十道：
     10 道实测之和 7.13s ⇒ 门面从 19.69s 到 ≈26.8s（对认证那趟 158.55s 是 +4.5%）。
     ≥4s 的四道不进（`tools-check` 8.6s／`supervisor-check` 8.0s／`plugins-check` 15.4s／`map-check` 53.0s），
     理由与 `map-check` 那个 10 倍差在 `#36` 头上那段：门的单价要按**跑它的那棵树**记。 */
  { name: "sandbox:check", budgetMs: 1700 },         // 实测 814ms（沙箱面：能力 7 的直接证人）
  { name: "security-check", budgetMs: 1500 },        // 实测 741ms
  { name: "provider:check", budgetMs: 1300 },        // 实测 629ms
  { name: "routing-check", budgetMs: 1400 },         // 实测 673ms
  { name: "model-surface-check", budgetMs: 1300 },   // 实测 650ms
  { name: "prefix-churn-check", budgetMs: 1500 },    // 实测 727ms
  { name: "prompt-surface-check", budgetMs: 1400 },  // 实测 678ms（文本↔面那把尺，第 174–176 页）
  { name: "replay-determinism-check", budgetMs: 1100 }, // 实测 535ms
  { name: "cost-per-progress-check", budgetMs: 1000 },  // 实测 499ms
  /* 第 273 页：按门面那条线买进来的（不是按类）。现读 `exit=0 568ms`（`outputs/gates-outside-cert-2026-10-01/gates-all.log`，
     主检出那一趟全表），预算 1200ms 是两倍档。同一趟里门面外只剩这一道 <1.5s ⇒ 一笔只买一道，剩下四道照旧不进门面。 */
  { name: "web-fetch-check", budgetMs: 1200 },       // 实测 568ms（web_fetch 出网门，明卷，第 146 页建）
  { name: "gym-check", budgetMs: 2400 },             // 实测 1188ms（这档里最贵的一道，仍 <1.5s 线内）
  { name: "gate-check", budgetMs: 5400 },            // 实测 2659ms
  /* 第 272 页：这道门越过「<1.5s」那条线买进来，动因是一条**被证伪的补偿声称**——
     `evidence-typecheck-check` 原写「不进门面，由 `pnpm gates` 与交笔时手动跑覆盖」，而我在第 268/269/270/271
     连续四笔交笔都没手动跑它，于是**我自己第 269 页入库的探针**带着一条 TS7053 落了库（`outputs/cred-unrecoverable-sweep-2026-10-01/sweep.mts`）。
     ⇒ 「交笔时人肉跑」不是覆盖，是没人守的承诺（规则 292 同族：`cert exit=0` 与门红并存）。
     它与 `mutate-needles-check` 是同一类：不是「某棵树偶发的读数」，而是**每笔交笔都要成立的判据**，所以按类买、不按单价线买。
     单价现读 **2644ms**（主检出工作树、2026-10-01，取料 `outputs/gates-outside-cert-2026-10-01/evtc-worktree.log`）⇒ 预算 5300ms 是两倍档；
     买进来后认证门面预算之和 50000 → **55300ms**（现读：`node --import tsx` 直接对本模块求和，判卷钉的是 ≤60000ms 那条线，见 `tests/cert-gate-face.test.ts`）。
     ⚠️ 这一格**在认证树里读的是 HEAD**：主检出那 4 条来自两份隔壁未入库的探针（`scripts/lib/evidence-typecheck.ts` 文件头记着），
     它们一旦入库就会让每次认证红——这正是买这道门想要的效果，不再指望我记得手动跑。 */
  { name: "evidence-typecheck-check", budgetMs: 5300 }, // 实测 2644ms（证据面危险码，第 259 页建门／第 272 页买进门面）
  { name: "mutate-needles-check", budgetMs: 20000 }, // 实测 9756ms（针脚体检：钉在飞文本／判卷未入库都靠它）
  /* 第 372 页买进认证面（2026-10-05）：仓库体量门。
     为什么必须进：它此前只在 `GATES`、**不在**认证面 ⇒ 这道红不会被任何自动化路径跑出来，
     而 10-03 评审的 B2 点的正是这一条。2026-10-05 同一笔把帽从 0.60 降到 0.70
     （第一次降帽裁决）；降帽若不在认证面，等于"改了但没人看得见"＝等于没改。
     按**类**买而不是按单价线买：它与 `mutate-needles-check` 同类——不是"某棵树偶发的读数"，
     而是"每笔交笔都要成立"的判据（新增取料不能把 `git ls-files` 的信噪比拖垮）。
     单价现读 **595ms**（主检出工作树，2026-10-05），预算 1200ms 是两倍档。
     门面预算之和 57500 → **58700ms**，仍在判卷钉的 ≤60000ms 那条线内。 */
  { name: "repo-hygiene-check", budgetMs: 1200 },  // 实测 595ms（体量门；2026-10-05 主检出工作树）
  /* 第 454 页买进认证面（2026-10-12）：`e2e` 与 `desktop-test`。
     动因是第 272 页那条规则的一次**逐条体检**：排除登记表里两道的理由被实测推翻——
     `e2e` 写的是「认证这一趟已经自己跑过」，而 `head-cert` 与根判卷**都不跑它**
     （`tests/cli-surface.test.ts` 里只有一句注释提到它）；`desktop-test` 写的是「分钟档」，
     实测 4.66s（冷）／2.28s（热）。两道都属「每笔交笔都要成立」那一类：
     `e2e` 是**唯一**把 mock provider 接到生产 loop 上、对着冻结靶子跑完整闭环的门；
     `desktop-test` 是 `apps/` 145 条判卷 ＋ 桌面边界那一道的宿主，而 `pnpm gates` 量的是工作树、不是 HEAD。
     单价现读（同一台机、主检出工作树 @`5b97924c`）：`e2e` **1995ms**、
     `desktop-test` **4660ms 冷／2280ms 热**（detached 干净树，取料 `outputs/gate-face-sweep-2026-10-12/`）
     ⇒ 预算 4000ms 与 10000ms 都是两倍档。门面预算之和 58700 → **72700ms**
     ⇒ 同笔把判卷钉的那条线从 60000 抬到 **75000ms**（第 272 页抬过 50000→55300 的先例）。
     这次抬的是**判据覆盖面**，不是某个门的预算：两道加起来给认证这趟约 +4.3s 实测墙钟，
     对一趟 ~265s 的认证是 +1.6%（量纲分开记：预算之和是登记口径，墙钟是实测口径）。 */
  { name: "e2e", budgetMs: 4000 },            // 实测 1995ms（闭环 e2e：mock provider 驱动生产 loop 修冻结靶子）
  { name: "desktop-test", budgetMs: 10000 },  // 实测 4660ms 冷／2280ms 热（apps/ 145 条判卷 ＋ 桌面边界）
];

/** 永远不许进认证面的门：认证这一趟已经自己跑过（`typecheck`／全量判卷），
 *  或是量级在**分钟以上**（一次 `pnpm gates` 的整表账在这张表头上写着）。
 *  判卷里有一条用例钉住「名单与这一份不相交」，所以"顺手把 test 也加进来"会当场红。 */
export const CERT_GATE_EXCLUDED: readonly string[] = [
  // `e2e` 2026-10-12 从这份名单里**撤出**（第 454 页）：它当初只在这一行里躺着，而理由是假的
  // （见 `CERT_GATES` 里那两道的买入注）。撤出后它按「每笔交笔都要成立」那一类进门面。
  "test", "typecheck", "head-cert-check", "mutate-verify",
];

/** 形如验收脚本的 script 名（这些必须有归宿：要么进 GATES，要么进 EXEMPT）。
 *  H5（审查 P2）：词根匹配——旧实现只认 `-check`/`:check` 结尾，`foo-check.mjs`、
 *  `bar:check2` 等换后缀命名即逃逸孤儿护栏。含 check 词根即视为验收形态（豁免列表可放行）。 */
const ACCEPTANCE_SHAPE = /check/i;

/**
 * 显式豁免的验收形态脚本：收尾门 / 真连门 / 被别的门覆盖的同族门。
 * 每条必须写明理由——豁免本身可审计，不接受无声放行。
 */
export const EXEMPT_SCRIPTS: Readonly<Record<string, string>> = {
  // e2e / ipc-check 是独立门名，但 `pnpm e2e` 直接就是脚本名，不属 *-check 形态；
  // 这里只列真正被排除在 GATES 之外、仍值得解释的脚本。
};

export interface ManifestViolation {
  kind: "orphan-acceptance-script" | "gate-without-script" | "exempt-without-reason" | "exempt-unknown-script";
  name: string;
  detail: string;
}

/**
 * 校验 GATES / package.json scripts / EXEMPT_SCRIPTS 三者一致（纯函数，可单测）。
 * - orphan-acceptance-script：*-check / *:check 形态却既不在 GATES 也不在 EXEMPT
 * - gate-without-script：GATES 里列了，但 package.json 没有同名 script（会 spawn 失败）
 * - exempt-unknown-script：EXEMPT 里列了，但 package.json 没有同名 script（陈旧豁免）
 * - exempt-without-reason：EXEMPT 的值是空白理由
 *
 * `exempt` 之所以开成一个形参（缺省仍是那张表）：豁免表**今天是空的**，
 *  那两个分支因此没有任何输入能走到——"留着但没人验收"不等于"已验收"（规则 210/223 那一族）。
 *  有了这个口子，判卷才能当场造一份豁免表把两条分支各测一次。 */
export function checkGateManifest(
  scripts: Record<string, string>,
  exempt: Readonly<Record<string, string>> = EXEMPT_SCRIPTS,
): ManifestViolation[] {
  const out: ManifestViolation[] = [];
  const scriptNames = new Set(Object.keys(scripts));
  const gates = new Set(GATES);

  for (const name of Object.keys(scripts)) {
    if (!ACCEPTANCE_SHAPE.test(name)) continue;
    if (gates.has(name)) continue;
    if (Object.prototype.hasOwnProperty.call(exempt, name)) continue;
    out.push({
      kind: "orphan-acceptance-script",
      name,
      detail: name + " 是验收形态脚本却不在 GATES；登记进 GATES 或在 EXEMPT_SCRIPTS 写明豁免理由",
    });
  }

  for (const gate of GATES) {
    if (!scriptNames.has(gate)) {
      out.push({
        kind: "gate-without-script",
        name: gate,
        detail: "GATES 列了 " + gate + "，但 package.json scripts 没有同名条目",
      });
    }
  }

  for (const [name, reason] of Object.entries(exempt)) {
    if (!scriptNames.has(name)) {
      out.push({ kind: "exempt-unknown-script", name, detail: "EXEMPT_SCRIPTS 列了不存在的 script: " + name });
    }
    if (reason.trim() === "") {
      out.push({ kind: "exempt-without-reason", name, detail: "EXEMPT_SCRIPTS 的 " + name + " 缺理由" });
    }
  }

  return out;
}

/** 门的执行计划：本函数只回答「跑什么」，spawn 由 gates.ts 负责（gates.ts 顶层有 `await main()`，
 *  判据放这儿才能单测——与 assertion-health.ts / 本文件同处置）。
 *
 *  直跑模式（`--direct` 或 `DSH_GATE_DIRECT=1`）绕开 pnpm：pnpm 11 在任何 run 之前做 deps 状态检查，
 *  而它拒绝「node_modules 的解析目标不在项目根之内」的目录并试图就地 install（报 ERR_PNPM_UNSAFE_MODULES_DIR）。
 *  「隔离 worktree + symlink 主树 node_modules」正是这个形状 ⇒ `pnpm gates` 只能在主树跑，
 *  而主树可能正被另一个会话写入，整表验证就被无限期挂起。门清单与命令事实源都不变，只换执行器。 */
export interface GateCommand {
  cmd: string;
  args: string[];
  /** 直跑模式要把本仓的 node_modules/.bin 顶到 PATH 前面（脚本正文里的裸 `vitest` 等才找得到）。 */
  pathPrepend?: string;
  /** package.json 里没有这条 script ⇒ 调用方必须判红，不得当成"没有要跑的东西"静默跳过。 */
  missingScript?: boolean;
}

export function gateCommand(
  name: string,
  opts: { direct: boolean; scripts: Record<string, string>; root: string },
): GateCommand {
  if (opts.direct !== true) return { cmd: "pnpm", args: ["run", name] };
  const body = opts.scripts[name];
  if (typeof body !== "string") {
    return { cmd: "", args: [], missingScript: true };
  }
  if (body.trim() === "") {
    return { cmd: "", args: [], missingScript: true };
  }
  return { cmd: "/bin/sh", args: ["-c", body], pathPrepend: join(opts.root, "node_modules", ".bin") };
}
