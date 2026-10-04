# 全量核心判卷失败的三类归位（现 HEAD 取证）

测的笔：`a09a3086` 与 `7f1b4d40`（建树时为 `9099989e`，隔壁在我跑的过程中推进了三次；两笔失败集合逐条相同）。
读数和原文见同目录 `readings.txt` / `failures.txt` / `raw-*.log`；归属现读证据见 `live-status.txt`。

**总条数：3 支判卷文件 / 4 条用例红。**

分桶结论先给：
| 桶 | 条数 | 是哪几条 |
|---|---|---|
| (a) 别的会话持有／在飞的**判卷文件** | **1** | [1] |
| (a′) 别的会话在飞，但飞的是**共享 worktree 注册表**不是判卷文件 | **2** | [3][4] |
| (b) 代码回归 | **1** | [2] |
| (c) 说不清 | **0** | —— |

(a′) 是我按证据新开的一格，理由写在下面第 3 条：**你给的 (a) 判据（逐文件 `git status --porcelain`）对这两条不成立**（文件现读 CLEAN），而它们也不是 (b)（机制我现读证到了，不是靠记忆补的），所以我没塞进 (c)。要不要把它们并回 (a) 或另立台账，是你的口径决定，我把判据的两头都摆出来。

---

## 1. [1] `tests/head-cert-deps.test.ts:1272` —— 归 (a)，判据成立

**现读归属**（`live-status.txt`）：
```
tests/head-cert-deps.test.ts      :: [ M tests/head-cert-deps.test.ts]
scripts/lib/head-cert-deps.ts     :: [ M scripts/lib/head-cert-deps.ts]
tests/typecheck-triage.test.ts    :: [CLEAN]
outputs/suite-refresh-2026-10-03/suite-quiet.json :: [CLEAN]
```
判卷文件本身和它依赖的 lib **两支都在隔壁工作树里脏着** ⇒ 这一条红落在别人的在飞判卷面上，成立。

**红因（现读复算，不是引用第 355 页的记忆）**：判卷把留档 json（3980 行）按 `it()` 标题回源码取显式预算，
`notResolved=2`。我用判卷自己那套 helper 跑出的两条名字（`probe-notresolved.txt`）：
- `tests/typecheck-triage.test.ts` ·「全在未跟踪草稿：tracked 空、scratch 列出该文件，并明说 HEAD 类型干净」← 标题不在那份判卷里
- `tests/typecheck-triage.test.ts` ·「零报错不打任何归因行；git 不可用时（空集）一律按 HEAD 内报（保守）」← 标题不在那份判卷里

取料没坏（`rows=3980`、`state=ok`、`cell.total` 与逐行重数同分母），坏的是**留档与现源码之间的标题漂移**。
留档不许改 ⇒ 解锁动作是「一次独占窗口重采样全量 json，再把判卷里的路径指到新档」，
而那两支文件现在都脏 ⇒ **这一条确实只能等隔壁让位**，与 #39 的既有说法一致。

## 2. [2] `tests/memory-runner.test.ts:178` —— 归 (b)：本笔没人持有，是 HEAD 自己的红

**现读归属**：`tests/memory-runner.test.ts` **CLEAN**、`src/agent/compaction.ts` **CLEAN** ⇒ (a) 判据不成立。

**机制（现读，非推断）**：该用例读 `src/agent/compaction.ts` 全文并断言
`expect(src).not.toContain(".agent")`（意图＝压缩路径不许引用记忆目录）。HEAD 那份文件里这个子串出现 **2 次**，
两处都是 `who(e.agent_id)`（第 552、561 行）——`.agent` 只是字段名 `e.agent_id` 里的**巧合子串**，不是目录引用。
同一用例前面的 canary 断言（174/175 行：记忆文件逐字不变）是过的，红的只有字符串扫描那一行。

**引入它的一笔**：`git log -S"e.agent_id" -- src/agent/compaction.ts` ⇒ `d0ffe15e`（第 359 页「Tried & Rejected」）。
那一笔的提交信息自己写着：**「没跑：全量核心判卷、认证、mutate-verify（在别人手里）」**；
而 `grep "压缩器不触记忆文件" PROGRESS.md` **一条都没有** ⇒ 这条红**从来没被任何人看到过**，
不是登记过的旧账，也不是任何人在飞的草稿。

**所以这一条不是"等谁让位"能解的**：要么改那条朴素子串判据（本仓先例叫「换判据，别削判据的反面」——
把 `not.toContain(".agent")` 换成真正判"记忆目录/fs 引用"的形状），要么让 `agent_id` 换个不落 `.agent` 的写法。
两边都要动刀，且文件都干净 ⇒ **归本仓自己的债**。

## 3. [3][4] `tests/scratch-tree-naming.test.ts:68 / :73` —— 归 (a′)：红跟着共享注册表漂

**现读归属**：`tests/scratch-tree-naming.test.ts` **CLEAN**、`scripts/lib/scratch-tree-naming.ts` **CLEAN** ⇒ (a) 的"文件脏"判据不成立。

