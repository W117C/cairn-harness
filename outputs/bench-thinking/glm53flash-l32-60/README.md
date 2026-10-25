# L32-long-chain @ max-steps=60：单趟配对（已被 3 对主实验推翻）

> ⚠️ **这是单趟历史证据，不是主结论。** 3 对复跑后 low 也 3/3、high 也 3/3（见
> `../glm53flash-l32-60-main/README.md`）；下面「high 多修 32 条」只说明单趟会出异常，
> 不能当 thinking 收益。保留本页是为了让异常可追溯。

同一模型 `cn:glm-5.3-flash`，同一 `max-steps=60`，只换 `--thinking low|high`。

| arm | 结果 | x/32 | requests | tokensIn | tokensOut | 失败原因 |
|---|---|---:|---:|---:|---:|---|
| low | FAIL | 0/32 | 60 | 1,092,735 | 14,057 | `agent loop 超过 maxSteps=60，强制中止` |
| high | PASS | 32/32 | 8 | 60,782 | 5,129 | — |

`readings.json` 是两条跑器原始读数按原样合并（low 来自 `glm53flash/readings-l32-low-60.json`，
high 来自 `glm53flash-l32-high60/readings.json`）。

## 1. high 比 low 多修好几条

**high 多修 32 条**：low 0/32（`namedSets.notGreen=['32 级流水线逐级跑通']`，60 步撞帽），
high 32/32（`notGreen=[]`）。

```bash
cd /Users/ze/Downloads/Cairn/cairn
python3 - <<'PY'
import json
rows=[x['r'] for x in json.load(open('outputs/bench-thinking/glm53flash-l32-60/readings.json'))]
for r in rows:
    ns=r['namedSets'] or {}
    print(r['arm'], 'state=', ns.get('state'), '=> green=', 32 if ns.get('state')=='pass' else 0, 'exit=', bool(r.get('exitError')))
PY
# low state= fail => green= 0 exit= True
# high state= pass => green= 32 exit= False
```

## 2. $/success 变化百分比

端点 `usage.credit=0`，两条 `cny=0`：实付 `$/success` 仍是 0；low 没有成功样本，`0/0` 不可知，
不能写“下降 100%”。按 token 口径：high 每个成功 **65,911** tokens（60,782+5,129），
low 用了 **1,106,792** tokens 但成功 0 个 ⇒ 每个成功成本不可知（分母 0）；high 在这个配对里
既多修 32 条，又少用约 94% 的 token。

```bash
cd /Users/ze/Downloads/Cairn/cairn
python3 - <<'PY'
import json
rows=[x['r'] for x in json.load(open('outputs/bench-thinking/glm53flash-l32-60/readings.json'))]
for r in rows:
    s=0 if (r.get('namedSets') or {}).get('state')!='pass' else 1
    t=r['tokensIn']+r['tokensOut']
    print(r['arm'], 'success=',s,'tokens=',t,'tokens/success=', (t if s else '不可知'))
PY
# low success= 0 tokens= 1106792 tokens/success= 不可知
# high success= 1 tokens= 65911 tokens/success= 65911
```

## 3. 主实验该用几个 rep

pilot 只有 1 对；差异是全有/全无，方向很大，但没有方差。主实验用 **3 对 rep**（同一 L32、
同一 `max-steps=60`、low/high 各 3 趟）是能估出任务内方差的最低档；3 是预注册的 rep 数，
不是从这一对读数算出的方差。若 3 对里 low 仍 0/3，high 的收益就不是单趟噪声。
