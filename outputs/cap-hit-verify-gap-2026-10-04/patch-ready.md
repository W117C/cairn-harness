# `#69` 待应用补丁：撞 `maxSteps` 的那条路会跳过能力 5 的收束闸，且**没有任何判卷看着这一格**

状态：**登记，未落笔**。原因不是判断，是归属——要改的 `src/agent/loop.ts` 现读在飞（别的会话未提交），
我用 pathspec 提交会把别人的 hunk 吞进我这笔。补丁按"逐字可应用"写，谁拿到干净树谁就照贴。

## 1. 现读证据（全部由本会话当场跑/读出来，不是推断）

> **面要说清**：本文件第一版引的行号（573／619）取的是**主树那份在飞的 `loop.ts`**（别的会话未提交，`+26/−12`，
> 内容是给事件落盘加脱敏 choke-point），不是 HEAD。下面逐条改标 **HEAD 面**行号，并保留两面对照：
> `git diff --numstat -- src/agent/loop.ts` ⇒ 主树比 HEAD 多 26 少 12；两面上的判定逻辑同一份，只是行号位移。

- **HEAD 面** `src/agent/loop.ts:366` `for (let step = 0; step < maxSteps; step++)`；收束闸整段在
  `src/agent/loop.ts:571` 的 `if (!sawToolCall) { … return; }` 里（闸条件在 `:583`）⇒ **一个回合只有"模型这一轮不再发工具调用"才会走到闸**。
- **HEAD 面** `src/agent/loop.ts:605` 是 for 循环之外的最后一句：`throw new Error("agent loop 超过 maxSteps=… ，强制中止")`
  （主树在飞面同一句在 `:619`）。
  ⇒ 撞帽的 run 从来不是"收敛后收工"，是**异常退出**，而闸在收敛支里 ⇒ **写过盘 + 用完步数 = 一次验证都没有，且事件流里不留痕**。
- 谁接这一抛：`src/agent/orchestrator.ts:1876` 把含 `maxSteps` 的消息折成 worker 的 `max_turns` 终态；主会话侧没有别的出声。
- 判卷面：**`grep "超过 maxSteps|强制中止" tests` 命中 0** ⇒ 这一格今天没有尺（所以我说它是洞，而不是"已知取舍"）。
- 真模型面（本会话臂 A／`--max-steps 30`，已完成 3 趟）：`B1` 36 次工具调用、`B2` 31 次 ⇒ 都撞帽；
  两趟的 `verify_result` 事件里 `auto:true` 的条数 **0**（按 JSON 解析数，不是 grep 切片）；`B1` 一条 verify 都没有。
- 产品缺省是 `maxSteps ?? 50`（`src/agent/loop.ts:168`），基准脚本缺省是 20（`scripts/loop-eval.ts:68`）——**两个都不是对方的档**，
  所以这一格在基准上也一直被截短预算掩盖着（第 360 页那张 119 趟表里 `autoVerifyBeat` 恒 false，这是第二个成因）。

## 2. 补丁（贴到 `src/agent/loop.ts:619` 那一行**之前**）

```ts
  // 撞步数帽 ≠ 验过了。收束闸住在「这一轮没有工具调用」的支路里（上面 `if (!sawToolCall)`），
  // 而被帽砍掉的 run 恰恰是最长、最容易失败的那一批——今天它们抛出去的那句话背后，
  // 一条验证证据都没有：审计面分不出「没验」与「验过且红」，模型也拿不到"还差什么"的信号。
  // 撞帽前补同一拍：条件与常规闸逐字相同（同 `verifyBeat`、同一签名、至多一拍），只是触发点从"收束"换成"被截断"。
  if (opts.verify && opts.autoVerify === true && wroteThisRun && verifyAttempts === 0 && autoBeats < 1) {
    let capHasSurface = true;
    try {
      capHasSurface = (await opts.verify.surface?.()) !== false;
    } catch {
      capHasSurface = false; // 探测坏掉 ⇒ 不补拍（与常规闸的 fail-closed 同一口径），也别把上面那次抛盖掉
    }
    if (capHasSurface) {
      try {
        await verifyBeat(HARNESS_VERIFY_CALL_ID, true);
      } catch {
        /* 补拍自己炸了不许改变"撞帽"这个终态：抛的还是原来那句 */
      }
    }
  }
  throw new Error(`agent loop 超过 maxSteps=${String(maxSteps)}，强制中止`);
```

