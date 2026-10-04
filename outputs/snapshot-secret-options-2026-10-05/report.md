# #100 快照不过脱敏：三行选项表（只读取证，2026-10-05）

全部现读自 HEAD（`05d3d0f3`）。主工作树有别人未提交改动；本报告引用的都是 `git show HEAD:<path>`。
唯一例外：`.gitignore` 工作树与 HEAD **逐字节相同**（`git diff --stat HEAD -- .gitignore` 空），所以那条口径现读对工作树同样成立。

---

## 1. 现状（现读）

**快照实现** `src/tools/snapshot.ts`：`copyFile(abs, join(workspace, id))`（:41）**按字节抄、不过任何脱敏**；
id = `.agent/snapshots/<毫秒>--<callId>/<原相对路径>`（:11,:21-23）；best-effort，失败只 `console.warn`（:44）。
回执文案 `snapshotNote`（:54-56）明写「按字节抄的……别用 read_file 转写复原」。
**三处写手**：`write_file.ts:46`、`edit_file.ts:81`、`apply_patch.ts:262`；`worker-tool-table.ts:61,77` 显式传 `snapshot:false`。
`ctx.snapshot` 定义在 `src/tools/base.ts:44`，**没有任何用户可达开关**（loop/cli 都不传）。

**事件流那条路是全量脱敏的**：`src/agent/loop.ts:114-134` 的 `redactValue`/`redactEventForLog` 递归字符串叶子过 `redactSecrets`；
在落盘口做的理由写在 :12-14——「事件日志是**可重放**的……`sanitizedEnv` 只挡 `process.env`，挡不住工具**读出来的文件内容**」。
`redactSecrets` 与 `blocked` 住在 `src/agent/security/scan.ts:433-460`；`blocked = findings.some(severity==="critical")`（:459），
而 `SECRET_PATTERNS`（:61-77）里 **critical 只有一条**（私钥块），其余 6 条是 high，`secret.assigned`（赋值式凭据）是 **confidence: medium**。

**私有目录先例** `src/agent/solpi-runtime.ts:26-46` `privateSessionDirectory`：`mode 0o700` + lstat 反软链复查，
且 :33 **强制要求落在 workspace 之外**（`SoL-Pi requires private session-data outside workspace`）。

### `.gitignore` 现读结论（这条是决定严重度的那一格）

**`.agent/snapshots/` 没有被忽略。** 现读 `git show HEAD:.gitignore`：
忽略的是 `.agent/memory/`(:14)、`.agent/permissions.always.json`(:18)、`.agent/sessions/`(:22)、以及**靶子区那一支** `fixtures/todo-app/.agent/`(:27)。
**没有 `.agent/snapshots` 这一行**；`git check-ignore -v --no-index .agent/snapshots/x.txt` **不命中**（同一条命令对 `.agent/memory/x`、`.agent/sessions/x` 都命中并回指行号）。
:9 与 :21 两处注释自陈这是**有意**的——「不整体忽略 `.agent/`」，因为 `.agent/permissions.json` 要跟踪。
⇒ 根级 `.agent/snapshots/**` 是 **untracked 但未被忽略**：`git status` 看得见、`git add -A` 会扫走。
旁证：`git status --porcelain .agent` 现读回 `?? .agent/rules/`、`?? .agent/skills/`——同族未忽略子目录确实以 `??` 出现在面上。

**这一条把洞从「本地盘多一份副本」升级为「会随提交外泄」**，而且形状很难看：
同一次运行的**会话 JSONL 被判定要忽略**（:19-22 明写「这是运行产物，与 `.agent/memory/` 同理不进 git」，里面装的正是工具输出原文＝同一族内容），
而**快照目录没有**。（`git log --all -- '.agent/snapshots/**' 'fixtures/todo-app/.agent/**'` 空 ⇒ 历史上从未提交过。）

**承诺面现读**：没有任何测试或文档承诺过快照「不进仓」。相反，`snapshot.ts:4-6` 与 `outputs/architecture-uplift-2026-09-21.md:179,182`
记档的是**「它会出现在用户仓库的 git status 里」这条代价**；而 `PROGRESS.md:12471` 已经抓到这条代价**在本仓被自己的 .gitignore 静音了**
（`fixtures/todo-app/.agent/` 整支忽略 ⇒ 没人看得见），`PROGRESS.md:12353` 顺手量过：那里面堆着 **700 份**运行快照。
**全仓没有任何帽/ TTL / prune**（`src/tools` 内 grep `MAX_SNAPSHOT|prune|retention|TTL` 空）⇒ 只进不出。

## 2. 这个洞现在有多真

