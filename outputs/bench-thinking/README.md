# thinking 预算 pilot（2026-10-24，hy3 本地端点）

> 另一轮 GLM-5.3-Flash 复跑见 `glm53flash/README.md`（B12 两臂 20/20；L32 @60 各 3 对 rep 为 3/3 vs 3/3，无成功率差异；单趟 low 0/32 是异常）。
> MiniMax-M3.1-Flash 的 L32 @60 3 对 rep 也是 3/3 vs 3/3，但 high 平均 +340.13% tokens：见 `minimax-l32-60-main/README.md`。

四趟主读数：B1-low、B1-high、B12-low、B12-high。模型全部是 `hy3`（`http://127.0.0.1:7863/v1`），
B1 两臂 `max-steps=25`，B12 两臂 `max-steps=60`；同一模型、同一档步数。跑器输出被归档后按原样合并：
`readings.json` 的 4 条分别来自 `readings-146743c-2026-10-24T14-15-50-422Z.json`（B1-low）、
`14-17-14-600Z`（B1-high）、`14-18-54-811Z`（B12-low）、`14-22-04-421Z`（B12-high）。
L32-low 的止损读数单独留在 `readings-l32-low.json`，不混进 4 条主读数。

## 1. high 比 low 多修好几条（B12 的 x/20）

**两臂都是 20/20，high − low = 0 条。** B12 的 `namedSets.notGreen` 两臂都是 0 条。

复算：

```bash
cd /Users/ze/Downloads/Cairn/cairn
python3 - <<'PY'
import json
rows=[x['r'] for x in json.load(open('outputs/bench-thinking/readings.json')) if x['r']['id']=='B12-long-horizon']
for r in rows:
    n=len((r['namedSets'] or {}).get('notGreen', []))
    print(r['arm'], 'notGreen=', n, '=> green=', 20-n)
PY
# 输出：low notGreen= 0 => green= 20
#       high notGreen= 0 => green= 20
```

## 2. $/success 变化百分比

端点没有公布单价；`hy3` 的 `usage.credit` 为 0（模型表 `credits=x0.00`），四条的 `cny` 都是 0。
因此实付 `$/success` 是 **0 → 0，变化率没有分母（不可知）**；不能把 0 当成“下降 100%”。

成本代理（同价影子口径，仅用 token，不是账单）：B12 的 token/成功从 low 的 **241,372** 降到
high 的 **224,305**，即 **−7.07%**；B1 从 **44,190** 降到 **43,304**，即 **−2.00%**。两臂成功率
都是 1/1，所以这个比例与“每个成功任务”同分母。

复算：

```bash
cd /Users/ze/Downloads/Cairn/cairn
python3 - <<'PY'
import json
rows=[x['r'] for x in json.load(open('outputs/bench-thinking/readings.json')) if x['r']['id']=='B12-long-horizon']
for r in rows:
    print(r['arm'], 'cny=', r['cny'], 'tokens=', r['tokensIn']+r['tokensOut'])
lo=next(r for r in rows if r['arm']=='low'); hi=next(r for r in rows if r['arm']=='high')
print('token change %:', round(((hi['tokensIn']+hi['tokensOut'])-(lo['tokensIn']+lo['tokensOut']))/(lo['tokensIn']+lo['tokensOut'])*100, 2))
PY
# 输出：low cny= 0 tokens= 241372
#       high cny= 0 tokens= 224305
#       token change %: -7.07
```

## 3. 主实验该用几个 rep

**不可知。** B12 两臂都 20/20，B1 两臂都 1/1；没有一条能区分两臂的失败样本，任务内方差估不出来。
L32-low（止损加跑）也是 32/32。这个题集对 `hy3` 已经封顶，**加 rep 只会重复 20/20，不会把
「多想值不值」变成可回答的问题**；要定 rep，先换更难的题，而不是在本 pilot 上加 rep。

复算：

```bash
cd /Users/ze/Downloads/Cairn/cairn
python3 - <<'PY'
import json
rows=[x['r'] for x in json.load(open('outputs/bench-thinking/readings.json')) if x['r']['id']=='B12-long-horizon']
print('arms:', sorted(r['arm'] for r in rows))
print('all 20/20:', all(len((r['namedSets'] or {}).get('notGreen', []))==0 for r in rows))
PY
# 输出：arms: ['high', 'low']
#       all 20/20: True
```

## 结论一句话

在 `hy3` 上、这套 B1/B12 题集里，**high 没有多修好任何一条**（B12 20/20 vs 20/20，B1 1/1 vs 1/1）；
端点成本为 0，token 口径 high 反而少 7.07%（B12）/2.00%（B1），但 n=1 且无方差，不能把这当成
「high 更省」的稳定结论。**这套题无法回答「每轮多想值不值」，需要更难的题，而不是更多 rep。**
