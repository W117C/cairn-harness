# 工具面取证（模型的手）— 2026-10-05

取料面：`src/tools/*` 盘上＝HEAD（`git status --porcelain src/tools` 未列 read_file/grep/edit_file/write_file/base）；
**规格面在 `src/agent/glm-session.ts`，盘上有隔壁会话未提交的 58 行，正把全部工具 description 整段重写 ⇒ HEAD ≠ 工作树**。

> 作者：一支只读子代理（无 Write 权，报告由主线程原样落盘）。任务：量工具面现状、按性价比排真实缺口、点名撞门风险。

## ① 现状表

**read_file**（`src/tools/read_file.ts`）
- 帽：`READ_LIMIT_BYTES` 50KB:9｜`MAX_LINE_CHARS` 2000:10｜`DEFAULT_MAX_LINES` 2000:11｜`LARGE_FILE_PREFIX_BYTES` 16MB:14。
- 入参只有 `path/offset/limit`:113-117（offset 1-based、从头部起）。**没有 tail / fromEnd**：全仓 `tail` 只命中 `output-ring.ts`、`compaction.ts`、`recall-path.ts` ⇒ 读日志尾部够不到。
- 超长行：`clipLine`:68-70 只留**前** 2000 字符，无列/字节窗 ⇒ 中段不可达；命中出声 `…[行截断]`:120。
- 帽出声：字节帽 `byteCapNotice(50, omitted, "接着读用 offset=N（该行只读到一半…）")`:143（实现 `cap-notice.ts:33-35`）；行数帽 :145/:148；16MB 前缀 :138；`[offset: …]`:150。#54/#57 已按码位切＋重算交付行数:123-135。
- 二进制：NUL 即拒 / 样本 8192B 内不可打印 >30% 拒:29-37，文案「疑似二进制文件，拒绝按文本读取」:100。近名建议 ≤3:40-66,97。

**grep**（`src/tools/grep.ts`）
- 有：`pattern`、`path`:85-90、`context` 1–5:93-96（`CONTEXT_MAX`:10）、`fixed_strings`:99。帽 `MAX_MATCHES` 100:6、`MAX_LINE_CHARS` 2000:7、`CONTEXT_BUDGET_CHARS` 8KB:12；子进程侧 32MB/60s（`ripgrep.ts:61,63`）。
- **没有**：`-i`（规格推模型写 `(?i)`）、独立 `-A/-B`（只对称 `-C`:103）、multiline `-U`、`--glob`/`-T`、`offset`/`head_limit`、`output_mode`（files_with_matches / count）、`--no-ignore`。
- 规格面唯一事实源是 **`gateToolSpecs()`**（`src/agent/glm-session.ts:59`，grep 段 :87-101、read 段 :69-83、edit 段 :150-165、write 段 :187-200）；`sessionToolSpecs`:512 只做装配（mode 摘除/注入/skill 摘除），worker 侧复用同一份（`worker-shell-tools.ts:226`），**不是第二份**。

**edit_file**：单 `old_string` 一处，或 `replace_all` 全替:52,73-79；**无多 hunk**。0 命中 :71 带 `nearestHint`（缩进逐字相同 / 词级 ≥0.5，:11-37）；多命中 :74 报**处数**并点名 `replace_all`。多文件原子性归 `apply_patch`（规格 :169-181）。

**write_file**：>50KB 直接拒:26-28；`DELTA_READ_LIMIT_BYTES` 256KB:11；整份重写提示 :55-57。

**跨文件检索**：`lsp` 需 `.agent/lsp.json`，**本仓没配** ⇒ `lspConfigured` false 把工具从模型面摘掉（`agent-runner.ts:1470-1477`，用在 :1548）；`impact_query` 缺省**开**（`settings.ts:129`），但帽 6 文件 / 4 符号（`impact/index.ts:379-380`）、只 4 个参数（`impact-query.ts:256-270`）；符号地图是 tree-sitter（`map/parse.ts:50-55`），但**仅首轮注入**（`glm-session.ts:972` `historyForMap.length>2` 即 null）、1024 token（`map/render.ts:12`），检索只吃首句问话（`map/build.ts:375`）——模型**调不到**它。`obs_recall` 有 `byteInLine` 那种行内窗（`solpi-runtime.ts:59`）但 `observationPack: false`（`settings.ts:122`）。

## ② 前 3 缺口（性价比＝对模型成功率的增益 / 改动行数）

