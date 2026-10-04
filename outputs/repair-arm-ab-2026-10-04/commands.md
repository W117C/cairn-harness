# 本目录两臂的确切命令（补 `readings.json` 里没有的那一面）

现读依据：`scripts/loop-eval.ts:68` 的 `--max-steps` 缺省是 **20**，而产品缺省是 **50**（`src/agent/loop.ts:168` `opts.maxSteps ?? 50`）；
`readings.json` 的每行只带 `assembly`（旋钮表那几枚），**不带步数预算与 reps**，
而老留档（`bench-reps3-2026-10-02`／`bench-baseline-2026-10-04`／`bench`）**连 run.log 都没有** ⇒
第 360 页那张 119 趟的暴露面里，有一部分取在"预算未知"的档次上（这一条已按 `#68` 登记，`loop-eval.ts` 在别人手里补不了）。
所以这一臂的旗标由本文件逐字带住，别靠记忆。

起跑时间：2026-10-04 18:59（本地），窗口现读 `pgrep -f loop-eval`=0、`pgrep -f vitest`=0（起跑前后各采一次）。
取料 HEAD 与文件指纹见同目录 `fingerprints.txt`（跑前跑后各一次，逐字对比）。

## 臂 A —— 装收束闸、不装返修（= 产品缺省态）

```
set -a; . ~/.config/cairn/env; set +a
node --import tsx scripts/loop-eval.ts \
  --tasks fixtures/bench/tasks.json --reps 1 --max-steps 30 --auto-verify --keep \
  --out outputs/repair-arm-ab-2026-10-04/a
```

## 臂 B —— 两枚都装（= 候选缺省，`#66` 要拍的那一档）

```
set -a; . ~/.config/cairn/env; set +a
node --import tsx scripts/loop-eval.ts \
  --tasks fixtures/bench/tasks.json --reps 1 --max-steps 30 --auto-verify --auto-verify-repair --keep \
  --out outputs/repair-arm-ab-2026-10-04/b
```

## 为什么两臂都取 `--max-steps 30`（不是产品的 50）

- 与**隔壁同一天同一 HEAD 上刚跑的两趟**（`bench-head-d0ffe15e-a/b`）同档，这样"同装配两趟翻 3/12"那条噪声底线才和我的配对比得动；
- 但这是一把双刃剑，必须在结论里说清：返修那一轮要从**同一个已被截短的预算**里扣一步，
  所以撞帽的那些任务（隔壁两趟里是 `B2-feature-export` 两趟全撞、`B12-long-horizon` 一趟撞，撞帽的 `ok` 全为 false）
  上的 A/B 差**不能读成返修的效果**，只能读成"预算先到顶"。
  `compare.mts` 会把 `exitError` 含 `maxSteps` 的趟次逐条点名出来，就是为了这句能被核对而不是靠我承诺。

## 单价

`~/.config/cairn/env` 现读只有模型/端点/凭据那几个键，**没有** `EVAL_PRICE_IN`／`EVAL_PRICE_OUT` ⇒
`cny` 会是 NaN ⇒ 这一组只报请求数与 token 数，不编一个价（`compare.mts` 里那行就按这个口径印）。