作用域已核：`verifyAttempts`(170)／`wroteThisRun`(181)／`autoBeats`(184)／`verifyBeat`(208)／`HARNESS_VERIFY_CALL_ID` 都在同一函数体内。
标识符起名 `capHasSurface` 而不复用 `hasSurface`，是为了不与 573 那块的同名局部量混在一处（那是另一个 block）。

## 3. 要一起落的两条判卷（没有它们这补丁等于没牙）

`tests/auto-verify-wiring.test.ts`（现读干净、在 HEAD，机制那 30 条就是它和四个兄弟给的）里补两态：

1. **正例**：脚本化 provider 让模型**每轮都发工具调用**直到步数帽（不收敛）＋ 中途写过盘 ⇒
   断言 `runLoop` 抛 `maxSteps`，**且**事件流里存在 `verify_result{auto:true}` 一条。
   今天这一条必然红（现状就是 0 条）⇒ 它就是本补丁的失败前置。
2. **反向哨兵**：同一个剧本但 `autoVerify` 不开 ⇒ 断言不产生任何 auto 拍（证明补拍是被那个开关管的，不是我新加的一条常开路径）。
   缺了这条，第 1 条怎么写都能绿。
3. 顺带把 `opts.verify.surface?.()` 返回 `false` 的那一支钉住：**没面就不补**，别把"零额外调用"的既有承诺吃掉。

## 4. 成本与风险（说清，不含糊）

- 每个撞帽 run 多 **1 次 verify 执行**（本地命令，不是模型请求）；抛异常照旧 ⇒ 终态、`max_turns` 归因、编排侧全部不变。
- 不动模型可见文案，不动权限面（`run_shell`/verify 仍走同一道闸）。
- 与 `#66` 的关系：`#66` 问"红之后要不要再给一轮"，`#69` 问的是"连第一轮都没跑"。**`#69` 在前**——
  撞帽的 run 越多，`#66` 越量不到东西（这一句就是本会话在 `--max-steps 30` 那档撞上的墙）。

## 5. 已经验过的部分（不是"应该能过"，是跑过了）

全部在隔离树 `.worktrees/verify-c7f2ea0f` 里做（那棵树的 `loop.ts` 与主树 HEAD 面逐字相同，实测 `diff` 空），
主树那支**在飞的** `src/agent/loop.ts` 一个字没碰。

| 事项 | 结果 | 出处 |
| --- | --- | --- |
| 补丁能否贴到 HEAD | `patch --dry-run` 退 **0** | 本目录 `loop.patch`（28 行） |
| 打了补丁后判卷 | **4/4 绿** | `judge-patched.log` |
| 不打补丁（只还原那一处） | **恰好红 1 条**（正例："补拍压根没跑 ⇒ 撞帽的 run 还是零证据收场：expected +0 to be 1"），另 3 条守卫两态都绿 | `judge-unpatched.log` |
| 判卷本体（4 条，含两条"不许多跑"的守卫） | 见 `cap-hit-verify.test.ts.txt`，落地时放 `tests/cap-hit-verify.test.ts` | 同目录 |
| `typecheck`（带补丁＋新判卷，在隔离树整树跑） | 退 **0**，一格错都没有 | `typecheck-in-tree.txt` |

第 3 行那一格是重点：**未打补丁时正例必红 ⇒ 这条判卷有牙；而三条守卫在有补丁/无补丁下都绿 ⇒ 补丁只加证据，没有多开任何门**。

## 6. 还欠什么（别把这份工件读成"已经做完"）

- 已跑：`typecheck`（隔离树整树，带补丁与新判卷，退 0）。**没跑**：全量核心判卷、认证、`mutate-verify`——
  认证要独占窗口，而本会话此刻正占着真模型基准（`#66` 那两臂），不该同时去要第二把窗口。
- `#50` 锚点债：本补丁若落地，要配两根锚点——① 把 `capHasSurface = false` 那支改回恒真 ⇒ 应被"零可验面"那条守卫红；
  ② 把补拍条件里的 `opts.autoVerify === true` 摘掉 ⇒ 应被"反向哨兵"那条红。`scripts/mutate-verify.mjs` 现在在别人手里，先欠着。
- 落地时机：`src/agent/loop.ts` 让出来之后（现读 ` M`，主树那份含隔壁未提交的 +26/−12 脱敏改动）；
  或直接由持有者把本补丁并进去——顺序上他的改动在后我的这块不受影响（贴的是 for 循环外、抛之前的位置）。

