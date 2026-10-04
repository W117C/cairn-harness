# 认证第一趟（a6a87627）：五条红逐条归因（2026-10-04）

跑的是 `scripts/head-cert.ts`（默认参数，自己新建 `.worktrees/head-cert-a6a8762`，跑完自回收）。
汇总原文见同目录 `cert-summary.txt`。

原始读数（全部取自本轮，不引用旧页数字）：

- 判卷：`Test Files 4 failed | 299 passed (303)｜Tests 4 failed | 4265 passed (4269)｜exit=1`
- 门：`绿 18 / 22，红 4（docs-check、memory-check、mutate-needles-check、evidence-typecheck-check）`
- 认证门面：22 道跑到 22；`TREE=a6a8762 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔`
- 本趟墙钟 `225.31s`；贴帽读数 `4269 条里 0 条用时 ≥ 有效预算 80%`

## 一、`tests/plugins-skills.test.ts:63` 路由清单那条 ⇒ **我的回归**（3dff65c1 第 370 页）

旧判卷钉的是**从前那套语义**：超预算 ⇒ 第一处装不下就往后的条目**整条丢掉**，所以它断言
`/loose — 散装` 不许出现。我这笔把「整条丢」改成「装不动完整行就降级成只列名字」，同一条短条目
（`/loose — 散装`）现在装得下 ⇒ 它出现了 ⇒ 那条尺红。

- 这条不是"我改坏了产品"，是"我改了语义却没同步那条判卷"——第 370 页我只跑了自己新写的两支判卷
  （89/89）与 `plugins-check` 门（42✅），**没跑全量核心判卷**。门表里的 `plugins-check` 不覆盖这条断言，
  于是它一路红到认证才被发现。这正是本仓那条老账的形状：**改完被测面只跑"自己动过的那个判卷文件"**。
- 修法＝把那条断言改成钉新语义（短条目保住、胖条目只降级、行行完整），不是把实现改回去迁就旧尺。
  我动手前现读发现**工作树里已经有人把它改成新语义了**（该文件 23:58 面＝脏，内容正是新语义＋
  撤掉零消费者的 `skillListHas` 辅助函数）；归属只能到"另一路在飞写入"这一格（不是我本笔所为，
  至于是本会话早先派的写代理还是隔壁会话，盘上没有可证的痕迹）⇒ **我不重复修，只登记**，等它落库。

## 二、`memory-check` 门 G6 ⇒ 同一只尺的**第二个面**（在飞的同事手里）

`scripts/memory-check.ts:263` 与 `tests/memory-runner.test.ts:178` 是**同一条判据的两份实现**
（扫 `src/agent/compaction.ts` 整份源码文本找 `.agent`／`node:fs`／`MEMORY.md`）。第 371 页我只收紧了判卷那一面，
门那一面没同步 ⇒ 判卷绿、门红，红因还是 `who(e.agent_id)` 里那个巧合子串。

- 我这笔原本要做的正是"门侧照抄同一条径"。动手前现读发现**工作树里已经有另一路写入把这件事做成了单源**
  （新文件 `scripts/lib/source-literals.ts`：`stringLiterals()` + `memorySurfaceHits()`，门侧 G6 改引它，
  并加了 G6b「字面量抽取非空」的自证），于是**我不再写第二份**——这一格的价值现在恰恰是"别再有两份"。
  归属同上一格：只能写到"另一路在飞写入"（`source-literals.ts` 未跟踪、`scripts/memory-check.ts` 脏）。
- 反过来它自己记了我一筆：第 371 页我手抄的那段正则就是"第二份派生"，同事那份头注释把这事写在了盘上。

## 三、`docs-check` 门 + `tests/docs-check.test.ts` D-11 ⇒ **我的账**（第 371 页点名了没入库的工件）

红话原文：`第 371 页 点名 outputs/fullsuite-head-2026-10-04/，但 HEAD 里追不到（那个 dated 目录一件工件都没入库）`。
取证子代理产出 10 件工件（两份 log、四份探针、四份读数），我在页上点了名却没入库 ⇒ **证人要与页同笔落库**这条又中一次。

- 修：本笔把那个目录一并入库。入库前先把它两支探针的**import 深度**改对（`../scripts/…` ⇒ `../../scripts/…`，
  从 `outputs/<dir>/` 出去要两级；这是我这个会话里第二次踩同一条，第 368 页记过一次）。
  两支探针在主树跑通（`probe-*-postfix.txt`，退 0）。
- 另一处如实记下：红话把页号说成「第 307 页」，而这句话实际写在第 371 页（`PROGRESS.md:12691`）
  ⇒ 第 350 页那条「整本台账被读成一页」的分页缺陷**在 HEAD 仍未修**，`scripts/docs-check.ts` 现在脏着
  （同事手里有 `ABBREV_REF_RE` 那格新导出）。这一条我只登记，不动它的尺。

