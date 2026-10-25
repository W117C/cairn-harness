# thinking 预算 pilot（2026-10-24，GLM-5.3-Flash）

主读数：B1/B12 各 low/high 一趟（`readings.json`），加上 L32 @60 的 **3 对 rep 主实验**
（`glm53flash-l32-60-main/readings.json`）。模型 `cn:glm-5.3-flash`（端点
`http://127.0.0.1:7863/v1`）；B1 两臂 25 步，B12 两臂 60 步，L32 两臂 60 步。

## 1. high 比 low 多修好几条

- **B12：0 条**（两臂都 20/20，`notGreen=0`）。
- **B1：0 条**（两臂 1/1，都过）。
- **L32 @60：0 条**（low 3/3，high 3/3，`notGreen=[]` 全绿）。
  ⚠️ 之前单趟的「low 0/32、high 32/32」是**单趟异常**，3 对复跑后 low 也 3/3；那条单趟记录只作历史证据，
  不进入主结论。见 `glm53flash-l32-60-main/README.md`。

```bash
cd /Users/ze/Downloads/Cairn/cairn
python3 - <<'PY'
import json
for f,label,total in [('outputs/bench-thinking/glm53flash/readings.json','B12',20),('outputs/bench-thinking/glm53flash-l32-60-main/readings.json','L32',32)]:
    rows=[x['r'] for x in json.load(open(f)) if label!='B12' or x['r']['id']=='B12-long-horizon']
    for arm in ('low','high'):
        xs=[r for r in rows if r['arm']==arm]
        ok=sum(1 for r in xs if (r.get('namedSets') or {}).get('state')=='pass')
        print(label, arm, f'{ok}/{len(xs)}')
PY
# B12 low 1/1
# B12 high 1/1
# L32 low 3/3
# L32 high 3/3
```

## 2. $/success 变化百分比

端点 `usage.credit=0`，所有 `cny=0`：实付 `$/success` 是 **0**，变化率没有非零分母（不可知）；
不能把 0 写成“下降 100%”。

token 成本代理（同价假设，不是账单）：

- B12（两臂都成功）：low **147,463** → high **76,246** tokens/成功，**−48.29%**；
- L32 @60（3 对，两臂都 3/3）：low 平均 **187,162** → high **102,191** tokens/成功，**−45.40%**；
- B1（两臂都成功）：low **41,087** → high **63,808**，**+55.30%**（方向相反）。

所以「high 更省」不是普适的：B12/L32 上省，B1 上更贵；但三者的成功率都没有差异。

```bash
cd /Users/ze/Downloads/Cairn/cairn
python3 - <<'PY'
import json
for f,label in [('outputs/bench-thinking/glm53flash/readings.json','B12'),('outputs/bench-thinking/glm53flash-l32-60-main/readings.json','L32')]:
    rows=[x['r'] for x in json.load(open(f)) if label!='B12' or x['r']['id']=='B12-long-horizon']
    for arm in ('low','high'):
        xs=[r for r in rows if r['arm']==arm]
        t=[r['tokensIn']+r['tokensOut'] for r in xs]
        print(label, arm, 'mean tokens=', sum(t)/len(t), 'cny=', xs[0]['cny'], 'success=', sum(1 for r in xs if (r.get('namedSets') or {}).get('state')=='pass'), '/', len(xs))
PY
# B12 low mean tokens= 147463.0 cny= 0 success= 1 / 1
# B12 high mean tokens= 76246.0 cny= 0 success= 1 / 1
# L32 low mean tokens= 187161.66666666666 cny= 0 success= 3 / 3
# L32 high mean tokens= 102191.0 cny= 0 success= 3 / 3
```

## 3. 主实验该用几个 rep

**3 对。** 这次 3 对已经证明：单趟「low 0/32」不可复现，low 3/3；high 也 3/3。成功率没有差异。
若主实验只看「多修几条」，3 对已足够把单趟异常排除；若要检测几个百分点的成功率差异，需要更多题/
更多 rep，而不是只在这条 L32 上加。token 轴上 high 在 B12/L32 更低、B1 更高，方向不一致，
不能用一个“省 token”结论概括。

```bash
cd /Users/ze/Downloads/Cairn/cairn
python3 - <<'PY'
import json
rows=[x['r'] for x in json.load(open('outputs/bench-thinking/glm53flash-l32-60-main/readings.json'))]
for arm in ('low','high'):
    xs=[r for r in rows if r['arm']==arm]
    print(arm, len(xs), 'reps; success=', sum(1 for r in xs if (r.get('namedSets') or {}).get('state')=='pass'))
PY
# low 3 reps; success= 3
# high 3 reps; success= 3
```

## 结论一句话

在 GLM-5.3-Flash 上，**high 没有多修好任何一条**（B12 0、B1 0、L32 0）；之前 L32 单趟的
「high +32 条」是噪声，3 对复跑后 low 也 3/3。token 成本 high 在 B12/L32 更省（−48.29%/−45.40%）、
在 B1 更贵（+55.30%），但成功率不变。**「每轮多想值不值」的答案是：在这套题上，多想不买正确率；
只在部分题上买 token 节省，方向还不稳定。**
