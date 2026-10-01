# store-signature

**待办**：把 `put` 的**位置参数**改成**选项对象**：`put({ table, key, value })`。
三个调用点（`src/users.js` / `src/orders.js` / `src/audit.js`）跟着改。
返回值的形状不变（存进去的那条记录）。

跑测试：`npm test`
