# L32-long-chain @ max-steps=60：MiniMax-M3.1-Flash 3 对 rep

同一模型 `cn:minimax-m3.1-flash`，同一 `max-steps=60`，low/high 各 3 趟。`readings.json` 是 6 条
跑器原始读数按原样合并（low 来自 `minimax-l32-60-main-low/readings.json`，high 来自
`minimax-l32-60-main-high/readings.json`）。

| arm | 成功 | 每趟 tokens（in+out） | 平均 tokens/成功 |
|---|---:|---|---:|
| low | **3/3** | 104,228 / 83,578 / 126,318 | **104,708** |
| high | **3/3** | 385,315 / 445,397 / 551,856 | **460,856** |

## 1. high 比 low 多修好几条

**0 条。** 两臂都是 3/3（`namedSets.state=pass`，`notGreen=[]`）。

```bash
cd /Users/ze/Downloads/Cairn/cairn
python3 - <<'PY'
import json
rows=[x['r'] for x in json.load(open('outputs/bench-thinking/minimax-l32-60-main/readings.json'))]
for arm in ('low','high'):
    xs=[r for r in rows if r['arm']==arm]
    ok=sum(1 for r in xs if (r.get('namedSets') or {}).get('state')=='pass')
    print(arm, f'{ok}/{len(xs)}', 'tokens=', [r['tokensIn']+r['tokensOut'] for r in xs])
PY
# low 3/3 tokens= [104228, 83578, 126318]
# high 3/3 tokens= [385315, 445397, 551856]
```

## 2. $/success 变化百分比

端点 `usage.credit=0`，6 条 `cny=0`：实付 `$/success` 是 0，变化率没有非零分母（不可知）。
按 token 口径：low 平均 **104,708** tokens/成功，high **460,856**，high **+340.13%**。
这是同价假设下的成本代理，不是美元账单。

```bash
cd /Users/ze/Downloads/Cairn/cairn
python3 - <<'PY'
import json
rows=[x['r'] for x in json.load(open('outputs/bench-thinking/minimax-l32-60-main/readings.json'))]
for arm in ('low','high'):
    xs=[r for r in rows if r['arm']==arm]
    t=[r['tokensIn']+r['tokensOut'] for r in xs]
    print(arm, 'mean tokens=', sum(t)/len(t), 'cny=', xs[0]['cny'], 'success=', sum(1 for r in xs if (r.get('namedSets') or {}).get('state')=='pass'), '/', len(xs))
lo=sum(r['tokensIn']+r['tokensOut'] for r in rows if r['arm']=='low')/3
hi=sum(r['tokensIn']+r['tokensOut'] for r in rows if r['arm']=='high')/3
print('mean token change %:', round((hi-lo)/lo*100,2))
PY
# low mean tokens= 104708.0 cny= 0 success= 3 / 3
# high mean tokens= 460856.0 cny= 0 success= 3 / 3
# mean token change %: 340.13
```

## 3. 主实验该用几个 rep

**3 对。** 两臂都 3/3，成功率没有差异；3 对足以说明这条题上 high 不买正确率。若要看更小的
成功率差异，需要更多题，不是只加 L32 rep。token 轴上 high 在 3 对里都比 low 高，平均 +340.13%，
所以这条题上 high 是“同样全过、贵 4.4 倍”，没有理由默认开。

```bash
cd /Users/ze/Downloads/Cairn/cairn
python3 - <<'PY'
import json
rows=[x['r'] for x in json.load(open('outputs/bench-thinking/minimax-l32-60-main/readings.json'))]
for arm in ('low','high'):
    xs=[r for r in rows if r['arm']==arm]
    print(arm, len(xs), 'reps; success=', sum(1 for r in xs if (r.get('namedSets') or {}).get('state')=='pass'))
PY
# low 3 reps; success= 3
# high 3 reps; success= 3
```