**为什么也不是 (b)**：两条断言读的都不是 HEAD 的代码面，而是**这台机器的共享状态**。判卷文件头注释自己写明
「worktree 注册表是**共享状态**（`git worktree list` 从任何一棵树里问都返回同一张表）」。
我用那份共用谓词现读复算了两种口径（`probe-scratch-naming.txt`）：

```
现读全表（含我这棵探针树）
  断言①取料派生对：mine=4 underRoot=2 ⇒ FAIL
    mine 有 / underRoot 没有：[".qoder/worktrees/agent-general-purpose-7f5785bb",
                               ".qoder/worktrees/agent-general-purpose-ebe989c9"]
  断言②三类不一致：findings=3 ⇒ FAIL
    [no-sha-name] agent-general-purpose-7f5785bb   ← 别的会话的树
    [no-sha-name] agent-general-purpose-ebe989c9   ← 别的会话的树
    [no-sha-name] agent-fullsuite-9099989e         ← 我这把尺自己的树

排除我这棵探针树（= 只留别的会话的树）
  断言①mine=3 underRoot=1 ⇒ 仍 FAIL
  断言②findings=2        ⇒ 仍 FAIL
```

三条事实逐条钉住：
- **[3] 与我无关**：差集固定是那两棵 `.qoder/worktrees/*`（别的会话的树落在 `.worktrees/` 之外，
  而 `underRoot` 只收 `.worktrees/`）。排除我这棵照样红。
- **[4] 有我一份，但我不是原因**：3 条 findings 里 1 条点名 `agent-fullsuite-9099989e`
  ——按指示起的名字不合 `verify-<sha>` 约定。去掉我这棵还剩 2 条 ⇒ 这一条**仍然红**。
- **读数跟着注册表漂**：同一条断言在我 20 分钟内的两趟里从 `expected [6] to equal [4]` 变成
  `expected [4] to equal [2]`（隔壁回收了两棵 `verify-*` 树），判卷与被测代码一个字节没动。
  ⇒ 这类红不可能靠"改代码"消除，只能在「机器上没有非 `verify-*` 树」的窗口里自然绿；
  而那两棵 `.qoder/worktrees/*` 是**别的会话正在持有的树**，窗口不由我定。

**要报的一格**：我这把尺本身也在制造第三条 finding。按本仓约定，验证树该叫 `verify-<sha>`；
下次取证要么按那个形状起名，要么在归因里把它单独剔出去（我这次是现读算给你看的，不是事后找台阶）。

## 4. (c) 说不清：0 条

四条红的机制都有现读证据（文件归属 / 探针复算 / 引入它的那一笔）。
**没拿到的数我也没往 (c) 里塞，而是写进 readings.txt 第 5 节**：
- 23 道门与 `mutate-verify`／`head-cert`：**我没跑**，本文件不引用任何门的数。
- A 组起跑前的「并发判卷套数」**没现读**（只补采了 B 组中间那一次：套数=1、cwd 就是我这棵树）
  ⇒ 两趟的 `Duration`／墙钟按本仓口径属"并发没钉死"的读数，**不当安静态基准引用**；
  失败集合不受这点影响（B 组全量、A 组全量、C 组独占定点复跑，三趟同 4 条）。
- 现 tip `f91217dc` **没重跑**（现读它相对 `7f1b4d40` 只动 `PROGRESS.md` + `outputs/`，judged 面字节相同——
  这是 diff 出来的，不是跑出来的）。

## 5. 顺带拿到的一格（对 #39 有用，不是推断）

`scripts/typecheck.ts` 在**干净 HEAD 树**里两笔都 **exit 0、0 条报错**。
而隔壁几页一直在报「`typecheck` 报错只有 `tests/autonomy.test.ts` 6 条（在飞）」。
两头对上 ⇒ **HEAD 的 typecheck 面本来就是绿的**，那 6 条是工作树未提交内容造成的红，
不该算进 #39 的欠账。

---

## 6. #39 现在到底被什么卡着

不是「卡在别人的判卷文件里」这一句话能概括的：四条里**只有 1 条**真的是别人的在飞判卷文件（[1]，
`head-cert-deps` 两支都脏，且解锁要一次独占窗口重采样）。剩下 3 条：

- **[2] 是本仓自己的债**：`d0ffe15e` 带着 `e.agent_id` 落了 HEAD，撞了 `memory-runner` 那条
  `not.toContain(".agent")` 的巧合子串判据；引入那笔**自己声明没跑全量**，PROGRESS 里也没登记过这条红。
  等谁让位都等不来——要么换判据，要么改字段名写法。
- **[3][4] 是这台机器的共享注册表**：只要别的会话的 `.qoder/worktrees/*` 还挂着，这两条在任何一棵树上跑都红；
  判卷把「共享状态」取进了真仓面，于是它读的是并发现场，不是 HEAD。

⇒ 「23 道门绿、全量判卷红」这个长期说法，**现在的真实形状**是：门绿 + HEAD 全量 4 条红，
其中 1 条等隔壁、1 条等本仓拍一次"换判据"、2 条等一个"机器上没有非 verify-* 树"的独占窗口
（而且我这把尺自己也往那个窗口里添了一棵）。
**"这笔绿了"仍然不能宣布**，但卡点已经从"别人手里不知道谁的几条"变成"上面这三件事，各自有名有姓"。