## 四、`evidence-typecheck-check` 门 ⇒ **我的账**（证据面探针引了在飞才有的导出）

红话：`危险码 13 条／帽 12 条｜⚠️ 涨了 1 个文件（只准调低）：outputs/d11-page-seam-2026-10-04/probe-citation.mts 1>0`。
真因：那支探针引 `ABBREV_REF_RE`，而这个导出**只存在于工作树**（`scripts/docs-check.ts:244`），HEAD 没有
⇒ 在飞 API 上写探针 = 一枚 TS2305 危险码，而帽只准调低。本笔改掉那半句（省略式那半的当时读数留在同目录
`probe-citation.txt`，等导出进 HEAD 再重跑），改后门 `✅ 12 条／帽 12 条`、全量报错 117→116（`evidence-typecheck-after.txt`）。

## 五、`tests/scratch-tree-naming.test.ts` ⇒ **尺咬了认证自己的车**（本笔修）

红话：`暂存树 head-cert-a6a8762 的名字没编码提交（约定是 verify-<sha>）`。
命名尺（`scripts/lib/scratch-tree-naming.ts:28`）的前缀白名单只有 `verify-`，而 `head-cert` 的**默认树名**
（`scripts/head-cert.ts:48` 产 `.worktrees/head-cert-<sha7>`，09-28 起就是带 sha 的形状）同样编码了提交号。
⇒ 只要判卷在认证树里跑，这把尺就把认证自己那棵树判成"名字说谎"，**认证永远不可能全绿**。

- 修：前缀表补 `head-cert`，`name-not-head` 那格对所有前缀一视同仁（放宽的是名字形状，不是"不许说谎"）。
- 判卷补三条合成用例（`head-cert-<sha>` 相符 ⇒ 不许多报／`head-cert-<sha>` 与实际 HEAD 不符 ⇒ 照样响／
  `head-cert` 少了 sha 那段 ⇒ 仍响），现读 `Tests 10 passed (10)`（`scratch-tree-naming-after.txt`，从前 7 条）。

## 六、`mutate-needles-check` 门 3 条阻断 ⇒ **我的账，但被隔壁的文件卡住**（备件已交）

三条锚点全指 `src/agent/plugins/skills.ts`，全是我第 370 页搬家造成的空操作（`needles-at-head.txt` 逐条原文）：
`routing-truncation-marker-hides-count`、`routing-dropped-counts-listed-not-missing`、
`skill-routing-ignores-disable-model-invocation`。**尺与锚点必须同一笔**——我这笔只落了实现与判卷，
没同步锚点，于是 HEAD 上那三条变异必然不生效。

改法（三对针脚逐字备在 `anchor-repoint.md`，每条针脚现读 `grep -cF` ＝1）落不了库：
`scripts/mutate-verify.mjs` 正被隔壁的 M0→CAIRN 改名占着（现读 `8 insertions/8 deletions`，
命中 3008/3824/6238/7495/13148 五处，与我这三条的 546/554/3178 不同行 ⇒ 不冲突，等它落库我这条能干净贴上）。

## 七、`tests/head-cert-deps.test.ts:1272` 那条红 ⇒ 老账 `#39`，不是新的

`取不到成因的条数必须是 0；expected 2 to be +0`。判卷把**留档的那一份全量 json**
（`outputs/suite-refresh-2026-10-03/suite-quiet.json`）当分母喂给现读的尺，2 条名字在这台机器上取不到成因。
取证探针现读跑出的两条名字与成因分类见 `probe-notresolved-postfix.txt`。
`tests/head-cert-deps.test.ts` 与 `scripts/lib/head-cert-deps.ts` 现在都脏着（隔壁手里）⇒ 只登记，不动。

## 没跑／没证的

- 本笔没跑全量核心判卷（只跑了 `tests/scratch-tree-naming.test.ts` 一支 + 三道秒级门），也没重跑认证；
  「修完再认证」是下一页的事，本页不宣布任何「绿了」。
- `typecheck` 主树现读 `TC_EXIT=0`（`typecheck-after.txt`）——第 371 页记的那 1 档（`tests/autonomy.test.ts`）
  本轮已经在隔壁的改动里消掉，这是现读不是推断。
- 一条机器面残账如实写：我起的认证 stdout（`/tmp/dsh-headcert-a6a8762.log`）在这轮之后从 `/tmp` 消失了，
  而工具自己那份 `/tmp/dsh-head-cert-a6a8762/summary.txt` 还在——**汇总本就落盘两处**（第 84 页那条设计），
  所以本页所有数字取的是后一处，不靠 stdout 的尾。