- **写手 3 处**（上节），不多不少；改一处 `snapshot.ts` 就覆盖全部。
- **盘上存量**：根级 `.agent/snapshots/` **不存在**（0 文件）；`fixtures/todo-app/.agent/snapshots/` **749 文件 / 2.9M**（全部落在被忽略的那一支）；`.worktrees/head-cert-f01c448/…` 在两次调用之间已被隔壁回收（先前 `find` 见 3 文件，探针跑到时目录已不存在 ⇒ 记为**在飞面**）。`git ls-files | grep -c snapshots/` ＝ **0**（当前无一份入库）。
- **凭据命中**：探针（`probe-snapshot-secret-hits.ts`，只读、跑本仓自己的 `redactSecrets` 判据、只报文件名与计数）扫 749 份：
  **FILES WITH HITS ＝ 0，blocked ＝ 0**，类别分布空。**盘上现存快照里没有真凭据**（靶子区抄的是 `src/todo.ts` 那一族）。
  ⇒ 现读结论：**这是一条通路，不是一起事故**——0 命中不代表安全，只代表这条路上还没走过带凭据的文件（本仓工作区不是真实用户仓库）。
- **未定名的一格**：真实风险面是 `apps/desktop` 首启工作区默认落仓库根（.gitignore:19-21 自陈），那次运行的 JSONL 进被忽略的 `.agent/sessions/`，
  而它的快照进**不被忽略的** `.agent/snapshots/`。桌面端非 v1 交付面（`docs/adr/0001`），但仍在提交。

## 3. 三行选项表

| 修法 | 改动面（现读点名） | 代价与副作用 / 对「逐字节」诚实吗 | 最小第一步 |
|---|---|---|---|
| **A. 文本快照落盘前过 `redactSecrets`**（`safety-floor-head` 报告 :29 拟的那版） | `src/tools/snapshot.ts`（`copyFile` 换成读-脱敏-写，要引 `scan.ts`）；**回执文案 `snapshotNote` 那句「按字节抄的」变成假话，必须改**（`scripts/probe-promise-recall.ts:854,967` + `scripts/probe-snapshot-copy-restore.ts` 两支复现器跟着改）；`tests/snapshot-d7.test.ts:38,59` 与 `tests/snapshot-rollback-route.test.ts:42,75,89,99`（`toEqual(bytes)` 那条二进制案）**逐条重写口径**；3 条变异锚点（`mutate-verify.mjs:4660,4676` 等按**源文本精确 replace** 插针）会因源码行改动而**静默失配** | **不诚实，而且是最坏那种不诚实**：命中才掩 ⇒ 承诺从「恒真」变成「**概率真**」，用户以为拿回原件、实际拿回掩码文件（回滚＝二次破坏，且无 reader 能告诉他）。`redactSecrets` 按行切文本 ⇒ **二进制/ DER / keystore 快照整条覆盖不到**，而那类恰恰最像凭据容器。帽与 mtime 语义连带变 | 不能只出声：本行没有「不改语义」的版本。**可先做的是量命中面**——把本报告探针登记成 #100 的存量读数 |
| **B. 命中凭据即拒绝拍快照 ＋ 出声** | `snapshot.ts` 加一次 `redactSecrets(...).blocked` 判定（复用 `remember.ts:58-64` 的「拒绝＋说去处」契约）；`snapshotNote` 要加一句「这次没保住」；`ToolResult.snapshotId` 的「缺席＝三因合一」变**四因**（`base.ts:31-32`、`handoff-face-2026-10-05/report.md:123` 已抓到三因难分）；`tests/snapshot-d7.test.ts:46-47,92-93`「不该有快照」那两案的语义要重新解释；锚点 `d7-snapshot-taken-for-new-file`（:4660）与「新建不占快照」那格判卷要复查是否被顶掉 | 对**落了快照的那些文件逐字节诚实**（这条承诺保住）。但那一格变成**「含凭据＝不可回滚」**，而触发档极不稳：`blocked` 只对**私钥块**为真 ⇒ 绝大多数凭据照抄不误（修不干净）；若把阈值放宽到 `findings.length>0`，则 medium 置信的 `secret.assigned`（`token: <12字以上>`，:74-77）会**在普通配置/源码上大量误触**，回滚能力静默消失。**把人推向关掉快照的风险是真的**：`ctx.snapshot:false` 已存在（`base.ts:44`）且是那条「回执说实话说不该假装能回滚」的路（rollback-route:109-115） | ✅ **可行且不触语义**：只**出声**——`snapshotNote` 补一句「快照本身是明文副本，别提交」＋把「本次快照命中凭据」记进台账存量。A/B 都还没做 |
| **C. 快照挪出「会进仓」的那张面**（两型：C1 私有目录，照 `privateSessionDirectory`；C2 仍在 workspace 内但补 `.gitignore` 一行） | **C1**：`snapshot.ts`（路径＋`0o700`/反软链，抄 :26-46 那套）；`ToolResult.snapshotId` 从「workspace 相对」变绝对（`base.ts:31-32` 文档语义变）；**致命处：`resolveInWorkspace`（`base.ts:98-111`）拒绝对外与越界路径 ⇒ `read_file` 再也读不到快照**，模型唯一那条取回路线（「复制该文件」）归零，要新增 reader 工具/CLI 出口；`tests/snapshot-d7.test.ts:47,68,93` 硬编码 `.agent/snapshots` 字面量、`snapshot-rollback-route.test.ts` 全部 5 案、`lsp.test.ts:11`/`write-line-delta.test.ts:11` 的 marker 都要跟着改；`reproducibility.ts:91-101` 的 #56 两条身份债要重述 | **C1 对承诺最诚实**（原件字节不动、秘密不进仓），但**代价是把「可回滚」那一格从「有原件＋模型可读」打成「有原件＋无人能取」**：`verdict.md:204` 实测全仓零 reader，今日唯一的 reader 就是 `read_file`（rollback-route:41 正是钉住它「不该拒绝读 `.agent/snapshots/**`」）。**C2 便宜一个数量级**：一行 `.gitignore` + 一条判卷，逐字节承诺与 read_file 路线**都不动**；它关掉的是**分发**通道，不关本地盘副本 | ✅ **这就是最小第一步，且它本身就是 C2 的全部**：`.gitignore` 加 `.agent/snapshots/` 一行。仓里有直接先例——#57 把 always-allow 授权搬到 `.agent/permissions.always.json` 同笔加忽略行，并配一条**读 `.gitignore` 的判卷**（`tests/permissions-always-file.test.ts:37-39`：「否则搬了地方也照样随仓库分发——那等于没修」） |

