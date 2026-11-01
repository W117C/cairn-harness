# 闸门面的人话覆盖有判据 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 这一批改了什么

批准卡的人话是逐轮补的（名单外工具 → 读族 → 补丁抬头），但没有一把尺把**闸门清单**与**人话清单**锁在一起：
`src/main/tool-gates.ts` 的 `GatedName` 新增一把工具而 `describeAsk` 没跟上时，卡片会静默落到兜底
「需要你批准 + 参数 JSON」。新增 `tests/approval-coverage.test.ts`：

1. 从源码取出 `GatedName` 的成员，先断言取到了 ≥10 条（正则坏了这条先红，不会空跑成绿）；
2. 逐个要求标题不是兜底；
3. 任意两把工具的标题不得相同（卡上要读得出是哪件事）。

## 读数（工作树，未提交）

| 面 | 读数 |
|---|---|
| 闸门工具 | 12 把（`write_file` / `edit_file` / `apply_patch` / `run_shell` / `web_fetch` / `web_search` / `diagnose` / `lsp` / `render_image` / `read_file` / `grep` / `glob`） |
| 现读 | 12 把**全有人话标题**，且 12 个标题互不相同 |
| 造红 A | 拿掉 `grep` 的分支 ⇒ **1 红**，点名 `grep` |
| 造红 B | 把 `render_image` 的标题改成「读取文件」⇒ **1 红**（标题重复） |
| 复原 | **3/3 绿** |

| 判卷面 | 读数 |
|---|---|
| 桌面套件 | **2065 条全绿**，exit 0（含 boundary 绿） |
| 两端 typecheck | 0 / 0 |

## 文件

- `red-green.log`：两处造红的原文与复原后的绿，sha256 相同。
- `desktop.log` / `typecheck.log`：桌面套件与两端 tsc。
- `scoped.patch`：本批两个文件的差量（判据文件相对 /dev/null）。
- `docs-check.log`：台账门在补页之后的读数。

## 边界

- 判据只管「有没有自己的那一句、是否互不相同」，不管那句话措辞好不好——措辞由各轮的行为判据钉。
- `GatedName` 是类型声明（运行时没有实体），所以这一条读源码；源码里那个 union 一旦改形状，第一条断言会先红。
- 名单外工具（MCP scoped 等）仍走兜底「需要你批准 + 工具名 + JSON」，不在本批范围。

## 复现

```sh
cd apps/desktop
npx vitest run tests/approval-coverage.test.ts --config vitest.config.ts
pnpm test
```
