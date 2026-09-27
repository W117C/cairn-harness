# G-A 编排策略对照（最小档）

- case: `order-pricing-triple-fix`（src/cart.js, src/shipping.js, src/totals.js）
- 端点/模型: env 注入的第三方中转 + `glm-5.3-flash` ⇒ **不得当作官方 glm 档位读数引用**
- 系统提示：脚本自带短串（非 BASE_SYSTEM）；三臂仅策略句不同 ⇒ 量的是「显式下令后派活是否划算」
- n=1／臂 ⇒ 只出单次读数，不宣称趋势

| 臂 | 分数 | verify | 请求 | tokens(总) | 主/worker | $ | spawn | wait | 工具调用 | 写而不验 | worker 终态 | 秒 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| solo | 1 | ok | 3 | 6232 | 6232 / 0 | 0.0012 | 0 | 0 | 8 | 0 | — | 32 |
| fanout | 1 | ok | 5 | 80617 | 50399 / 30218 | 0.0161 | 3 | 1 | 27 | 0 | done×3 | 187 |
| supervise | 1 | ok | 6 | 48370 | 30307 / 18063 | 0.0097 | 1 | 0 | 23 | 1 | done×1 | 177 |

事件流证据：`outputs/ga-strategy-2026-09-20-rep2/<arm>.events.jsonl`（临时靶仓已销毁；改动文件见 JSON 里 changedFiles）。