1. **read_file 无 tail**。测试/构建结论都在文件尾部，而 50KB 头帽 ⇒ 大日志只看得到开头。最小改法：`read_file.run` 选段处（:113-117）加 `tail` 分支走 `lines.slice(-n)`，复用 :120-149 提示口径；把 `output-ring.ts:96` 的 `tailWithin` 改 `export` 供字节帽复用（**不在 read_file 里另写一份码位回退**）。判卷：`tests/read-shape.test.ts` 新增「tail=20 交付末 20 行并声明起始行号、不误报 truncatedLines」。
2. **grep 无 `--glob` 收窄与 `files_with_matches`/`count`**。100 条帽外模型只能改 pattern，不能改文件面。最小改法：`grep.ts:100-105` 的 rg 参数数组按 `args.glob` 追加 `--glob`、按 `args.output_mode` 追加 `-l|-c`；**同笔**在 `glm-session.ts:92-100` 写字段说明（讲少了＝不会用）。判卷：`tests/grep-context.test.ts` 同族加一条 ＋ 负例说明仍 <300 字符（`tests/grep-glob-edit.test.ts:85-86`）。
3. **超长行中段不可达**（minified bundle / 单行 JSON）。最小改法：`clipLine`/选段处接受 `column`（起始字符偏移），仍受 `MAX_LINE_CHARS` 帽；文案沿用 `…[行截断]` 并在尾部报「该行共 N 字符，本次从 M 起」。

## ③ 撞门风险清单

- **规格字节**：`MODEL_SURFACE_TOTAL_CHAR_LIMIT` 24000、`MODEL_SURFACE_TIGHT_DESC_CHAR_CAP` 600（`src/agent/model-surface.ts:43,47`）；`tests/model-surface.test.ts:47`（缺省装配必在帽内）、`scripts/model-surface-check.ts:76,147`（缺省装配还要**逐字一致**）。
- **prompt-surface 门**：`scripts/prompt-surface-check.ts:92-106` 取**参数级 description** 当一面；:120-147 覆盖率只印不拦；描述里点了别档没有的工具名 → `promptSurfaceFindings` 报 odd/dead（`src/agent/prompt-surface.ts:60-77`），豁免表当前为**空**（:24-26）。
- **已有断言会被顶破**：`tests/read-shape.test.ts:58`（输出 ≤50KB+200）、:46（行截断长度精确）；`tests/grep-glob-edit.test.ts:85-86`（零命中整条 <300 字符）、:43-45（条数帽文案禁出现 "KB"）；`tests/edge-cases.test.ts:57`。
- **变异锚点**（`scripts/mutate-verify.mjs`）：:1947-1990 六条 grep（`grep-context-cap-removed`/`-lines-eat-hit-budget`/`-marker-collides-hit`/`grep-always-emits-context`/`grep-fixed-flag-dropped`/`grep-budget-omitted-count-lies`）、:4377 `grep-negative-note-loses-escape-hatch`、:471 `read-file-oversize-note-dropped`、:9079/:9096 `prompt-surface-edit/write-path-prose-removed`。动 `renderMatches`/帽文案要先确认这些针脚仍被杀。
- **三面同账**：`tests/tool-surface-parity.test.ts`（新增工具名要同时进实例/规格/worker 三面）。

## ④ 题设需更正处（子代理反打主线程）

- 主线程给的题设「规格面在 `sessionToolSpecs`」不准：文案源在 `gateToolSpecs()`，`sessionToolSpecs` 只装配。
- 题设「工具规格面干净」**不成立**：`glm-session.ts` 盘上有未提交的规格描述整体重写 ⇒ 任何规格改动此刻认证的是旧面，且与隔壁同一批行冲突。
- 题设里假设 grep 可能有 `-i`/`-A`/`-B`/multiline/`offset`/`output_mode` —— 全部没有，只有对称 `context` ＋ `fixed_strings`。
- 「跨文件靠 grep 兜底」低估了三件已发货能力：`impact_query`（缺省开）、符号地图（缺省注入但**首轮一次性、不可调**）、`lsp`（本仓因未配 `.agent/lsp.json` 而默认不在面上）。

## ⑤ 主线程处置（本笔登记，不施工）

三个缺口的**参数说明都必须进 `gateToolSpecs()`**，那个文件此刻在别人手里（58 行未提交）⇒ 按本仓规矩「撞到别人在飞的面时只记不修」，工具面这一族整批挂起，等 `glm-session.ts` 落库后再走「行为＋文案同笔」的原子簇。
已登记为工单：`#87`（read_file tail）／`#88`（grep glob＋output_mode）／`#89`（超长行 column 窗），共同前置＝规格面腾出手。
