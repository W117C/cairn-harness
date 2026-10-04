# 任务：修复超时单位换算

`src/timeout.js` 的 `resolveTimeout` 把配置里的 `timeout` **当成毫秒直接用了**，但配置里写的是**秒**。
结果：任何一份配置的超时都被读成实际预算的千分之一（例如写 `30` 秒会当成 30 毫秒）。

要求：
- 修好 `src/timeout.js`，让配置里的秒数正确换算成毫秒。
- **不要改 `tests/run.mjs`**（判卷文件，改了等于作弊）。
- 改完跑 verify（`node tests/run.mjs`）确认全绿。