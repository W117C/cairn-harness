# Cairn / DSH —— 现态

rev: 3017e88cb0a7e35bda0654794404f7eed79ddaa2

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
现态页的瘦法是**把结论迁进 `archive/`**，不是把台账搬走。

## 现在在哪

- **core**（`src/`，不含 Electron 与 UI 依赖）：agent 循环在 `src/agent/loop.ts`，工具在 `src/tools/`，
  权限门在 `src/permissions/`，provider 适配在 `src/providers/`，事件与落盘在 `src/events/`，
  面向主进程的应用服务在 `src/main/`（core 侧不得反向依赖 `apps/desktop/`）。
- **会话语义**（`docs/adr/0005-log-structural-records.md`）：分叉是**指针不是拷贝**，游标**不透明且 fail-closed**，
  提交带 `requestId` 幂等键；「日志结构控制记录」是「新增能力优先走既有字段」那条纪律的**唯一例外**。
  会话正文检索是**三态**（`ok` / `partial` / `unavailable`）——「没量到」由类型层面与「没有匹配」分开。
- **desktop**（`apps/desktop/`）：main / preload / renderer 三层，可 import `src/`，反向禁止
  （`scripts/desktop-boundary-check.ts` 守这条）。共享 IPC 类型在 `src/main/ipc-protocol.ts`。
  渲染层分 `state/` → `derived/` → `components/` ＋ `panes/` → `App.tsx`（组合根），
  机器面是 `scripts/renderer-layer-check.ts`。
- **产品面**：桌面是 Claude 蓝本式的壳（意图稿在 `apps/desktop/design/desktop-design-spec.md`）；
  选型与受众的裁决在 `docs/adr/`。
- **门与读数**：门表是 `scripts/gate-manifest.ts`（清单即事实源），实测读数在 `pnpm facts`，
  **不抄进文档**（D-2 守这条）。测 HEAD 的门量的是**提交**而不是工作树——引读数要写清量的是哪一笔提交。

## 在飞什么

- **桌面端下一轮（三条轴，业主已裁）**：① **性能与架构**；② **路由体积**；③ **设计面**。
  **已做**：③ 的动效档位归位与减法两片；① 的 memo 边界与**把 `App.tsx` 拆成多文件**（它现为组合根，
  代价那一格改判卷读整个渲染层面，而不是搬断言）；② 的弹出窗甩掉整页工作台。
  **未做**：② 剩下的 Radix 下拉依赖树（账已量成数字，是业主的裁）。
  见 `PROGRESS.md` 第 641、646–652 页。
- **已入库**：第 639–645 页那五批（细节归台账）；第 652 页那一批（桌面拆分 ＋ 会话正文检索 ＋ 审计生命周期）。
- 外部引用审批决议已改为**互斥**（先批后拒不再并存，用户后说的"不"算数）——见 `PROGRESS.md` 第 623 页。
- 其余面没有在飞的活。

## 还有什么没裁

| 债 | 细节在哪 |
|---|---|
| 本机量不了的两件事：① 设计面改的是**视觉、却没有新截图做目验**（依据是仓内上一轮真机截图 ＋ 静态判卷）；② 性能改动的**收益幅度未量** | `PROGRESS.md` 第 648、649 页 |
| 路由体积剩下的那笔是 **Radix 下拉菜单的依赖树**：要让它退出首屏，6 处下拉的整个 Radix 子树（含触发钮）都得延迟加载 ⇒ **体积 vs 首次打开延迟是业主的裁** | `PROGRESS.md` 第 650、651 页 |
| 能力收益不可测：无 `CAIRN_API_KEY` / `CAIRN_ENDPOINT`，bench 12/12 不可跑；已证的是机制与判据 | `PROGRESS.md` 第 640 页 |
| 本机桌面端**终端窗格是坏的**：PTY 里命令只回显不执行。**归因已改正**——不是 quarantine 标记，而是「交互 zsh 读 `$HOME/.zshrc` 作启动文件时挂」⇒ 本机环境债，非应用回归 | `PROGRESS.md` 第 641 页 |
| 台账层：页号存量重复（D-13 已立案，棘轮只许下降） | `PROGRESS.md` 第 621 页 |
| 自进化面的**能力收益**仍未验证（评价入口只有脚本化 demo） | `BLOCKED.md` 第 637/638 页 |
| 自进化控制平面里 `EvolutionPlane` / `GateRunner` / `Installer` / `PermissionBroker` / `GrantsStore` 仍只有判卷消费者——**刻意分期**（Phase 4 才放开自动安装），不是漏接 | `docs/sema-proposal.md` §11；`BLOCKED.md` 第 637 页 |
| **认证门要出沙箱**：`git worktree add` 在沙箱里退 128（新位置建点号文件被拒）⇒ 沙箱内跑全量会多出端口绑定的假红、跑认证会失败 | `PROGRESS.md` 第 647、652 页 |
| `scratch-tree-naming` 的真仓面要有一棵挂在分支上的暂存树才有对象；清掉暂存树会再红一次（**机器状态**，不是产品保证） | `PROGRESS.md` 第 652 页 |
| 三面审计出的真缺陷**其余仍在案**——已修：核心两条（643）、自进化一条（644）、产品两条（645） | `PROGRESS.md` 第 642–645 页 |

## 怎么验

- core 与桌面两套判卷分开跑，命令在 `AGENTS.md` 的 Verification 段。
- 改了本文件要跑 `pnpm docs-check`（D-1 预算、D-2 手抄观测值、D-4 新增段落、D-5 `rev` 真伪）。
