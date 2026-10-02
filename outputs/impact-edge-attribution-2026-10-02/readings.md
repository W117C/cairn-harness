# 第 305 页 · 波及面接上「反证·另有归属」规则（E）——取证

任务 #9。上一笔（第 304 页 `outputs/impact-edge-provenance-2026-10-02/provenance.log`）把四种收紧切法各数了一遍，
只有 E「引用方把这个名字**绑在别处**才摘边」同时满足：真仓摘 576/8769 对（6.6%）、冻结夹具 16 条真值边一条不掉。
这一页是**落地那一半**的取证：判据形状、判卷分辨力、造红 14 台、秒级尺读数、真表现读，以及两处**读数把我自己纠正过来**的记录。

命令事实源＝`package.json` 与脚本头部注释；本页所有数字都来自本目录（或第 304 页目录）里那份日志，不是记忆。

## 1 · 尺的形状

- 判据本体＝`src/agent/impact/attribution.ts`（新增，纯函数、不碰盘、不读图）：
  `attributeRefToDef(binding, defFile)` 回三态 `kept | dropped | no-evidence`；`bindingSourceKey` 是外部包键的唯一构造点；
  `attributionNote` 只负责措辞。取料（每个文件「名字→绑到哪儿」）由 `src/agent/impact/index.ts` 做。
- 三个消费点吃**同一把**判据：边构造（index.ts 的 `verdict` 那一行）、`upward`（`attributableSomewhere`）、`downward`（逐 def）。
  第十三族的老账：同一谓词抄几份、每份宽度不同 ⇒ 这里只留一份决策点。
- 「没证据」与「没关系」分开（规则 261/239）：`nameSources` 里**没有这个文件**＝`no-evidence`（保守计入，照名字图连）；
  有这文件而这个名字**没有绑定**＝`kept`（反证不成立）；有绑定且不含这份定义＝`dropped`。三态各有一个只有它能红起来的用例。
- 两层缓存同判同写：tags 条目从 `{v,mtime,size,tags}` 扩成带 `imports`（读端两个 `Array.isArray` 同判），
  索引 artifact 从 schema 1 升到 2 并带 `nameSources`＋`attribution`，缺任一格或号不符一律按 miss（fail-closed，宁重解析不载半张图）。

## 2 · 判卷：`tests/impact-attribution.test.ts` 22 条（6 个 describe）

| describe | 条数 | 钉的是哪一格 |
| --- | --- | --- |
| attributeRefToDef（三态） | 4 | 四种输入各一答；`no-evidence` 优先于任何 sources；多来源里有 defFile 就留；外部包键由一处构造 |
| attributionNote（措辞） | 2 | 全 0 ⇒ 空串；dropped 与 noEvidence 两格分别出声且各不带对方的话 |
| 边构造与查询 | 5 | 四个引用方各归各位（含**夹具那两档**）；另一份同名定义不消失；downward 逐 def 判；抹掉落料面⇒回到名字图；**冻结夹具 16/16 且 dropped=0** |
| 两层缓存 | 3 | tags 两出口同进同出（抠掉 `imports` 的老条目必须全 miss）；artifact 带 `nameSources`/`attribution`（缺格⇒miss）；**号不符而字段齐全⇒miss** |
| 回注文案 | 2 | 归属句与同名歧义句彼此独立；全 0 时注入文本与接这维之前逐字相同（零回归哨兵） |
| 接线 | 6 | 一条一格（边构造／upward+downward／两出口进缓存与索引／fileSymbols 第二出口／外部包也算证据／fail-loud 那支没被顺手改） |

分辨力设计上的三条本仓规矩：
- **前提当判卷**，不当副作用：`got == want`（夹具 16 条边逐字对齐）＋ `attribution.dropped === 0`。这一条买的是"这一档不许买错"。
- **两态必须不同输出**：全 0 那条钉的是逐字节相同（否则归属句就是恒真文案）。
- **接线一条一格**：六枚针脚如果挤在一条用例里，六个变异会红在同一条上，等于没有分辨力。

夹具那条用例是**反向哨兵**：它不证明规则有效，它证明规则**没越界**（越界＝把 2026-10-01 人工核对并登记在 `note` 里的口径改掉）。

## 3 · 造红 14 台（`red-machines.mts` → `red-machines.log`）

这一台的改法**不手抄**：脚本从 `scripts/mutate-verify.mjs` 的锚点表里解出 `(id, src, 针脚, 改后, expectFail)` 再执行。
第 302 页那台是我手写七条机器，表与机器是两份文字——针脚漂了机器照样红得漂亮，那红证明的是我抄的那份而不是入库的那份（规则 236）。

