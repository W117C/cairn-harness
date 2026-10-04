# S1 拆成两半的读数（2026-10-04，取料＝干净 detached 树 `.worktrees/verify-head-582ec74` @ `582ec74b`）

## 本笔落的那一半：`read_file` 不再顺手 spawn

| 跑法 | 退出码 | 读数 |
|---|---|---|
| `node --import tsx scripts/typecheck.ts` | 0 | `tsc --noEmit 通过（0 条报错）` |
| `vitest run` × 10 支文件（`lsp`／`plugin-lsp-activation`／`permissions-tool-registry`／`tool-surface-parity`／`session-tools`／`prompt-surface-check`／`diagnose`／`write-face`／`web-search`／`impact-query`） | 0 | `Test Files 10 passed (10)｜Tests 196 passed (196)` |
| 新判卷配 **HEAD 那版** `src/tools/lsp.ts` | 1 | `Tests 4 failed | 11 passed (15)`——红的四条：缺省不预热／显式开启确实预热／谓词只认字面 1／另两个不 spawn 出口 |
| 新判卷配本笔 `src/tools/lsp.ts` | 0 | `Tests 15 passed (15)` ⇒ `tests/lsp.test.ts` **11 → 15 条**（＋4） |

**关键的一条证据在旧值那一跑里**：「缺省不预热：marker 不存在」在 HEAD 的代码上是**红**的——
红的原因是它真的 spawn 了（`trace-server.mjs` 落了痕）。也就是说 S1 那条链不是我从评审文档里读来的，
是判卷在旧代码上现场撞出来的：`read_file → prefetchLsp → getLspClient → startClient → spawn(.agent/lsp.json 里的 command)`。

## 没有落的那一半，以及为什么它不是一行

我原本打算把 `lsp` 补进 `src/permissions/autonomy.ts` 的 `SIDE_EFFECT_TOOLS`（照 `diagnose` 的先例：「它执行进程」）。
跑了那一改之后，**本仓自己的判卷报了 6 条红**（原文见 `table-half-six-reds.txt`），逐条都是要脸面交代的：

| 红在哪 | 断言两侧原值 | 它说的是什么 |
|---|---|---|
| `permissions-tool-registry` B1 | `lsp @ read-only: expected 'deny/L0-hard' to be 'approve/L4-pass'` | 26 个既有工具名在四档下的裁决**金标准表**要把 lsp 改判 |
| `permissions-tool-registry` B2 | `lsp @ read-only 非交互: expected 'deny' to be 'allow'` | `gate()` 同一格的第二半 |
| `prompt-surface-check` | `只读档参数描述面数：expected 11 to be 16` | 只读档的模型可见面**掉 5 格**（lsp 的参数说明整块从提示里消失）⇒ 每把工具的 token 账要重算 |
| `write-face` 分类 | `lsp 不该被算成改盘: expected true to be false` | **仓里已有一条判据明确钉着「lsp 不算改盘」**——这与「lsp 进写向表」是正面冲突的既有裁决 |
| `write-face` 覆盖棘轮 | 工具表里每个名字必须显式归类 | 归类表要跟着改 |
| `write-face` **接线棘轮** | `写向工具没被门包装 ⇒ …：lsp: expected [ 'lsp' ] to deeply equal []` | **这条直接判死**：进了写向表就必须在 `installAppTools` 里被 `gatedTool` 包装，两半不许分笔 |

最后一条是决定性的一条：**「只补表不包装」在本仓不是合法的半步**，棘轮当场拒收。而包装那一半要改
`src/main/agent-runner.ts`——该文件现读 ` M`（隔壁 M4 簇在飞），且它的体量帽（`repo-hygiene-check` 的 2800）余量薄。

所以正确的下一手**不是**补表，而是把这两件事一起交给 #58，并带上这里量到的两个前提：

1. `write-face` 已经钉着「lsp 不算改盘」⇒ 要么改那条判据（那是**推翻既有裁决**，需要理由与页号），
   要么走评审给的**另一条路**：`.agent/lsp.json` 的 `command` 复用插件那只内容指纹信任门
   （`src/agent/plugins/trust.ts` 的 `TrustStore`＋`pluginFingerprintEx`，`scripts/plugins-check.ts:248` 已有 LSP 用例在用它），
   这样「显式调用 lsp 工具」第一次出卡、之后按指纹免批，既不动只读档的能力面也不撞 write-face。
2. 无论走哪条，`GatedName`（`agent-runner.ts:513` 现读七个名字，不含 lsp）与 `SIDE_EFFECT_TOOLS` 的
   关系要先说清：**包装是审批卡的来源，表是档位摘除的来源**，本仓的接线棘轮要求两者同笔。

## 本笔之后还开着的 S1 剩余面

模型**显式调用** `lsp` 时仍会 spawn 仓库带来的可执行文件（零审批、零提示）。
读文件那条静默链已闭死；显式调用这一条按上面的路径处理，且需要业主在「改判据」与「换信任门」之间选一个。
