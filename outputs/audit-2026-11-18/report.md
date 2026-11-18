# 全仓体检 · 2026-11-18（Asia/Shanghai）

审计口径：只读扫全仓 + 定点修复；结论按「刻意为之 / 遗漏 / 隐患」三分类，每类给依据（ADR、判卷、代码注释、命令输出）。
基线 = 审计开始时的 `8626498c`，七门全 pass。

## 〇、读数（修完之后）

| 门 | 读数 |
| --- | --- |
| 核心套件 `pnpm test:capped` | **714 文件 / 8387 条全绿**（maxWorkers=2；基线 8386，+1 本条新判据） |
| 桌面套件 | **429 文件 / 2794 条全绿**（基线 428/2788，+1 文件 +6 条） |
| `verify-all` 七门 | **pass**（typecheck / docs-check / bot-report / standard-report / parity / core / desktop） |
| `desktop-boundary-check` | 绿（src 无反向依赖、无 UI import） |
| `renderer-layer-check` | 绿（257 个渲染层源文件，I1–I4 全过） |
| `evidence-typecheck-check` | 12 条危险码／帽 12（未涨） |
| 四份真机证据 | **重签**（rendererDigest 随源变化，四支探针重跑：CDS 值 0 错、IME 6/6、队列键 6/6、浮层互斥 5/5） |

⚠️ 一个过程读数：第一次 `verify-all` 是 **fail** 的——不是逻辑回归，是我改了 renderer 源之后
四份真机证据的代次对不上（`staleEvidenceReason` 报「证据与当前 renderer 源不是同一代」）。
这正是那五支判卷存在的意义：**改过 renderer 就必须重跑探针并提交新读数**，旧读数不许冒充当前构建。
重跑探针的坑记一笔：三个冒烟脚本的参数是**目录**不是文件（传文件会 `EEXIST` 崩在 mkdir 上，
进程挂住不退出——看起来像"卡死"）。

---

## 一、第一性结论（三句）

1. **这个仓的工程质量问题已经不在「有没有判卷」，而在「判卷与实现谁先动」。**
   本轮四个真缺陷里，三个是**同一语义存在第二份实现**（相对时间分档、项目名规矩、原生视图让位账），
   一份动了另一份没跟——不是没人测试，是测试钉在了错的那一份上。

2. **「未开发完成」绝大多数是**刻意的**，并且写在了对的地方（ADR / STATE / 代码注释）。
   真正缺的不是功能，是**接线的两头**：模块写好了、判卷没钉它、于是没人发现没人用。

3. **工作区不需要再大扫除。** 昨天清场后，仓内已无孤儿文件；今天剩下的 1GB 级体积是
   **工具态**（快照/外部 agent 的账本），不是仓的垃圾——动它才是破坏。

---

## 二、已修（4 项，各带判卷）

### 1. 原生视图让位：账写了，两头都没接（遗漏，第 1261 页一直挂着）

- **现象**：`apps/desktop/src/renderer/state/native-view-occlusion.ts` 2026-11-16 就写好计数制账本，
  全仓**零个 import**。命令面板 / 模态面 / 拖放蒙层开在浏览器窗格上时，`WebContentsView`
  （不是 DOM，z-index 盖不过）照旧画在最上层。
- **根因**：模块先落、消费者后补，中间没有判卷把「有人持有吗」钉住；状态页把这条记成「接线未完成」，
  但记在文档里不产生红。
- **修法**：三个持有方（`ModalSurface` 恒持有、`CommandPalette` 按 `open`、`WorkbenchOverlays` 按
  `dragOverApp`）+ 一个宿主（`BrowserPane` 订阅 `useNativeViewHidden`，让位时 `hideAllViews`，
  账清零后按容器矩形贴回）。
- **判卷**：`apps/desktop/tests/native-view-occlusion.test.ts`（3 条，读整张应用面）。

### 2. 入站空文本：空串一路走到起跑（遗漏）

- **现象**：`ImInboundMessage` 只有 `text`（图片/文件 V1 不承载，这是刻意的）。微信发一张图 ⇒
  适配器归一化出 `text: ""` ⇒ 宿主无闸 ⇒ `routeInbound` **先建会话再起一次空跑**：
  白烧一次模型调用，会话里多一个空气泡。
