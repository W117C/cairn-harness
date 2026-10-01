# M2 台账 · apply_patch（2026-10-01，qoder 会话）

**一句话**：补丁级输入工具落地（解析层 + 工具本体 + 28 条判卷），五面接线到位，
真仓 200 笔提交实证（156/162 应用成功、1,424 文件逐字节 0 差、行数读数 0 差），
两条反向验证闭环，新增「接线棘轮」判卷防未来漏包；全量判卷 265 文件 / 3563 条全绿（基线 3512 ⇒ 只增不减）。

## 交付

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/tools/patch-parse.ts` | 新 | 统一 diff → 逐文件逐 hunk 计划；纯函数零 IO；截断/表头错抛 `PatchParseError` |
| `src/tools/apply_patch.ts` | 新 | 工具本体；两趟（先全量校验后落盘）；失败逐 hunk 归因（段号/补丁行号/期望/实际）；写盘纪律复用 base 四闸 + snapshot + lsp + 影响面，不另立第二套 |
| `tests/apply-patch.test.ts` | 新 | 28 条：正常应用 / 上下文漂移 / 部分 hunk 失败整笔不落盘 / 空补丁 / 二进制拒 / 删除改名拒 / 越界拒 / 行号漂移 / 多处歧义拒 / `\ No newline` / 报错有界 / 父目录自建 / 超限拒 / 快照次序 |

### 接线（业主 2026-10-01 裁决「我直接接齐」；含 2 处热文件，请集成复核）

| 面 | 文件 | 改动 |
|---|---|---|
| 静态名单 | `src/tools/base.ts` | `TOOL_NAMES` += `apply_patch`（文件自述"加一个工具只改这一行"） |
| 注册表 | `src/tools/index.ts` | `TOOLS` += `apply_patch`（9→10） |
| 规格面 | `src/agent/glm-session.ts` | `gateToolSpecs` += apply_patch spec（模型可见；描述不点其它工具名） |
| 写向表 | `src/permissions/autonomy.ts` | `SIDE_EFFECT_TOOLS` += `apply_patch`（只读档摘除 / 方案门 / 沙箱通道三条同时生效） |
| 门包装 | `src/main/agent-runner.ts` | `GatedName` += `apply_patch`；`installAppTools` 内 `gatedTool("apply_patch", …)`。**不包装 = 直连 TOOLS 的写工具，权限门整条缺席**——这是本笔最关键的一行 |
| 门禁水位 | `scripts/tools-check.ts` | 「注册表含 N 个工具」9→10 |
| 判卷水位 | `tests/prompt-surface-check.test.ts` | 参数面 61→62、有参数工具 19→20、描述面文案 9＋22×3（判卷自述"改规格的人跟着改这一格"；只读档 16 **不动**＝apply_patch 被正确摘除的反证） |
| 接线棘轮 | `tests/write-face.test.ts` | +1 条：TOOLS 里每个写向工具（`mayHaveWrittenDisk` 判）都必须在 `installAppTools` 里被 `gatedTool` 包装（含检查器自身的反向对照）。现有棘轮只抓"分类"、抓不住"漏包"——漏包＝权限门整条缺席，这是 M7 审计点名的「新工具族静默绕过写禁」的另一半 |

**与计划书的一处口径修正（读了码、核实后）**：M2 任务书写「在 `src/agent/tool-surface.ts` 登记写向」，
但该表文件头自述与对账判卷（`tests/tool-surface-parity.test.ts` 第三/四条）都只收**运行期注入**工具；
静态工具的写向登记面是 `SIDE_EFFECT_TOOLS`。登记后由三只既有棘轮反证：`write-face` 覆盖性棘轮、
`session-tools` 只读摘除、`tool-surface-parity` 三面对账（全绿，见下）。

## 实证（读数指针）

| 证据 | 文件 | 读数 |
|---|---|---|
| 真仓验证 n=60 | `verify-real-git-n60.log` | 50 笔合格提交，49 成功 / 0 失败 / 1 超限（设计边界）；588 文件逐字节 0 差；行数 0 差；exit=0 |
| 真仓验证 n=200 | `verify-real-git-n200.log` | 162 笔合格，156 成功 / 0 失败 / 6 超限；**2,086 hunk、1,424 文件逐字节 0 差、行数读数 0 差**（对照 `git diff --numstat`）；exit=0 |
| 反向验证（摘 hunk 上下文校验） | `reverse-verify-guard-off.log` | **6 条红**（含计划书点名的「上下文漂移」），exit=1 |
| 反向验证（复原） | `reverse-verify-restored.log` + `reverse-verify-hash-{before,after}.txt` | sha256 `35b1672…` 逐字节复原 ⇒ 28 绿 exit=0 |
| 反向验证（拆门包装） | `reverse-verify-wrap-off.log` + `reverse-verify-wrap-hash-{before,after}.txt` | 恰好 1 条红（接线棘轮）exit=1；复原 sha256 `52d2006…` 逐字节同 ⇒ 14 绿 exit=0 |
| 全量判卷 | `full-suite.log` | `Test Files 265 passed (265)｜Tests 3563 passed (3563)｜exit=0｜171.32s`（基线 3512 ⇒ 只增不减） |
| 门：tools-check | `gate-tools-check.log` | ✅ exit=0（「注册表含 10 个工具」过；8.8s） |
| 门：prompt-surface-check | `gate-prompt-surface.log` | ✅ exit=0 |
| typecheck | `typecheck-2.log` | ✅ `tsc --noEmit 通过（0 条报错）` exit=0（中途一跑红 4 处全归因隔壁在飞的 `scripts/docs-check.ts`、本簇 0 错；隔壁修好后复跑全绿） |
| 基线（为什么做这个工具） | `readings.md` + `baseline-n{60,200}.log` | 调用次数 10–11×（680 vs 60）；源码侧字符省 11–16% |

### 探针自身的两处修复（修复前产过假读数）

1. **回执清单截断假读数**：`apply_patch` 回执按 20 个文件截断，旧探针把"没打印"读成"行数不符"
   ⇒ n=200 报 39 处假不符（已逐条核对：全部是第 21+ 位文件）。修法：截断标记在时只记 `unlisted`，
   总数格（不截断）另核。
2. **`git` 默认转义非 ASCII 路径**（`core.quotePath=true`）会把中文路径整个挤出分母——
   与本仓 `cfa91e1` 在检查面踩过的同一个坑。修法：全 Git 调用 `-c core.quotePath=false`，
   并打印「多字节路径文件」计数自证分母没瞎（**本窗口实测 0 条**，已复核窗口内本就无中文路径，
   不是探针瞎；换语料即显形）。
3. 另有未定义引用 `notes`/`failures` 与一行语法残留，一并修掉（旧 log 属更早修订，已作废重跑）。

## 开放项（给集成 owner / 后继模块）

1. **risk parity（建议 M7 裁决）**：`src/permissions/risk.ts` 的 `staticRisk` 里
   `edit_file` 给 medium、`write_file` 给 none；`apply_patch` 现落在 none（与 write_file 同）。
   它不是洞（默认/只读档 `writeAsk=true` 照问；沙箱通道已按 `isSideEffectTool` 覆盖它），
   但 guided/auto 档会出现「edit_file 要问、apply_patch 不问」的兄弟分叉。
   本笔**未动** `risk.ts`（M7 写范围，且 M7 会重写权限表）——裁决项记此。
2. **未证（缺语料）**：「补丁比逐处替换少返工 / 提成功率」需要真会话 edit 失败语料，
   `.agent/sessions` 为空 ⇒ 不推算（口径同 `readings.md`）。
3. `PROGRESS.md` 拟合并一行（本会话不碰该文件，正文见 `PROGRESS-entry.md`）。
4. 合并（分支→主）由集成 owner/业主执行；本笔只提交到工作分支，一笔一事。
