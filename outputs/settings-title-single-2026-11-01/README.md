# 设置页头不许自己抄一份分区名 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

`settings-nav.tsx#SECTIONS` 的注释写着「顺序固定，**唯一事实源**——导航与命令面板只许从这里取」，
但 `SettingsPanel` 的七个页头各写了一遍字面量：

```tsx
<SettingsPage title="通用">        <SettingsPage title="关于与更新">   …
```

导航改名（比如把「关于与更新」收敛成「关于」），页头还留旧话，两个位置就开始说两种名字。
新增 `sectionLabel(id)`，六个页头改读它。

## 读数（工作树，未提交）

| 面 | 改前 | 改后 |
|---|---|---|
| 页头字面量 | 7 处 | **0 处**（全部 `sectionLabel("…")`） |
| 分区名出处 | `SECTIONS` + `SettingsPanel` 两份 | **1 份**（`SECTIONS`） |

| 判卷面 | 读数 |
|---|---|
| `settings-section-titles.test.ts` | 页头写回字面量且改叫「关于」⇒ **1 红**；改后 **3/3 绿** |
| 桌面套件 | **308 文件 / 2079 条全绿**，exit 0（含 boundary 绿） |
| 两端 typecheck | 0 / 0 |

## 文件

- `red-green.log`：造红（页头改叫「关于」）与复原后的绿。
- `desktop.log` / `typecheck.log`：桌面整套与两端 tsc。
- `scoped.patch`：本批四个文件的差量（判据文件相对 /dev/null）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只统一「分区名从哪来」；页头样式、排序、图标一个没动。
- 认不出的分区 id 原样返回（`sectionLabel("nope") === "nope"`），不编一个名字。
- 子分区标题（「外观」「使用习惯」「当前通道与密钥」等）仍写在各自组件里——它们不是导航分区，不在这把尺的管辖内。

## 复现

```sh
cd apps/desktop
npx vitest run tests/settings-section-titles.test.ts --config vitest.config.ts
```
