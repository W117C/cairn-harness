# G-A 编排策略对照（最小档）

- case: `order-pricing-triple-fix`（src/cart.js, src/shipping.js, src/totals.js）
- 端点/模型: env 注入的第三方中转 + `glm-5.3-flash` ⇒ **不得当作官方 glm 档位读数引用**
- 系统提示：脚本自带短串（非 BASE_SYSTEM）；三臂仅策略句不同 ⇒ 量的是「显式下令后派活是否划算」
- n=1／臂 ⇒ 只出单次读数，不宣称趋势

| 臂 | 分数 | verify | 请求 | tokens(总) | 主/worker | $ | spawn | wait | 工具调用 | 写而不验 | worker 终态 | 秒 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| solo | 1 | ok | 3 | 5787 | 5787 / 0 | 0.0012 | 0 | 0 | 8 | 0 | — | 26 |
| fanout | 1 | ok | 8 | 179985 | 117554 / 62431 | 0.0360 | 3 | 2 | 44 | 0 | done×3 | 337 |
| supervise | 1 | ok | 7 | 53266 | 35055 / 18211 | 0.0107 | 1 | 0 | 22 | 0 | done×1 | 131 |

事件流证据：`outputs/ga-strategy-2026-09-20/<arm>.events.jsonl`（临时靶仓已销毁；改动文件见 JSON 里 changedFiles）。
