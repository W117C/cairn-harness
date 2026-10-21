# Cairn / DSH —— 现态

rev: 8c3252d6640c795c8b6357632ec0e075d7d7c14a

> 本文件是**现态层**：**整体重写，永不追加**。要留当时的判断，写进 `PROGRESS.md` 的对应页；
> 要留"为什么现在是这样"，写进 `docs/adr/`。
> `docs-check` 的 D-2（不抄观测值）与 D-4（不以新增段落代替改写）两张面机械守这两条。

## 四层文档各放什么

| 层 | 落点 | 放什么 | 写法 |
|---|---|---|---|
| 规矩层 | `AGENTS.md` | 不知道就会这一轮做错事的规则 | 只加新规则 |
| 现态层 | `STATE.md`（本文件）、`docs/README.md`、`docs/CODE-WIKI.md` | 现在在哪、在飞什么、还有什么没裁 | **整体重写** |
| 台账层 | `PROGRESS.md` | 历史与审计链：备案、裁决全文、各轮实录 | **只追加**，不改写 |
| 档案层 | `archive/` | 不再现行的结论与历史图 | 归档 |

**台账层不搬进 `archive/`**：门有多张面（D-5/D-9/D-10/D-11/D-12/D-13）直接拿 `PROGRESS.md` 当事实源，
搬走会让那些面**停止覆盖历史那半**——"读不到"被读成"没问题"，是本仓最忌的假绿形状。
台账会变大（它是审计链，不是现态页）；现态页的瘦法是**把结论迁进 `archive/`**，不是把台账搬走。

## 现在在哪

- **core**（`src/`，不含 Electron 与 UI 依赖）：agent 循环在 `src/agent/loop.ts`，工具在 `src/tools/`，
  权限门在 `src/permissions/`，provider 适配在 `src/providers/`，事件与落盘在 `src/events/`，
  面向主进程的应用服务在 `src/main/`（core 侧不得反向依赖 `apps/desktop/`）。
- **desktop**（`apps/desktop/`）：main / preload / renderer 三层，可 import `src/`，反向禁止
  （`scripts/desktop-boundary-check.ts` 守这条）。共享 IPC 类型在 `src/main/ipc-protocol.ts`。
- **产品面**：桌面是 Claude 蓝本式的壳（意图稿在 `apps/desktop/design/desktop-design-spec.md`）；
  选型与受众的裁决在 `docs/adr/`。
- **门与读数**：门表是 `scripts/gate-manifest.ts`（清单即事实源），实测读数在 `pnpm facts`，
  **不抄进文档**（D-2 守这条）。测 HEAD 的门量的是**提交**而不是工作树——引读数要写清量的是哪一笔提交。

## 在飞什么

- 外部引用审批决议已改为**互斥**（先批后拒不再并存，用户后说的"不"算数）——
  证据、判卷与边界见 `PROGRESS.md` 第 623 页。
- 其他面没有在飞的活。
- 桌面面第二轮独立评审已落账；core 面那轮的三条真缺陷与四条"变异存活"的成因见 `PROGRESS.md` 尾部各页。

## 还有什么没裁

| 债 | 细节在哪 |
|---|---|
| 桌面：`projectCreate` / `projectCreateFromTemplate` 接受渲染层给的 `parentDir`，无"已知根"闸 | `PROGRESS.md` 第 618 页 |
| 桌面：`listSkills` / `skillBody` / `pluginDecide` 接受渲染层给的 `workspace`（只读、既有形态） | `PROGRESS.md` 第 618 页 |
| 进化面：canary 控制器尚未在生产接线 | `PROGRESS.md` 第 619 页 |
| 台账层：页号存量重复（D-13 已立案，棘轮只许下降） | `PROGRESS.md` 第 621 页 |

## 怎么验

- core 与桌面两套判卷分开跑，命令在 `AGENTS.md` 的 Verification 段。
- 改了本文件要跑 `pnpm docs-check`：D-1 量预算、D-2 查手抄观测值、D-4 查新增段落、D-5 查 `rev` 真伪。
