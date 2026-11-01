# 段标题不许与分区名同名 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

「关于与更新」与「快捷键」两页里，页头和第一个段标题写着同一个词：

```tsx
<SettingsPage title={sectionLabel("about")}>      // 页头：关于与更新
  <AboutSection> → <SettingsSection title="关于与更新">   // 段标题：又一遍
```

渲染出来是「关于与更新」大字下面再顶一行同名小标题，读起来像重复渲染。另外七页没这问题（「通用」下面是「外观」「使用习惯」）。

改成：「关于与更新」→ **版本与更新**，「快捷键」→ **按键一览**；并加一条通用判据。

## 读数（工作树，未提交）

| 面 | 改前 | 改后 |
|---|---|---|
| 与分区同名的段标题 | 2（关于与更新 / 快捷键） | **0** |

| 判卷面 | 读数 |
|---|---|
| `settings-section-titles.test.ts` | 改回同名 ⇒ **1 红**（点名 `关于与更新 \| 快捷键`）；改后 **4/4 绿** |
| `settings-sections.test.tsx` | 关于段的标题断言改指「版本与更新」；两文件合跑 **37/37 绿** |
| 桌面套件 | **310 文件 / 2085 条全绿**，exit 0（含 boundary 绿） |
| 桌面 typecheck | 0 |

## 文件

- `red-green.log`：造红（两个同名一起回来）与复原后的绿 + sha256。
- `desktop.log` / `typecheck.log`：桌面整套与 tsc。
- `scoped.patch`：本批四个文件的差量。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只改这两个**与分区同名**的段标题；其余段标题（外观 / 使用习惯 / 当前通道与密钥 / 能力 / 权限档 / 安全 / 候选 / 实验 / 治理 …）一个没动。
- 判据盯着「段标题 == 任何分区名」，不是「段标题必须独特」——同名段标题跨分区出现（如两个页面都有「安全」）不算问题。
- 取不到 ≥8 个段标题就先红：防止正则坏了以后空跑成绿。

## 复现

```sh
cd apps/desktop
npx vitest run tests/settings-section-titles.test.ts tests/settings-sections.test.tsx --config vitest.config.ts
```