- **根因**：契约里「入站消息非空」这条不变量没有任何一处强制；每个平台各自 `trim()`，
  但没人断言结果非空。四个适配器 × 一个宿主 = 四份假设，零份保证。
- **修法**：闸设在唯一漏斗 `src/im/host.ts:onMessage`，四个平台共同受益；空串回一句如实的范围说明
  （沉默会被读成「坏了」），不路由。
- **判卷**：`tests/im/host.test.ts`「空文本闸」+ 反向锚点（有文字照旧路由，闸只挡空串）。

### 3. 项目名规矩两份，已经漂了（遗漏）

- **现象**：核心 `project-create.ts` 查全套（空/长度 64/`/\:*?"<>|`/控制字符/前导点/尾随点）；
  渲染层 `NewProjectDialog` 只查 `\ /` 与控制字符。输入 `a:b`、65 字符、`.hidden`、`尾巴点.`
  四档都是**对话框绿、点创建才被核心拒**——「实时校验」在那些字符上是假的。
- **根因**：规矩是业务事实，却被写成了两份 UI 判据；渲染层拿不到核心那份（`project-create`
  带 `node:fs`，进不了浏览器上下文），于是抄了一份——抄漏四档。
- **修法**：抽出零依赖纯模块 `src/main/project-name.ts`（`projectNameProblem()` 只返回**档位**），
  核心与渲染层共用；两面的文案各自保留（核心中文句 / 渲染层 STR 键）。
- **判卷**：`new-project-dialog.test.tsx` 新增四档 + 五个反向锚点（64 字符边界、内部点、中文、空格不误伤）。

### 4. 相对时间两份分档（隐患 · 已发生漂移）

- **现象**：会话面 7 天后改显绝对日期，记忆页 30 天。同一个「8 天前」在两页显示成两种东西。
- **根因**：参数序不同（`now, ts` vs `iso, now`）被当成「两个函数」，于是各写一段 if 阶梯；
  差异原本只是一个阈值，却变成了两份实现。
- **修法**：`relative-time.ts` 吃一个显式的 `absoluteAfterDays = 7`；`memory-view` 改为委托并传 30。
  **差异留在参数里，不再是第二份实现。**
- **判卷**：`memory-view.test.ts` 新增「7 天内两面逐字同词」+「各自档外改显绝对日期」。
- 附注：修的第一版判卷是我自己写错了前提（以为两面该全程一致），红了一次才看清——
  这就是「先用判卷说清自己到底要什么」的价值。

---

## 三、刻意为之（不是欠账，别再当 TODO 追）

| 项 | 依据 | 判断 |
| --- | --- | --- |
| IM 图片/文件 V1 不收 | `ImInboundMessage` 只有 `text`；STATE「未决」明写 | 刻意。但**契约没有扩展点**：将来加附件要动 4 个适配器 + 宿主 + UI。建议先放一个可选 `attachments?` 空字段把缝留出来 |
| 群聊只收 @ 机器人的消息 | `host.ts` 群聊闸；避免刷屏 | 刻意。没有「收全部群消息」的开关——如需要是新功能，不是 bug |
| 微信恒 `kind:"direct"` / `mentioned:true` | iLink 是逐用户会话（`context_token` 私有），机器人收不到旁人群聊 | 刻意且正确 |
| 插件 handler 若干档「装载即拒」 | `plugins/hooks.ts:98` 明写「运行侧没有这条 handler 的传输实现」 | 刻意（fail-closed 点名，不静默） |
| `verify` 未接线时 fail-closed | `agent/loop.ts:705`；桌面已接 `createVerifyHook` | 刻意（防御分支，给别的嵌入方） |
| `outputs/` 里 203 个 .ts / 242 条 tsc 报错 | `evidence-typecheck-check` 登记帽 12 条危险码，只准降 | 登记在案的债，不是失控 |
| `PROGRESS.md` 5MB append-only | AGENTS.md 分层纪律 | 刻意 |
| `.mimosa` 470M / `.alma-snapshots` 495M | 外部 agent 账本 / 本应用的快照库，均已 ignore | **不是仓的垃圾**，删了是破坏 |

---

## 四、仍未完成 / 未接线（按优先级）

