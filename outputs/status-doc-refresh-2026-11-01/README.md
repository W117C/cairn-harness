# 「现读」必须带日期 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

`docs/REPOSITORY-STATUS.md` 自称「本页只写现态」，但 10-27 那批读数一直以「现读」的口吻留在表里。
按当前工作树重量，三处已经对不上：

| 读数 | 10-27 写的 | 2026-11-01 实测 | 差 |
|---|---|---|---|
| `src/main/agent-runner.ts` 行数 | 1868 | **2023** | +155 |
| `src/cli.ts` 行数 | 1669 | **1869** | +200 |
| `apps/desktop/src/main/index.ts` 行数 | 1434 | **2104** | **+670（+47%）** |
| `App` chunk | 268.40 kB（gzip 83.82） | **305.89 kB（gzip 95.52）** | +37.5 kB / gzip +11.7 kB |
| `index` chunk | 176.11 kB（gzip 60.72） | 175.11 kB（gzip 60.40） | −1.0 kB |
| `xterm` chunk | 329.31 kB（gzip 83.04） | 321.59 kB（gzip 80.79） | −7.7 kB |
| `outputs/` 占比 | 4226 / 6193 = 68.2% | 4278 / 6291 = 68.0% | ≈ |

三行按实测改数并逐行标 `2026-11-01 复核`；延迟类读数（首开/复开 ms、流式帧）**本轮没有重量**，
所以依赖它们的结论一条没动（白纸黑字写进表头上方，免得下一个人以为全表都新量过）。

## 读数（工作树，未提交）

| 判卷面 | 读数 |
|---|---|
| `status-readings-dated.test.ts` | 去掉某行的日期 ⇒ **1 红**（点名那行）；改后 **2/2 绿** |
| 核心套件 | **608 文件 / 7550 条全绿**，exit 0 |
| 根 typecheck | 0 报错 |

## 文件

- `measure.sh` / `measure.log`：重量脚本与读数（行数 / tracked 占比 / 主 chunk raw+gzip）。
- `red-green.log`：造红与复原的原文 + sha256。
- `core.log` / `typecheck.log`：核心套件与根 tsc。
- `scoped.patch`：本批三个文件的差量（判据文件相对 /dev/null）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 只重量了「能一条命令量准」的数字；延迟/帧率类没重量，文中已明确标注，不据新数改旧结论。
- 行数涨幅来自工作树里未提交的批次，不是已发布基线——这一句写进了表里，免得被当成回归。
- 判据只管「标了『现读』就得带日期」，不校验数字本身（数字会随代码动，钉死会天天红）。

## 复现

```sh
sh outputs/status-doc-refresh-2026-11-01/measure.sh
npx vitest run tests/status-readings-dated.test.ts --config tests/vitest.config.ts
```