基准：`tests/impact-attribution.test.ts` 22 条全绿（452ms，未改任何文件）。

| 台（＝锚点 id） | 针脚命中 | 红在声明的那条 killer | 该台红的用例数 |
| --- | --- | --- | --- |
| attribution-no-evidence-read-as-kept | 1 | ✅ 「无证据」优先于任何 sources | 2 |
| attribution-positive-proof-ignored | 1 | ✅ 四种输入各给一个答案 | 5（含**冻结夹具**那条） |
| attribution-only-first-source-counted | 1 | ✅ 多来源里有 defFile 就留 | 1 |
| attribution-reverse-proof-never-drops | 1 | ✅ 四个引用方各归各位 | 4（夹具那条**不红**） |
| attribution-note-dropped-only-gauge | 1 | ✅ 两格分别出声 | 1 |
| attribution-note-prints-zeros | 1 | ✅ 全 0 ⇒ 空串 | 2 |
| edges-not-filtered-by-attribution | 1 | ✅ 边构造吃判据（接线） | 2 |
| upward-attribution-not-applied | 1 | ✅ 无证据那一支 | 3 |
| downward-attribution-not-applied | 1 | ✅ downward 按 def 逐条判 | 2 |
| attribution-note-not-wired | 1 | ✅ 歧义句与归属句彼此独立 | 1 |
| tags-cache-imports-guard-dropped | 1 | ✅ tags 两出口／老条目按 miss | 2 |
| imports-exit-not-eaten | 1 | ✅ 解析走 fileSymbols（接线） | 4 |
| index-artifact-namesources-not-saved | 1 | ✅ artifact 带上 nameSources | 2 |
| index-artifact-version-not-checked | 1 | ✅ 号不符⇒miss | 1 |

汇总行（现读）：**14 台｜杀手命中 14｜存活 0｜残骸 0**，`14 台 → 14 个不同 killer；重复声明 0`，三个被测面复原后与备份**逐字节一致**。

两台的形状值得单独说一句，因为它们是这一档的"松紧两端"各有观测者：
- `positive-proof-ignored`（太凶：连正证也判死）红在**冻结夹具**那条；
- `reverse-proof-never-drops`（太松：反证不摘）红在**四个引用方**那条，而夹具那条不红（夹具本来 dropped=0）。
所以"摘多了"与"没摘"落在不同用例上，不是一句"清单变短了"的两个方向。

## 4 · 秒级尺（`mutate-verify --check-needles`）

- 动实现之前（工作树，1295 条）：`阻断 0，待复认 1，未覆盖 1，逐行式 5，未入库面 0，钉在飞文本 0，killer 指针失效 0`
  ⇒ 我对 `impact/index.ts`、`persist.ts` 的改动没打断任何既有锚点的针脚。
- 加完 14 条锚点（1309 条）：`阻断 27，待复认 1，未覆盖 1，逐行式 5，未入库面 20（被测面＋判卷两面），钉在飞文本 7，killer 指针失效 0（其中 HEAD 侧 0）`
  ｜`改法语法体检：1309 条改法全部产出合法源文件 ✅`。
- 这 27 条阻断**全是同笔未落库的预期读数**（尺与针脚同笔，规则 217）：20＝`attribution.ts`＋新判卷不在 HEAD（10 条 × 两面），
  7＝index.ts/persist.ts 的新针脚在 HEAD 里 0 处。落库后这两维应归零；不归零就是拆了笔。
- 待复认 1 条（`verify-lang-timeout-same-as-npm`）与未覆盖 1 条是隔壁那格的旧水位，本笔没动它们。

## 5 · 真表现读（生产面 A/B）

见 `ab-upward.log`（`node --import tsx scripts/probe-impact-provenance.ts`，PROBE_EXIT=0，自检 ✅）。
取料＝**生产缺省帽**：`帽＝5000 → 图内 593 文件／帽前候选 593`（本仓候选数低于帽 ⇒ 实际全量）。

图上三态计数（`buildImpact` 自己带的那份，不是探针重算）：**kept=45231｜dropped=1687｜noEvidence=0**
⇒ 摘掉的占 `(kept+dropped)=46918` 的 **3.6%**。这一档本来就只买"另有出处"那一点，买不起多。

同分母 A/B（**同一张图、只把取料面抹成空表**＝接这一维之前的行为；两臂都走同一个 `upward`）：

