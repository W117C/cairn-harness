# 任务：修复 loadConfig 缺省 timeout

`src/config.js` 的 `loadConfig(raw)` 在 `raw` 缺 `timeout` 字段时返回 `undefined`。

要求：
- 修复 `src/config.js`，让 `loadConfig` 在 `timeout` 缺失时给默认值 `30000`（`raw.timeout ?? 30000`）。
- **不要改 `tests/run.mjs`**（判卷文件，改了等于作弊）。
- 改完跑 verify（`node tests/run.mjs`）确认全绿。
