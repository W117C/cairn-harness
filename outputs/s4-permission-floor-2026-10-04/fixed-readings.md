# S4 修复的读数（2026-10-04，干净 detached 树 `.worktrees/verify-head-e98f490` @ `e98f490b`，只覆盖本笔两支文件）

| 跑法（逐字） | 退出码 | 读数 |
|---|---|---|
| `node --import tsx scripts/typecheck.ts` | 0 | `typecheck: tsc --noEmit 通过（0 条报错）✅` |
| `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/permissions.test.ts tests/shell-bypass-composition.test.ts` | 0 | `Test Files 2 passed (2)`／`Tests 77 passed (77)` |
| `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/permissions.test.ts`（**新判卷＋HEAD 那版 `rules.ts`**，即「A≠旧值」那一半） | 1 | `Tests 5 failed | 34 passed (39)`；红的五条逐字：全局 deny 压过更长 allow／顺序对调仍压过／细粒度 allow 一起失效／合并后各带自己的 layer／写出去不含 layer 键 |
| 同上，换回本笔的 `rules.ts` | 0 | `Tests 39 passed (39)` ⇒ 本笔把该文件从 **31 条**抬到 **39 条**（＋8） |
| `node --import tsx scripts/autonomy-check.ts`（这道门会 `savePermissionRules` 落盘再回读） | 0 | `[autonomy-check] 全部断言通过`、`UNVERIFIED=1`、`收口时判卷文件 sha256 仍与冻结基线逐字一致` |
| `node --import tsx scripts/security-check.ts` | 0 | `[security-check] 全部断言通过 ✅（43 ✅ / 0 ❌）` |
| `node --import tsx scripts/mutate-verify.mjs --check-needles` | 0 | `针脚体检：1421 条 —— 阻断 0，待复认 1，未覆盖 1，逐行式 5，未入库面 0，钉在飞文本 0，killer 指针失效 0（其中 HEAD 侧 0）` ⇒ 本笔没打断任何锚点针脚 |

**判卷为什么不会把「没层归属」的老形状一起改掉**：`tests/permissions.test.ts` 里既有的手写规则一律不带 `layer`
⇒ `floor` 恒假 ⇒ 现态语义原样保留（含第 129 行那条「最长前缀语义不受影响」）。新加的第 5 条
「不带层归属的规则不触发地板」就是把这件事钉住的那一格——否则本笔会变成「顺手把所有 deny 都升成地板」，
那是另一种语义，需要另一次裁决。
