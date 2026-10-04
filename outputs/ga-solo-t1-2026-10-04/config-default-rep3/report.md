# G-A 编排策略对照（最小档）

- case: `config-default`（src/config.js）
- 端点/模型: env 注入的第三方中转 + `mimo-v2.6-flash` ⇒ **不得当作官方 glm 档位读数引用**
- 系统提示：脚本自带短串（非 BASE_SYSTEM）；三臂仅策略句不同 ⇒ 量的是「显式下令后派活是否划算」
- n=1／臂 ⇒ 只出单次读数，不宣称趋势

| 臂 | 分数 | verify | 请求 | tokens(总) | 主/worker | $ | spawn | wait | 工具调用 | 写而不验 | worker 终态 | 秒 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| solo | 1 | ok | 4 | 12256 | 12256 / 0 | 未知 | 0 | 0 | 5 | 0 | — | 7 |

事件流证据：`outputs/ga-solo-t1-2026-10-04/config-default-rep3/<arm>.events.jsonl`（临时靶仓已销毁；改动文件见 JSON 里 changedFiles）。