| 名字 | 图内定义点 | A（接判据后） | B（抹掉落料面＝旧行为） | 清单变化 |
| --- | --- | --- | --- | --- |
| `writeFile` | 1 | 3 处／**3 文件** | 461 处／141 文件 | −138 个文件（−98%） |
| `readFile` | 1 | 8 处／**5 文件** | 286 处／115 文件 | −110 个文件（−96%） |
| `createEventLog` | 1 | 142 处／71 文件 | 142 处／71 文件 | **0**（真枢纽一处不掉） |
| `runLoop` | 1 | 51 处／33 文件 | 51 处／33 文件 | **0** |

- 分母别看混：第 304 页那句「摘 576/8769 对（6.6%）」量的是 **(ref→def) 对**，这一页的 −98%/−96% 量的是**单个大户的调用方文件清单**。
  同一件事的两个层，数字不许互借。
- 交叉核对：B 臂 `writeFile`=141 文件，与第 304 页 `provenance.log` 那格的 140/141 对得上（两次独立取料，同一分母）。
- `noEvidence=0` 是本仓的形状（每个入图文件都解析出了 import 面）；那一支在假表里另有专门用例（`attributableSomewhere` 的
  `candidates===0` 与 `known===false` 两支），别把这页的 0 读成"那一格没人守"。

模型实际看见的那一句（走生产的 `fileImpact` → `contextNoteFor`，不抄文案）：

```
[impact] src/agent/ledger.ts 定义符号的跨文件调用点（上 43，波及 17 个文件；其中 11 个符号在别的文件也有同名定义，
波及数按名字图算 ⇒ 清单里可能混有无关文件；归属判定：1687 处已按「同名但另有出处」排除；完整清单见 impact_report 事件）：
```

第二处（编辑 `src/agent/impact/index.ts`）同形状：`波及 14 个文件；其中 4 个符号…；归属判定：1687 处已按…排除`。
同名歧义那句**没被改掉也没被并进**归属句——它钉的是"有同名定义"这个结构事实，归属句钉的是"这一张图判掉了多少"，
两句话各自可验（判卷里那两条用例分别盯着）。

## 6 · 两处读数把我纠正过来

**① 帽 400 是我自己加的，不是生产的形状。**
第一版生产面自证写的是 `buildImpact({workspace: REPO, maxFiles: 400})`，读出 `writeFile` 的 A 臂与 B 臂**一模一样（244 处／73 文件，掉 0 个文件）**，
看起来像"规则对这一格无效"。加了一列"定义点数"之后当场露出成因：**`writeFile` 的定义点=0**——
那份定义在 `tests/secrets.test.ts`，而扫描按 mtime 降序排，400 名之外，压根没进这张图。
`upward` 在没有别处定义时按口径不摘（`attributableSomewhere` 的 `candidates === 0` 那一支），所以规则看着没动。
而生产缺省是 `MAX_FILES_DEFAULT = MAX_FILES_CEILING = 5000`（`src/agent/map/cap.ts:20-21`），本仓 593 个候选**全量入图**。
⇒ 探针改成吃生产缺省帽再量（上面那张表就是重测后的读数），并把这段成因写在取料处注释里
（"一片 0 先怀疑量法与 join 键"，规则 248/237）。
顺带留一格**没建门的事实**：帽 400 那种截断图里，一个名字可以"有 244 处调用点而图内定义点=0"，
此时 `upward` 照旧全额给清单——今天的口径就是这样，不是缺陷，但读的人需要知道（覆盖面自述那句负责说它）。

**② 改判卷用例标题是跨面动作。**
全量判卷第一遍红 1 条：`tests/head-cert-deps.test.ts > 真机整表 … 档位计数与逐行重数必须同分母`，
`取不到成因的条数必须是 0：expected 1 to be +0`。归属要用证人而不是推测：`headcert-notresolved-probe.mts`
**复用那把尺自己的取料**（`suiteRows` 读留档 json、`budgetFromTestSource` 回源码认标题；不另写一份匹配，否则拿到的数与门不一样），
读出 `语料条数=3721｜取不到成因=1`，那一条是 `tests/impact-persistence.test.ts :: ⑨ artifact 字段齐全：schemaVersion=1、…`——
**是我这一笔改的标题**（我把它改成"schemaVersion 与常量一致…nameSources/attribution…"）。
`budgetFromTestSource` 按 `JSON.stringify(title)` 在源码里逐字找标题（`scripts/lib/head-cert-deps.ts`），
而它的取料是**当天留档的那份 json**；那份留档按规矩不许改（它是当天的证据），改名要同轮换语料——那是隔壁那把尺的取料面。

