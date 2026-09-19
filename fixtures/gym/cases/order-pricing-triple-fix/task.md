# 任务：修订单计价的三处 bug（长时程 case）

`src/` 下三个模块各有一处缺陷，规则**以 `tests/run.mjs` 的断言为准**（判卷文件，不许改）：

- `src/cart.js` 的 `subtotal(items)`：漏乘数量 `qty`，只累加了单价。
- `src/totals.js` 的 `grandTotal(sub, taxPct)`：把税率百分数当金额直接加（20% 当成 20 元），
  且结果要保留两位小数。`withDiscount` 是对的，别顺手改它。
- `src/shipping.js` 的 `shippingCost(weightKg, freeOver, perKg)`：整公斤数用了向下取整，
  规则是**向上取整**（2.2kg 按 3kg 计价）。

要求：
1. 先读 `tests/run.mjs` 与三个源文件再动手——期望值都在判卷文件里，不要照 bug 猜规则。
2. 三处都要改到；`tests/run.mjs` 一个字都不许动。
3. 改完调 `verify`（`node tests/run.mjs`）确认全绿再收工。
4. 若某次 `edit_file` 报错（0 处匹配 / 匹配多处），**读回该文件按原文重发**，不要盲改第二次。
