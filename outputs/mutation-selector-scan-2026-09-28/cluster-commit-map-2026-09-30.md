# 簇 `6849e35..4177280` 逐笔映射（给台账里那些 sha 兜底）

- 笔数=46；这份表由 `cluster-commit-map.mts` 现生成（tip 现读 `refs/dsh/cluster-p169-199`），不手抄、不写死。
- **悬空 sha 的引用面**：PROGRESS 新增行里出现的 sha 形态 token 逐个查可达性（现读：`merge-base --is-ancestor <sha> <tip>`），名单与命中数见表末统计行。**只有「不在本簇祖先链里、也不是主线提交」的那些才是悬空引用**——表末名单里若出现本簇父提交或主线那笔（如 `6849e35`／`15fad7b`），它们落库后照样可达，不属于要兜底的那一批。
- 落库方式两种都成立：① 压成一笔 ⇒ 这些 sha 靠本表＋保留的私有 ref 解释；② 保留簇历史（merge）⇒ sha 直接在主线可达，本表变成索引。

| sha7 | 时间 | 标题 | 改动文件 | 页里是否引用 |
| --- | --- | --- | --- | --- |
| `5c343de` | 09-28 20:33 | 本地暂存（不入库）：第 169 页选择子闸，为了在干净树上杀一遍自己的新锚点 | scripts/lib/mutate-gates.ts, scripts/mutate-verify.mjs, tests/mutate-verify-gates.test.ts |  |
| `7bcc775` | 09-28 20:49 | 本地暂存（不入库）：第 170 页 -t 精确跑法 + 六条锚点 | scripts/lib/mutate-gates.ts, scripts/mutate-verify.mjs, tests/mutate-verify-gates.test.ts |  |
| `2a62291` | 09-28 20:51 | 本地暂存②：修四条自-hosted 针脚（缩进一位＋针脚要跨真换行，否则 replace 落在表自己身上） | scripts/mutate-verify.mjs | 是 |
| `8c9ce29` | 09-28 20:54 | 本地暂存③：接线判卷改为行锚定（不锚定会撞上锚点表里那份引文） | scripts/mutate-verify.mjs, tests/mutate-verify-gates.test.ts | 是 |
| `6172a62` | 09-28 21:18 | 本地暂存④：读数闸收成「恰好选中 1 条」，判据收成一份 runReadingIsBad | scripts/lib/mutate-gates.ts, scripts/mutate-verify.mjs, tests/mutate-verify-gates.test.ts | 是 |
| `0e90cff` | 09-28 23:00 | 本地暂存⑤：选择子改 `--testNamePattern=<值>`，指针以 `-` 开头的锚点不再被 CLI 当旗标 | scripts/mutate-verify.mjs, tests/mutate-verify-gates.test.ts | 是 |
| `b86374a` | 09-28 23:02 | 本地暂存⑥：新锚点的 killer 改挂接线判卷——行为证人自己跑两种写法＝对生产零分辨力（规则 236 又命中一次） | scripts/mutate-verify.mjs | 是 |
| `18a57c2` | 09-28 23:42 | 本地暂存⑦：门表那句「mutate-verify 一道 16.9 分钟＝1/8」补上分母（任务 #11 结案，注释-only） | scripts/gate-manifest.ts | 是 |
| `2434aa7` | 09-28 23:57 | 本地暂存⑧：未证那一态开始印名单＋可原样补跑的命令，计数改成从名单求和（任务 #14） | scripts/lib/mutate-gates.ts, scripts/mutate-verify.mjs, tests/mutate-verify-gates.test.ts | 是 |
| `2bf3b17` | 09-29 00:00 | 本地暂存⑨：跑法单价那行定长列印两种跑法，某一支 0 拍也要印「没有分母」而不是整支消失（任务 #15） | scripts/lib/mutate-gates.ts, scripts/mutate-verify.mjs, tests/mutate-verify-gates.test.ts | 是 |
| `3d21611` | 09-29 00:09 | 本地暂存⑩：还原那一拍换成逐字节比对，整表每条少付一次 spawn（任务 #10 的第一半） | scripts/lib/mutate-gates.ts, scripts/mutate-verify.mjs, tests/mutate-verify-gates.test.ts | 是 |
| `f36e021` | 09-29 00:28 | 本地暂存⑪：判红在出口就带类别，尾行按类别分开数并印 `REDKINDS=` 给下游共用（任务 #12） | scripts/lib/mutate-gates.ts, scripts/lib/mutation-rerun-triage.ts, scripts/mutate-verify.mjs, tests/mutate-verify-gates.test.ts, tests/mutation-rerun-triage.test.ts | 是 |
| `e476c88` | 09-29 01:00 | 本地暂存⑫：提示词散文 ↔ 工具面 的可达性门（任务 #13，第 174 页）——dead／odd 两类分开，取料空面直接抛而不是印 0 | package.json, scripts/gate-manifest.ts, scripts/mutate-verify.mjs, scripts/prompt-surface-check.ts, src/agent/prompt-surface.ts, tests/mutation-rerun-triage.test.ts ＋1 more |  |
| `ec8efce` | 09-29 01:20 | 本地暂存⑬：提示词按档拆面，read-only 不再读到它拿不到的承诺；门的存量豁免清到 0（任务 #16，第 175 页） | scripts/gate-manifest.ts, scripts/mutate-verify.mjs, scripts/prompt-surface-check.ts, src/agent/prompt-surface.ts, src/main/agent-runner.ts, tests/prompt-surface-check.test.ts |  |
| `70133a8` | 09-29 01:37 | 本地暂存⑭：工具描述也纳入「模型可见文本」这把尺，并修掉它当场抓到的一格（第 176 页） | scripts/gate-manifest.ts, scripts/mutate-verify.mjs, scripts/prompt-surface-check.ts, src/agent/glm-session.ts, src/agent/prompt-surface.ts, tests/prompt-surface-check.test.ts |  |
| `64f05bf` | 09-29 01:47 | 本地暂存⑮：goal 续跑提醒也进「模型可见文本」这把尺的取料面（第 177 页） | scripts/gate-manifest.ts, scripts/mutate-verify.mjs, scripts/prompt-surface-check.ts, src/agent/goal.ts, tests/prompt-surface-check.test.ts |  |
| `38c3791` | 09-29 01:49 | 本地暂存⑯：续跑提醒的 verify 断言改成**逐面**——上一笔那条锚点变异存活（第 177 页补） | tests/prompt-surface-check.test.ts |  |
| `76aa206` | 09-29 01:54 | 本地暂存⑰：把「--no-optional-locks 没动 index」那条行为证人的造脏改成必然发生——它在全量并发下偶发红（第 177 页补） | tests/head-cert-deps.test.ts |  |
| `7cde671` | 09-29 02:10 | 本地暂存⑱：模型可见文本的第四族面——参数描述进门（第 178 页） | scripts/gate-manifest.ts, scripts/mutate-verify.mjs, scripts/prompt-surface-check.ts, tests/prompt-surface-check.test.ts |  |
| `19f7165` | 09-29 02:19 | 本地暂存⑲：把两条锚点说明里的「面总数」从读数改成不依赖总数的说法（第 178 页补） | scripts/mutate-verify.mjs |  |
| `a8294b2` | 09-29 02:30 | 本地暂存⑳：参数说明覆盖率进读数面，并补上两把写向工具的 path 说明（第 179 页） | scripts/gate-manifest.ts, scripts/mutate-verify.mjs, scripts/prompt-surface-check.ts, src/agent/glm-session.ts, tests/prompt-surface-check.test.ts |  |
| `7164fdf` | 09-29 03:05 | 本地暂存㉑：把覆盖率「只印不拦」的理由从错的证据换成真轨迹证据（第 182 页更正） | scripts/prompt-surface-check.ts |  |
| `1d1da24` | 09-29 03:26 | 第 183 页 · 覆盖面自述从「非全量」改成带分母：图报得出帽外还有几个候选 | scripts/mutate-verify.mjs, src/agent/impact/index.ts, src/tools/impact-query.ts, tests/impact-note-bounds.test.ts, tests/impact-query.test.ts, tests/measure-impact-cap-divergence.test.ts |  |
| `467e9ec` | 09-29 03:48 | 第 184 页 · 把「这不是代码失败」从 verify 铺到 shell 家族四条出口（复用同一只谓词） | scripts/mutate-verify.mjs, src/agent/verify.ts, src/agent/worker-shell-tools.ts, src/main/agent-runner.ts, src/tools/run_shell.ts, tests/shell-family-cause.test.ts |  |
| `be18607` | 09-29 04:14 | 第 185 页 · 固定成本尺的分子补上工具规格，并让它自己报出"系数不成立" | scripts/lib/prompt-cost.ts, scripts/mutate-verify.mjs, scripts/replay/prompt-fixed-cost.ts, tests/prompt-cost.test.ts |  |
| `457422d` | 09-29 04:21 | 第 186 页 · 重铸那条常驻存活的锚点：不是没有观测者，是突变挑错了资源 | scripts/mutate-verify.mjs |  |
| `f31e89e` | 09-29 04:57 | 第 187 页 · 并行判卷的分片与合并层：切法要按判卷宿主成组，因为撞的是共享 git 注册表 | scripts/lib/shard-plan.ts, scripts/mutate-shards.ts, scripts/mutate-verify.mjs, tests/mutate-shards.test.ts |  |
| `9b6e019` | 09-29 05:02 | 第 187 页补 · 那条存活是我自己造的：文字钉看不出「闸门被解除」，于是给守卫造一个可达的输入 | scripts/mutate-shards.ts, scripts/mutate-verify.mjs, tests/mutate-shards.test.ts |  |
| `5116b3f` | 09-29 05:19 | 第 188 页 · 被度量者自己的文案冒充了读数：分类那把尺只准认行首形状 | scripts/lib/mutation-rerun-triage.ts, scripts/mutate-shards.ts, scripts/mutate-verify.mjs, tests/mutate-shards.test.ts, tests/mutation-rerun-triage.test.ts |  |
| `6d06519` | 09-29 05:25 | 第 188 页补 · 两条新锚点没被杀死：一条指针字写错，一条样本太短以致旗标无关 | scripts/mutate-verify.mjs, tests/mutation-rerun-triage.test.ts |  |
| `a7370a6` | 09-29 05:36 | 第 189 页 · 编排器只认连写、被包的机器只认空格写法：同一扇门两种形状，我自己撞在自己的门上 | scripts/mutate-shards.ts, scripts/mutate-verify.mjs, tests/mutate-shards.test.ts |  |
| `b248068` | 09-29 05:49 | 第 190 页 · 片原文改成边跑边落盘：整表七八分钟里读者要能 tail，外层超时也不该把四片读数一起带走 | scripts/mutate-shards.ts, scripts/mutate-verify.mjs, tests/mutate-shards.test.ts | 是 |
| `edc7278` | 09-29 22:19 | 第 191 页 · 逐条锚点的实测成本要有出口：账本一直在记，但「这条值几秒」从前只能推 | scripts/lib/mutate-gates.ts, scripts/mutate-verify.mjs, tests/mutate-verify-gates.test.ts | 是 |
| `30cc9c2` | 09-29 22:39 | 第 192 页 · 装箱键从条数换成实测秒：长尾才是墙钟（结案 #28） | scripts/lib/shard-plan.ts, scripts/mutate-shards.ts, scripts/mutate-verify.mjs, tests/mutate-shards.test.ts | 是 |
| `808445f` | 09-29 22:48 | 第 192 页补 · 那条 CLI 证人把名单押在了仓库历史上：干净树里当场基线红 | scripts/mutate-verify.mjs, tests/mutate-shards.test.ts | 是 |
| `8428269` | 09-29 23:08 | 第 193 页（文档笔）· 把第 169–189 页的结论补进 PROGRESS：仓内不该只剩暂存笔标题 | PROGRESS.md |  |
| `aefc50b` | 09-29 23:26 | 第 194 页 · 取料解析改成有状态：desc 含真换行的那条锚点不该抽不到秒（结案 #30） | scripts/lib/shard-plan.ts, scripts/mutate-verify.mjs, tests/mutate-shards.test.ts | 是 |
| `a3be154` | 09-29 23:55 | 第 195 页（文档笔）· PROGRESS 补第 190–194 页：并行收益改成实测，并记下「同温」这条要求 | PROGRESS.md |  |
| `8e22a30` | 09-29 23:59 | 第 196 页（文档笔·补页）· 台账补齐第 171–173 页：第 170→174 页之间那十笔从前只有笔标题 | PROGRESS.md |  |
| `d0fbe27` | 09-30 00:54 | 第 197 页 · 门表那句手抄墙钟换成实测分母，顺带查清我自己三笔 outputs 没入库 | PROGRESS.md, scripts/gate-manifest.ts |  |
| `e4d2e9b` | 09-30 00:58 | 第 198 页 · 我这簇引用的三个 dated 工件目录入库（32 个文件／约 3.4 MB），入库前过了密钥扫描 | PROGRESS.md, outputs/mutation-cost-rank-2026-09-28/cost-rank.md, outputs/mutation-parallel-shard-2026-09-29/measurements.md, outputs/mutation-parallel-shard-2026-09-29/serial-whole-table-1019.log, outputs/mutation-selector-scan-2026-09-28/fullname-screen-2026-09-28.txt, outputs/mutation-selector-scan-2026-09-28/fullname-screen.mts ＋27 more | 是 |
| `7a96c55` | 09-30 01:05 | 第 199 页 · 台账里 15 个 sha 全是簇内坐标——补一份可复算的逐笔映射，别让页在落库后变成死引用 | PROGRESS.md, outputs/mutation-selector-scan-2026-09-28/cluster-commit-map-2026-09-30.md, outputs/mutation-selector-scan-2026-09-28/cluster-commit-map.mts | 是 |
| `71e740a` | 09-30 01:50 | 第 200 页 · 语义租约把「图外」读成「不相交」——真机演出一次，顺带核掉 #21 一条已发货的假待办 | PROGRESS.md, outputs/impact-cap-decision-2026-09-30/decision-input.md, outputs/impact-cap-decision-2026-09-30/probe-fixture-edges.mjs, outputs/impact-cap-decision-2026-09-30/probe-fixture-split.mjs, outputs/impact-cap-decision-2026-09-30/probe-lease-blindspot.mjs, outputs/impact-cap-decision-2026-09-30/probe-mtime-cut.mjs | 是 |
| `55e1541` | 09-30 02:00 | 第 200 页补记 · 那一页的 (a) 在落库后的 HEAD 上已经不发——我的坐标是从主树读的，而本簇自己就在动那两个文件 | PROGRESS.md, outputs/impact-cap-decision-2026-09-30/decision-input.md | 是 |
| `3c92c09` | 09-30 02:09 | 第 201 页 · 把规则 278 拿去全仓扫一遍，扫出缺陷 A 的第四个消费者：给模型看的仓库地图也吃同一个 mtime 帽，正文一字不自述 | PROGRESS.md, outputs/cap-disclosure-sweep-2026-09-30/mapface-cluster.log, outputs/cap-disclosure-sweep-2026-09-30/mapface-main.log, outputs/cap-disclosure-sweep-2026-09-30/probe-map-face.mjs, outputs/cap-disclosure-sweep-2026-09-30/probe.ts, outputs/cap-disclosure-sweep-2026-09-30/sweep-2026-09-30.md ＋1 more |  |
| `4177280` | 09-30 02:15 | 第 201 页补 · 两个「待核」核完了：都不是缺陷——这次全仓帽普查的真命中只有一处（仓库地图） | PROGRESS.md, outputs/cap-disclosure-sweep-2026-09-30/sweep-2026-09-30.md |  |

统计：页里 21 个 sha 形态引用 token，19 个命中本表的某笔，未命中 2 个——其中**主线可达** 2 个（6849e35 15fad7b＝本簇父提交/主线那笔，落库后仍能查到，不算悬空），**真悬空** 0 个（⇒ 本表加保留的私有 ref 就覆盖了全部悬空引用；压成一笔落库后，簇内那些 sha 在线性历史里不存在，这张表是它们唯一的解释面）