# L32-long-chain @ max-steps=60：3 对 rep 主实验

同一模型 `cn:glm-5.3-flash`，同一 `max-steps=60`，low/high 各 3 趟。`readings.json` 是 6 条跑器
原始读数按原样合并（low 3 条来自 `glm53flash-l32-60-main-low/readings.json`，high 3 条来自
`glm53flash-l32-60-main-high/readings.json`）。

| arm | 成功 | 每趟 tokens（in+out） | 平均 tokens/成功 |
|---|---:|---|---:|
| low | **3/3** | 262,949 / 232,440 / 66,096 | **187,162** |
| high | **3/3** | 98,148 / 145,451 / 62,974 | **102,191** |

## 1. high 比 low 多修好几条

**0 条。** 两臂都是 3/3 全过（`namedSets.state=pass`，`notGreen=[]`）。之前单趟的
「low 0/32、high 32/32」是**单趟异常**：3 对复跑后 low 也 3/3，不能再说 high 多修 32 条。
单趟记录仍留在 `../glm53flash-l32-60/`，只作历史证据，不进入主结论。

```bash
cd /Users/ze/Downloads/Cairn/cairn
python3 - <<'PY'
import json
rows=[x['r'] for x in json.load(open('outputs/bench-thinking/glm53flash-l32-60-main/readings.json'))]
for arm in ('low','high'):
    xs=[r for r in rows if r['arm']==arm]
    ok=sum(1 for r in xs if (r.get('namedSets') or {}).get('state')=='pass')
    print(arm, f'{ok}/{len(xs)}', 'tokens=', [r['tokensIn']+r['tokensOut'] for r in xs])
PY
# low 3/3 tokens= [262949, 232440, 66096]
# high 3/3 tokens= [98148, 145451, 62974]
```

## 2. $/success 变化百分比

端点 `usage.credit=0`，6 条 `cny=0`：实付 `$/success` 是 0，变化率没有非零分母（不可知）。
按 token 口径：low 平均 **187,162** tokens/成功，high **102,191** tokens/成功，
high **−45.40%**。这是同价假设下的成本代理，不是美元账单。

```bash
cd /Users/ze/Downloads/Cairn/cairn
python3 - <<'PY'
import json
rows=[x['r'] for x in json.load(open('outputs/bench-thinking/glm53flash-l32-60-main/readings.json'))]
for arm in ('low','high'):
    xs=[r for r in rows if r['arm']==arm]
    t=[r['tokensIn']+r['tokensOut'] for r in xs]
    print(arm, 'mean tokens=', sum(t)/len(t), 'cny=', xs[0]['cny'])
lo=sum(r['tokensIn']+r['tokensOut'] for r in rows if r['arm']=='low')/3
hi=sum(r['tokensIn']+r['tokensOut'] for r in rows if r['arm']=='high')/3
print('mean token change %:', round((hi-lo)/lo*100,2))
PY
# low mean tokens= 187161.66666666666 cny= 0
# high mean tokens= 102191.0 cny= 0
# mean token change %: -45.4
```

## 3. 主实验该用几个 rep

**3 对。** 这次 3 对已经证明：单趟「low 0/32」不可复现，low 3/3；high 也 3/3。成功率没有差异，
所以主实验若只看「多修几条」，3 对已足够把单趟异常排除；若要看小到几个百分点的成功率差异，
需要更多题/更多 rep，而不是只在这条 L32 上加。token 轴上 high 在 3 对里都比 low 低，
平均 −45.40%，但这是成本代理，不是成功率收益。
