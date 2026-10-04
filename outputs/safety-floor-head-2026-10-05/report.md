# 安全地板取证（HEAD 真实读数）— 2026-10-05

作者：只读子代理（无写权，主线程落盘）。事实源 **HEAD**（工作树 167 项他人未提交已用 `git show HEAD:` 隔离）。

## 1 风险通道
HEAD 已有四条：`staticRisk`/`modelRisk`/`sandboxRisk`（`src/permissions/risk.ts`）＋第四道 MCP `annotationRisk`（`autonomy.ts`）。
**文件路径 `args.path` 不参与抬级**：`staticRisk` 只认 `edit_file`、`web_fetch` 与 shell 威胁表，`write_file`/`apply_patch` 掉到 `risk.ts` 末尾的 `return NONE`。`.git/hooks`、`.ssh` 只出现在 shell **重定向**条目里；写工具的 `path` 无对应通道。`.agent/permissions.json` 由内容工具被 `base.ts` 的 `assertNotAgentArea` **硬拒**（那是地板，不是风险评级）。`.github/workflows/**`、`package.json` 的 scripts ⇒ HEAD **零通道**。
**本该接的那一行**：`risk.ts` 里 `staticRisk` 返回 NONE 之前插 `pathRisk(args.path)`。

## 2 写向表
`SIDE_EFFECT_TOOLS`（`autonomy.ts`）＝ write_file / edit_file / apply_patch / diagnose / run_shell / shell_rw / spawn_agent。
表外兜底＝evaluate 遇未登记名 → ask（`!isKnownToolName`）。**洞**：「known 却漏登写向」的名字（`remember`/`obs_recall`/`lsp`/定时件）在只读档不摘除、方案门与沙箱通道都不管 ⇒ 能落盘却不进表＝只读摘不掉、方案门挡不住。

## 3 可审计
`gate.layer` 在 `gatedTool` 齐全（denied/rejected/timeout/unattended 都带 `gateBase`＋verdict），附于 `loop.ts`。
**缺口**：方案门在 loop 预门（frozen auto）短路时只发 `blockedBy:"permission"`＋文本，**没有 `gate.layer`** ⇒ `gate-outcomes` 按 layer×verdict 分桶会漏计 L0-hard 拒。

## 4 可回滚
快照只在 write_file / edit_file / apply_patch 三个写点（且 `ctx.snapshot===false` 或新建文件跳过）。
**绕过面**：`run_shell`/`shell_rw` 重定向覆写、`diagnose`、MCP/插件、`remember` ⇒ **全无快照**。

## 5 凭据面
唯一落盘脱敏口＝`loop.ts` 的 `redactEventForLog`（递归所有字符串叶子，args/tool_result/MCP 结果都过）。
**残口**：`src/tools/snapshot.ts` 的 `copyFile` 按字节抄原件、**不过脱敏** ⇒ 被覆盖文件里的密钥原样落进仓库可见的 `.agent/snapshots/`。

## 前 3（按「HEAD 现在真能伤人」排序）
1. **写 `.git/hooks/pre-commit` 或 `.git/config` 直通放行**（＝台账 `#85`）：guided/auto 下 `risk=none` → L4-pass 静默放行（`permissions/index.ts` 的 guided/auto＝allow），下次 commit 任意代码执行。最小修法＝`risk.ts` 加 `pathRisk`。**撞车**：`src/permissions/risk.ts` 工作树 dirty（里面正躺着未入库的 S2 `pathRisk`，探针 21/21 送审那份）⇒ 只登记不修；注：**在飞那份也不含 workflows / package.json scripts 两格**。判卷＝`gate-audit` ＋ `permission-mode-guided` 各加「写 `.git/hooks` → ask」。
2. **shell 覆写不可回滚**：`run_shell` 的普通 `>` 判 medium，自主档（high 线）L4-pass 且**无快照**。修法＝`src/tools/run_shell.ts`（现读干净）把写目标接 `snapshotBeforeOverwrite`；把破坏性重定向抬到 high 需要 `risk.ts`（撞车）。判卷＝`write-face` ＋ 快照覆盖例。→ 工单 `#99`
3. **快照明文密钥落盘**：修法＝`src/tools/snapshot.ts`（现读干净）在 `copyFile` 前对文本快照过 `redactSecrets`/`blocked`。判卷＝扫快照目录断言不含凭据。→ 工单 `#100`（注意这会改动「按字节抄」那条既有承诺，须与 `snapshot-rollback-route` 那支持卷一起改口径）

**最危险一条的证据链**：`autonomy.ts` 的写向表含 write_file/apply_patch，而 `risk.ts` 对它们 `return NONE`、`staticRisk` 全程只读 `args.command` 从不读 `args.path`；结合 `permissions/index.ts` 的 guided/auto＝allow ⇒ HEAD 上写 `.git/hooks` 无任何人点头即落盘。
