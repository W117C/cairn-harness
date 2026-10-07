# bench-synthetic-judge（合成靶子）

这一格不是第 10 项基准的样本，是**给「逐名判卷」那条路准备的最小离线靶子**（第 422 页）。

- 起点态：`src/shipping.js` 把免运费门槛写成严格大于 ⇒ `券后过线免运费` 这条用例红。
- `judge.failToPass` = 那一条；`judge.passToPass` = 另外两条（起点就绿，用来抓「修好了目标、弄坏了别的」）。
- 判卷命令 `node --test tests/*.test.js`：stdout 被管道接走时 Node 自带 TAP 输出 ⇒
  `src/agent/eval/test-results.ts` 认得这个格式（现读 `format=node-test-tap`、`complete=true`）。
- 零网络、零 API key：跑它的是 `scripts/loop-eval.ts --scripted=fixtures/bench/scripts/synthetic-judge/script.jsonl`。

读数一律标 **合成**：它证明的是「这条链端到端跑得起来、逐名那两件事能分开报」，
不是任何基准分数。
