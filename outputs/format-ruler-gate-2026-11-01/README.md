# token / 字节刻度只剩两处实现 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

这两把尺在本仓被反复手抄，每修一处只补一条局部判据：

| 页 | 修的是什么 | 当时的两套写法 |
|---|---|---|
| 921 | 时间线抄了 token 尺 | `1250.0k` vs `1.3m` |
| 924 | 附件行与日志窗各一套字节尺 | `512` vs `512 B`、`1024 KB` vs `1024.0 KB` |
| 936 | 用量页走 `Intl` 紧凑记法 | `1.4万` vs `14.0k` |
| 937 | 模型菜单自己一套 k/M | `128k` vs `128.0k` |

「下一个人再抄一份」一直没人拦。本批加 `tests/format-rulers.test.ts`：扫渲染层全部 `.ts/.tsx`，
除 `derived/format-tokens.ts` 与 `derived/format-bytes.ts` 之外，出现 k/m/M 模板拼装、模板里 `${…} KB|MB`、
`Intl` 紧凑记法或 `Math.round(x / 1000)` 都当场红并点名 `文件:行`；另有一条「两把尺本身还在」，
防止允许名单变成空保护。

## 读数（工作树，未提交）

| 面 | 读数 |
|---|---|
| 现状扫描 | 渲染层 176 个源文件里，除两个实现文件外**零命中** |
| 造红 | 在 `UsageMeter` 里加一行 `` `${(n / 1000).toFixed(1)}k` `` ⇒ **1 红**，点名 `components/UsageMeter.tsx:57 [token-k]` |
| 复原 | **2/2 绿** |
| 核心套件 | **605 文件 / 7540 条全绿**，exit 0 |
| 桌面套件 | **2062 条全绿**，exit 0（含 boundary 绿） |
| 根 typecheck | 0 报错 |

## 文件

- `red-green.log`：造红与复原的原文，sha256 相同。
- `core.log` / `desktop.log` / `typecheck.log`：两个套件与根 tsc。
- `scoped.patch`：本批两个文件的差量（判据文件相对 /dev/null）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只拦「自己拼刻度」这一种形状：`formatDuration`（`1.2s` / `2m3s`）是时间刻度，不在这把尺的管辖内。
- 错误文案里的「不能超过 1 MB」不算（没有插值的模板字面量不匹配）。
- 允许名单只有两个实现文件；它们自身的存在由第二条判据钉住。

## 复现

```sh
npx vitest run tests/format-rulers.test.ts --config tests/vitest.config.ts
pnpm test:capped
```
