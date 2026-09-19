# docs/ 目录说明（先读这里）

本目录只放**现行文档**与**里程碑验收记录**。历史账本不在这里（在仓库根 `archive/`），
门禁实测值也不在这里（在 `docs/facts/gates.json`，用 `pnpm facts` 读）。

## 一、要看什么去哪

| 要看什么 | 去哪 |
|---|---|
| 每轮必读的规矩 | 仓库根 `AGENTS.md` |
| 现在在哪 / 在飞什么 / 还有什么没裁 | 仓库根 `STATE.md` |
| 历史进度、备案与裁决全文（只追加不改写，永不整读） | `archive/progress.md`、`archive/blocked.md` |
| 各门实测耗时与未证数 | `pnpm facts`（生成物 `docs/facts/gates.json`） |
| 门禁清单 | `scripts/gate-manifest.ts` |
| 现行渲染层 | `src/renderer/index.html`（单文件内联 CSS + 静态标记）+ `src/renderer/app.js`（纯 ESM） |
| 里程碑验收三态表 | `m{2,3,4,5}-acceptance.md`；审计见 `m{3,4}-audit.md` |
| 设计系统的现行规范包 | `outputs/frontend-refactor-2026-09-17/`（`00`–`06`） |
| UI 可判定量与复跑命令 | `ui-fact-baseline.md` |
| 历史界面截图（React 时代，**不能用来判断当前 UI**） | `docs/archive-shots/`（迁移于 2026-09-19，文件未改） |

## 二、本目录的规矩

- **不留二进制**：证据图落 `outputs/`，历史图走 `archive-shots/`；`docs-check` 的 D-7 守这条。
- **不抄门禁数值**：门多久、几条断言、几个文件——写指针（`pnpm facts` / 清单文件 / `tests/`），
  别写值。D-2 守这条；确属配置规格的行标 `[spec]`。
- **不用补注代替改写**：现行页里不写"前一句先留着、以后再纠正"这类追加式纠错——改了就直接改，
  要留历史写进 `archive/`。D-4 守这条。
- 里程碑验收文件（`m*-acceptance.md`、`m*-audit.md`、`m5-proposal.md`）是**收口当日的判卷证据**，
  只读不改；其中的门禁条数与断言数以当日清单为准，要看当前值请读 `scripts/gate-manifest.ts` 与 `tests/`。
- `CODE-WIKI.md` 是较早的仓库导览，正文按存档处理：与源码不符时以源码与本目录 README 为准。

## 三、刷新交付截图

`pnpm panels-check` 默认**不写盘**（否则每次跑门禁都脏工作树）。需要刷新时：

```sh
M1E_SCREENSHOT=1 pnpm panels-check    # 写到 outputs/shots/m1e-*.png
```