| P | 项 | 现状 | 依据 |
| --- | --- | --- | --- |
| P1 | 证据面 242 条 tsc 报错（12 条危险码） | 帽 12，ratchet down only | `evidence-typecheck-check` 现读 |
| P1 | 变异门禁无独立自愈入口 | 残留突变只能等下一次整表跑才自愈；`restore` 不是子命令（实测「未知 id: restore」） | `scripts/mutate-verify.mjs` |
| P2 | IM 契约无附件缝 | 见上表 | `src/im/types.ts` |
| P2 | 微信扫码全流程待真机目验 | 代码+判卷齐，缺人眼 | STATE 未决 |
| P2 | 玻璃观感/其余通道真机全流程待目验 | 同上 | STATE 未决 |
| P2 | `apps/desktop/src/main/index.ts` 2250 行 | 组合根，无帽可依 | 量的是体积，不是判决 |

---

## 五、工作区整理

**本轮已做**

1. `.worktrees/gate-mutate-verify` 里残留一次未还原的变异（`prompt-surface.ts` 的 `if (false)`，
   自 11-17 21:15 挂到现在）——已还原并清掉 `.mutbak`（先逐字节核对备份 == HEAD 才删）。
   这是真事故型残留：那棵树上一小时前还在被人当「干净树」读。
2. 审计自己的日志归档到 `outputs/verify-all/run-2026-11-18-audit.log`。

**已执行清理（保留分支，只回收工作树检出；每支的「脏」都核过是垃圾、6 小时内无任何写入、无进程占用）**

回收前逐支核过三件事：① 脏改动内容（下表的「实情」列）；② 6 小时内是否有文件写入（均无）；
③ 是否有进程占用（无）。执行后 `git worktree list` 只剩主树 + 两棵共享门禁树，四个分支
（`simplify-desktop-design` / `enhance-task-capabilities-tools` / `single-woodpecker` /
`audit-optimize-desktop-design`）与它们各自的 18–24 笔独有提交**原样保留**，需要时可从分支重建检出。
`/Users/ze/alma/worktrees` 从 **4.6G → 20K**。

| 工作树 | 脏改动实情 | 体积 |
| --- | --- | --- |
| `~/alma/worktrees/cairn/continued-reindeer` | 只是一条 `.alma-snapshots` 忽略规则（主枝已有）+ 未跟踪 `apps/desktop/outputs/` | 613M |
| `~/alma/worktrees/cairn/cultural-fox` | 同上 | 640M |
| `~/alma/worktrees/cairn/single-woodpecker` | 同上 + 一个 11-16 就删掉的设计稿 | 612M |
| `~/alma/worktrees/cairn/pleased-slug` | 干净（批 10 收口线，head-cert 已记录） | 1.6G |

合计 **4.6G**，已回收（`git worktree remove --force`，分支不动）。回收后七门重跑 **pass**——门禁不依赖这些检出。

`.worktrees/gate-head-cert`（主枝，1.1G，落后 139 笔）**没动**：它是 head-cert 门复用的检出树，
删了那道门就得重建；它干净、不占人多的地方，留着比删了便宜。

**不可动**

- `.worktrees/gate-mutate-verify`（1.3G）：共享变异门禁树，`package.json`/`tests` 复用。
- `oh-src/README-moved.md`：唯一记录外部语料迁移路径的指针。
- `.alma-snapshots`（495M）：本应用版本快照库——删了侧栏历史就没了。
- `.mimosa`（470M）：别的 agent 的账本，不是我们的。
- `outputs/` 926 个日期目录（259M）：PROGRESS 台账逐页引用，是引用面不是垃圾。

---

## 六、建议路线

1. **P1 证据面收口**：242 条报错里挑 12 条危险码逐个修，帽从 12 → 0（ratchet 只降，改一处降一处）。
2. **P1 变异门禁加 `--heal`**：现在只有整表跑才会自愈；一条独立入口能在任何人接手那棵树前先归零。
3. **P2 IM 契约留缝**：`ImInboundMessage` 加可选 `attachments?`，四个适配器各留一个「看不懂就忽略」的分支。
4. **P2 工作树回收**：上表四支执行，省 4.6G；分支不动。
5. **长期**：把「同一语义两份实现」当红牌——`relativeTime` 与 `validateProjectName` 都是先有第二份、
   再靠人发现分叉。可加一条机检：跨文件同名导出必须在白名单里（本轮手工筛出 8 个，其中 3 个是真债）。