两态都有可重跑的日志（`headcert-rename-machine.log`，MACHINE_EXIT=0）：
把标题换成我那一份 ⇒ `取不到成因=1` 并点名那一条；退回 ⇒ `取不到成因=0`。备份复原、`cmp` 逐字节一致、残骸 0
（复原一律用 `cp` 备份，**不用** `git checkout --`：这个文件里还有本笔其它断言，那是不能抹的在飞面）。

⇒ 处置：标题**退回 HEAD 的原文**（`cmp` 逐字节一致 ✅），版本号的真实出处仍钉在 `IMPACT_INDEX_SCHEMA_VERSION`，
"为什么从 1 升到 2"由 `tests/impact-attribution.test.ts` 那条"1→2"守着；用例体里新增了两条字段断言。
这一格不是尺错了，是尺在工作：它把"改标题"这个动作的隐藏消费者当场指了出来（规则 253 那一族）。
退回后重跑那三个文件：`Test Files 3 passed (3)｜Tests 147 passed (147)`（`targeted-after-title-revert.log`，VITEST_EXIT=0）。


## 7 · 刻意不锚的那一格（写理由，不留空白）

`IMPACT_INDEX_SCHEMA_VERSION` 这个**数字本身**（2 退回 1）没有独立观测者：老 artifact 是 schema 1 那版代码写的，
里面根本没有 `nameSources`/`attribution` 两格，载入时字段完整性那道 fail-closed 先拦掉了，版本号对不对都到不了那一步。
给它配针脚只能靠"在判卷里再写死一个 1"——那就是恒真尺＋两处各写一个数字。
所以这一格的守卫落在**能观察到的那一支**：`index-artifact-version-not-checked`（拆掉版本比对 ⇒ 号不符但字段齐全的那条用例红）。
判卷里那句 `expect(IMPACT_INDEX_SCHEMA_VERSION).toBeGreaterThan(1)` 钉的是"这版动过号"这个事实，不是"等于 2"。

## 8 · 门耗时（量纲说清，不互借）

| 尺 | 现读 | 出处 |
| --- | --- | --- |
| `mutate-verify --check-needles`（1309 条针脚，秒级） | 15s（墙钟，本机） | `/tmp/dsh-needles-t2.log`（NEEDLES_EXIT=1＝§4 那 27 条预期阻断） |
| 本笔判卷单文件 `tests/impact-attribution.test.ts`（22 条） | 452ms（vitest Duration） | `red-machines.log` 基准那一行 |
| 影响面族 12 个判卷文件（171 条） | 6.94s（vitest Duration；墙钟 8s） | 本页落库前重跑 |
| 全量核心判卷 293 文件（4054 条） | 185.44s｜`SUITE_EXIT=0` | `suite-full.log` |
| 整张变异表逐台实跑（1309 条） | **本笔没跑**，不借上面任何一个数 | — |

- 全量判卷第一遍是**红 1 条**的（4053 绿），那条就是 §6② 的改名；退回标题后重跑才是上面这份 4054 全绿。
- 造红 14 台的整套墙钟没单独计时（每台跑的是同一个判卷文件，单文件 452ms 那一档是它的单位量纲）。

## 9 · 本笔落库前的取证清单（同笔入库；击杀与认证两份记在「页补 凭证」那一笔）

| 工件 | 是什么 | 关键读数 |
| --- | --- | --- |
| `readings.md` | 本页正文 | — |
| `red-machines.mts` / `red-machines.log` | 14 台造红（改法从锚点表解出，不手抄） | 14 台／命中 14／存活 0／残骸 0／14 个不同 killer |
| `ab-upward.log` | 生产面 A/B（`scripts/probe-impact-provenance.ts`，生产缺省帽） | kept=45231｜dropped=1687｜writeFile 141→3｜readFile 115→5｜两枢纽不动 |
| `suite-full.log` | 落库前全量核心判卷（第二遍） | 293 文件／4054 条全绿｜185.44s｜`SUITE_EXIT=0` |
| `targeted-after-title-revert.log` | 退回标题后重跑那三个文件 | 3 文件／147 条｜`VITEST_EXIT=0` |
| `headcert-notresolved-probe.mts` / `.log` | 归属探针（复用门那份取料） | 3721 条｜取不到成因=0（退回后） |
| `headcert-rename-machine.mts` / `.log` | 「改标题会红」那两态的造红台 | 改名=1 并点名⑨；退回=0；残骸 0 |
| `../impact-edge-provenance-2026-10-02/provenance-post-wiring.log` | **被纠正的那一份**（`maxFiles: 400` 的生产面读数） | writeFile 两臂同值＝定义点 0 造成的截断图假读数，见 §6①；别当生产读数引用 |