## 4. 推荐

**推荐 C2（`.gitignore` 加一行 ＋ 照 #57 那条先例配一支读 `.gitignore` 的判卷）作为这笔；A/B 都不做；C1 与「帽/TTL」登记为 #100 的后半。**

理由（每条都有现读出处）：
1. **外泄通道是「提交」，不是「抄」。** 带凭据的原件**本来就在盘上、本来就在那个 workspace 里**；`copyFile` 增加的是第二个位置，而真正让它离开机器的动作是 commit。`.gitignore:19-22` 已经对本仓自己作过这个判断——同一次运行的会话 JSONL（内容族相同：工具输出原文）被明确判为「运行产物，不进 git」。快照目录是被**漏掉的那一支**，不是被否决的那一支。
2. **它是唯一不改语义的一格。** A 把「逐字节」从恒真改成概率真（最坏的不诚实）；B 让含凭据文件不可回滚且触发档不稳；C2 之后 `snapshotNote` 那句话、`snapshot-d7` 与 `snapshot-rollback-route` 两支判卷、三条变异锚点**一个字都不用动**。
3. **它顺手把 #100 唯一的可见性债还了。** `PROGRESS.md:12471` 记档的那条「被记档的代价只由受害面自己上报、而仓库把那个面静音了 ⇒ 等于没记过」，正是靠 C2 让 `git status` 重新可见（或反向：让忽略变成显式决定而不巧）来终结。
4. **诚实边界要说清**：C2 **不**解决「秘密以第二副本形式无帽地堆在本地盘」。那格留给帽/TTL（现读全仓零 prune）与 #56（路径含毫秒，`reproducibility.ts:91-101` 已挂「待人裁」）——它们与 C2 同一张面，一次决策比三次便宜。**盘上 0 命中**说明今天还没有存量要清；越晚做，存量越贵。

## 5. 为什么这一格必须人拍板，不许 agent 自己改

1. **安全语义**：A/B 二选一是在改「脱敏承诺覆盖哪些面」——本仓对 `blocked` 的用法是有契约的（`scan.ts:428`「调用方应拒绝而非仅脱敏」、`remember.ts:58-64` 拒绝、`loop.ts:117-119` **明写这里不能抛错**）。给落盘面新增第三种拒绝语义＝改契约。
2. **已钉承诺**：「逐字节」这条昨天才同时钉进**判卷**（`tests/snapshot-rollback-route.test.ts`）、**模型可见文案**（`snapshotNote`）和**两支复现器**（`probe-promise-recall.ts:967`、`probe-snapshot-copy-restore.ts`）。AGENTS.md 写着「Do not modify frozen judge files or fixtures as a workaround」——把判卷改到允许「近似一致」正是那条禁令的形状。
3. **目录约定**：`.agent/` 的忽略面是**显式决策**（.gitignore:9、:21 两次自陈「不整体忽略，因为 permissions.json 有意跟踪」），且 `.agent/` 同时是**系统区写闸**（`base.ts:175-193` `assertNotAgentArea` 双闸＋反软链）。加/挪一行都动到那张已被两支判卷硬编码的表。
4. 另有两条只有人能给的东西：**#56 至今「仍待人裁」**（`head-gate-triage-2026-09-24.md:32`），与 C1/A 撞同一批文件；以及**风险容忍度**本身——「含凭据的文件不可回滚」和「凭据副本留在本地盘」是产品取舍，不是工程优化。
