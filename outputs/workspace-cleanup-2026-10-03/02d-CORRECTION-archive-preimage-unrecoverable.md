# 更正与勘误：留档 json 还原（阶段 A2）

## 做了什么

`outputs/judge-timeout-2026-10-01/suite-quiet.json`（工作树里被改过，mtime 2026-10-02 13:26:17）已还原到 HEAD。

## 流程疏漏（如实记）

还原前只落了 `git diff --numstat`（1 插入 / 1 删除），**没有落完整 diff**；该文件是一行 minified JSON，numstat 对内容没有分辨力。
⇒ 还原前那份字节**不可恢复**。已核实四条路：

1. 不在对象库（5 份 `suite-quiet.json` 的 HEAD blob 逐个比过，均无匹配）；
2. 不在 reflog（`git reflog --all | grep 85d9a39b` = 0）；
3. 本机无 APFS 本地快照（`tmutil listlocalsnapshots /` 输出为空）；
4. 无 Time Machine 目标（`tmutil destinationinfo`：No destinations configured）。

## 02b/02c 两份文件的实际对照对象（别看错）

它们对照的是**历史提交 `43ace9e`（2026-10-01 03:02）那一版 blob `85d9a39b`**，不是还原前的工作树内容。
该 blob 与 HEAD 版（`da246910`）差 2 字节，含一处用例标题差异：

- `43ace9e` 版：`窗口不可得 / 非有限 / 放不下输出预留 → 原样返回…`
- HEAD 版：`窗口不可得 / 非有限 / 非正 → 原样返回…`（与当前 `tests/compaction.test.ts:500` 逐字一致）

两者的用例数 / 文件清单 / 通过失败数完全相同（3394 / 3393 / 1）。

## 为什么还原到 HEAD 仍是正确处置

1. 留档不许改（本仓纪律：那一天的证据）；差异不是时长而是内容面 ⇒ 不改回去才是异常。
2. HEAD 版与当前源码标题逐字一致，也才是 `scripts/lib/head-cert-deps.ts`、`tests/cli-surface.test.ts` 等散文引用所对照的那一版（3394 条）。
3. 这份留档在判卷上的角色已被取代：`tests/head-cert-deps.test.ts` 的真机整表那格现在读 `outputs/suite-refresh-2026-10-03/suite-quiet.json`。

⇒ 丢的是「那次野跑留下了什么」这一条取证信息，不是任何工作产物。

## 教训（已记进 readings.md）

任何「还原 / 覆盖工作树文件」的动作前，必须先落**完整** pre-image（`git diff > pre.diff`，或 `git hash-object -w` 存一份对象），不能只落 numstat。
