> **⚠️ 存档（2026-09-18 裁定）**：本包降为存档，**不可直接施工**——其事实基线已漂移：自报 `app.js` 2281 / `index.html` 1866，HEAD `eafcbfb` 实测 **2690 / 1977**（+409 / +111，复跑见 `docs/ui-fact-baseline.md` F18）。
> **两面权威**：意图 = `agent-plan.md` §10.1 七条布局定稿；事实 = `docs/ui-fact-baseline.md`（每项配复跑命令）。本包**仍有效**的只有 §1 裁决记录（2026-09-17 用户拍板）与「不引框架 / 不引组件库」取向；正文一字未改。

# 质量审查报告 · Forge 前端重构（Phase 4 / 2026-09-17）

> 审查官：质量审查官 严过审（Yan）。
> 审查对象：`00-recon-brief.md` / `01-requirements.md` / `02-design-system.md` / `03-refactor-design.md` + `evidence/*`（共 6 份，全部在 `outputs/frontend-refactor-2026-09-17/`）。
> 审查原则：**独立验证，不采信自评**。本报告所有"实测"结论均由本人重新跑命令/写脚本产出，**未复用被审文档的脚本、也未复用 `evidence/contrast-recompute.py`**。
> 硬约束遵守：**未改 `src/` 下任何代码**；**未修改任何被审文档**（意见只写在本文件）。
> 工作树基线（本审查时实测）：`index.html` 1866 行 / `app.js` 2281 行 / `main/index.ts` 352 / `settings.ts` 184 / `panels-check.ts` 386 / `projections.ts` 591 / `store.ts` 141 / `preload/index.ts` 85。

---

## 1. 评审结论

### 1.1 逐维评分（1–5，满分 25）

| 维度 | 评分 | 评语 |
|---|---|---|
| **设计哲学** | **5**/5 | 理念清晰且自洽：**「演进而非推翻」**（视觉体系不动、零新色相、只做增量补齐），并以 `F-1…F-8` 证据支撑「好手艺 + 零工程护栏 → 优化重点在护栏与结构」的核心判断。三份文档围绕同一哲学展开，无方向摇摆。 |
| **视觉层次** | **4**/5 | 文档结构优秀：TL;DR 先行、结论表密集、覆盖矩阵与自检表齐全，读者可快速定位。扣分点：**跨节交叉引用有 2 处错引**（`02 §H` 把「CSS 分层输入」指向 `§A.7` 动效令牌；`03 §3.5` 称「对齐 React 8 类」实列 7 类）。 |
| **执行质量** | **3**/5 | **行号精度（本轮最大风险点）表现优秀**——本人抽查 ~100 处行号引用，仅 1 处函数名张冠李戴（`02 §0.2#12`）。但**验收口径层面有明显缺陷**：① `A11Y-02` 的 `grep -c 'aria-' ≥298` 实为 241，**口径不可判定**；② `01↔03` 对 `MAINT-06` 的 `import` 目标给出**相反**的验收口径；③ `02 §A.2.2` 与 `§A.1.3` 的 `--border-strong` 数值自相矛盾。 |
| **特异性** | **5**/5 | 品牌/工程辨识度极高：所有结论都锚定到**具体文件 + 具体行号 + 具体数值**（`--sidebar-w 252 vs 264`、`KEEP_CENTER 380`、`data-tool-toggle` 6 处…），换到任何别的仓库都不成立。这是本轮文档最强的资产。 |
| **克制** | **4**/5 | 无空话、无术语堆砌，每个结论都有证据。扣分点：**自检表存在轻度过度声称**（`02 附`/`03 §12` 逐项打 ✅，但本人实测发现其中「所有行号与工作树一致」「双主题 AA」「立 BLOCKED」三项均有瑕疵）。 |

**总分：21 / 25**

### 1.2 结论

> **PASS**（P0 = 0，P1 = 2，五维全部 ≥ 3）。
>
> **但附带强制修复项**：P1 的 2 条（`MAINT-06` 跨文档口径矛盾、`A11Y-02` 不可判定口径）**建议在进入落地轮前修正**——它们直接决定"落地轮拿哪条判据验收"，不改会在落地轮引发返工。P2 建议修，P3 可选。

---

## 2. 独立验证记录（我实际跑了什么 / 得到什么 / 是否吻合）

> 全部命令均在 `/Users/ze/Downloads/deepseek harness` 下执行；脚本落在 `/tmp/yan_contrast.mjs`、`/tmp/yan_diag.mjs`、`/tmp/yan_cmap.py`（见 §7 附录）。

### V1. 数值复算（对比度表）—— 独立实现，**部分不吻合**

**做法**：**自己重写**了一条 `oklch → OKLab → linear sRGB → WCAG 相对亮度 → 对比度` 链路（`/tmp/yan_contrast.mjs`，与文档 §I 的 Node 脚本、与 `evidence/contrast-recompute.py` **均无复用**），自检 `oklch(100% 0 0) = #ffffff / 1.00:1` 通过。

**结果**：抽查 16 个令牌 × 双主题 × 2 个基准面，**13 组逐位吻合**（含任务点名的 `--dim` dark vs `--surface-2` = **4.47:1** ✅）。**3 组不吻合**：

| 令牌 | 文档值 | 我的复算 | 判定 |
|---|---|---|---|
| `--border-strong` light | `§A.2.2` = **3.64:1**（hex `#83878b`） | **3.36:1**（hex `#898d91`） | ❌ **`§A.2.2` 错**；`§A.1.3` 自述 **3.36** 才对 |
| `--border-strong` dark | 3.83:1 | **4.13:1**（vs `--bg`）/ 3.50（vs `--surface-2`） | ❌ 文档 3.83 无法复现 |
| `--border` dark | 1.33:1（列标"vs bg"） | **1.43:1**（vs `--bg`）/ **1.33**（vs `--surface`） | ⚠️ 数值对得上 `--surface`，但**列标写"vs bg"是基准错标** |

> 任务点名的两项（`--border-strong 3.64`、`--dim dark vs s2 4.47`）——**前者不成立、后者成立**。三处偏差均**不改变结论方向**（`--border-strong` 仍 ≥3:1、`--border` 仍 <3:1），属数值/标注层缺陷。
> **副产物**：我的复算**独立复现**了文档的核心发现——源码注释 `--fg light 19.9:1` 实测为 **17.71:1**（偏差 −2.19）。

### V2. 行号抽查 —— **抽查 ~100 处，仅 1 处错**

**做法**：从 `02`/`03` 逐条抽取行号引用，用 `sed -n 'Np'` / `grep -n` 回源核对（远超任务要求的 ≥8 处）。

**吻合（抽样列举，全部实测正确）**：
- `02`：令牌块 `:root 15-57 / dark 58-89 / 第二 :root 90-94` ✅；`--sidebar-w 252px @17` ✅；`--gutter 8px @19` ✅；`--accent @30/68` ✅；`--t-fast/base/slow @53-55` ✅；`.inline-send 26×26 @791` ✅；`.composer-box 圆角 12px @780` ✅；`#settingsOpen @1401` ✅；`.drawer.open-m @1362` ✅；`data-def="264" @1414` ✅；`.msg-act 28×28 @549` ✅；`.mp-close/.mp-back 24×24 @831/944` ✅；`.side-home 28×28 @966` ✅；13 处 reduced-motion `@378/533/573/627/660/714/753/950/1065/1160/1163/1333/1346` ✅（**逐行吻合**）；`askCard() @2089` ✅；`data-ask @2130` ✅；`.ask-pop @2027` ✅；`✗ @1849` ✅。
- `03`：`let sortBy/sessions/archived/selectedId @28/35/46/50` ✅；`sessionItemHTML @122` ✅；`render @165` ✅；`KEEP_CENTER=380 @580` ✅；`sideMax/drawerMax @581/582` ✅；`scrollStream @894` ✅；`setInterval @992/1107` ✅；`finalizePending` 相关、`renderEvent @1854` ✅；`assistant_delta @1865` ✅；`data-card-toggle 委托 @1630` ✅；`data-tool-toggle 委托 @1640-1656` ✅；`real @1670` ✅；`tokStr @1728` ✅；`diffHtml @1908` ✅；`bridge IIFE 1660-2281` ✅；覆写点 `send/selectSession/deleteSession/archiveSession @2181/2209/2251/2268` ✅；`r.events.forEach(renderEvent) @2223` ✅；`main/index.ts createWindow @63 / BrowserWindow @64-66` ✅；`settings.ts PANEL_IDS @10 / LayoutState @13-20 / width:32 @51-56 / validateSettings @80-126` ✅；`panels-check.ts import @12 / 7 探针 @251/257/260/264/265/269/271/278/286/299/327 / 复用 @344-346` ✅（**逐条吻合**）；`events/index.ts @29-37 / @25 / @173-235` ✅；`ipc-protocol.ts @43/90-97/144` ✅；`scheduler.ts @394-396` ✅；`cards/registry.tsx @188/201-212/214` ✅；`projections.ts projectAgentPanel @449` ✅。

**不吻合（唯一 1 处）**：
- `02 §0.2#12` 称「**1748 行是 `finalizePending`**、1764 行是 `toolIcon`」。实测：**1748 行属于 `finalizeAi`（起于 1732）**；`finalizePending` 起于 **1751**。1764 = `toolIcon` 内部 ✅。→ **半对**（P3）。

### V3. 钩子清单核对 —— **完全吻合**

**做法**：`grep -ohE 'data-[a-z0-9-]+'` + `grep -ohE 'dataset\.[a-zA-Z0-9]+'` 对 `index.html`+`app.js` **全量枚举**，与 `02 §E.1` 逐条比对。

**结果**：
- 枚举得 **36 个 `data-*` 唯一 token + 29 个 `dataset.*` 唯一 token = 65 个 token 形态**——与 `02 §E.1`「共 65 个 token」**完全一致**。
- 归一化后共 **41 个钩子**，与 `§E.1` 表列出的 41 个**一一对应、无遗漏、无幻影**（含补录的 `data-tool-toggle`，含 `data-sid`/`data-doc-active`/`data-v`，含 `dataset` 形态的 `data-archived`/`data-tokenized`/`data-scope`/`data-ask-id`）。
- **计数逐一吻合**：`data-od-id 27` ✅ `data-val 13` ✅ `data-sec 10` ✅ `data-act 9` ✅ `data-msg-act 8` ✅ `data-view 7` ✅ `data-switch 7` ✅ `data-label 7` ✅ `data-tool-toggle 6` ✅ `data-live 5` ✅ `data-card-toggle 5` ✅ `data-set-theme 4` ✅ `data-grp 4` ✅ `data-drawer 4` ✅ …（余同）。
- 微瑕：`data-empty` 实际 **3 处**（`index.html:991` + `index.html:1652` + `app.js:826`），文档记 **2**；`data-ask` 文档引 `app.js:2130`（是 `dataset.ask` 写入点），字面量选择器 `[data-ask="…"]` 在 `app.js:2168`。→ P3。

### V4. 需求覆盖核对 —— **27 条全覆盖，1 条"覆盖含糊"**

见 §4 覆盖矩阵。结论：**`03` 对 27 条逐条给方案**；`02` 覆盖 `VIS/A11Y` 全量 + 设计侧输入（`MAINT-03/05/06/07`、`RESP-01…04`、`PERF-02`、`GAP-02`）。**无任何需求"两份都不覆盖"**。唯一"覆盖含糊"：`MAINT-05`（`03 §7.3/§7.6` 仍留 6 项"待判定"，未达 `01` 的"`待定` = 0"验收）。

### V5. 内部矛盾 —— **发现 1 处硬矛盾 + 若干口径不一致**

1. 🔴 **`01 ↔ 03` 对 `MAINT-06` 的 `import` 目标相反**（详见 §3 P1-1）。
2. **钩子计数口径混乱**：`00 §5` 表列 30 个 / 文字称"32 个"；`03 §0/§7.7/§12` 称"32 钩子"；`02 §E.1` 称 41 个钩子 / 65 个 token 形态。四组数字并存。
3. `02 §A.1.3` 3.36 vs `§A.2.2` 3.64（`--border-strong` light）。
4. `02 §B.1` 称"**两处**刻意同色不同形"，实为**三对**（`成功/运行` 亦同为 `--ok`）。
5. `evidence F-7` 记 `innerHTML = 36`，`00 §6` 与实测均为 **37**。
6. `00 §1` 的工作树快照仅列 renderer 改动，**遗漏** `src/agent/*.ts`、`src/main/index.ts`、`src/events/index.ts`、`tests/*` 等 15+ 个 `M` 文件（实测 `git status` 共 35 项）。

### V6. 可判定性审查 —— **挑出 4 条"看似可判定实则不可判定/模糊"**

见 §3 P1-2 与 P2-1/2/3/4。最严重的是 `A11Y-02` 的 `grep -c` 口径。

### V7. 反事实检查 —— **未回避难点**

见 §5。结论：迁移策略、性能指标、IPC 依赖均给出了**可测口径或诚实降级**，未用"以后再说"掩盖。

### V8. 纪律核查 —— **4 条红线全部通过**

见 §6。**无 P0**。

### V9. 附加独立验证

- **量化断言复核**：`innerHTML 37` ✅ / `insertAdjacentHTML 1` ✅ / `addEventListener 80` ✅ / `classList 62` ✅ / `querySelector 100` ✅ / `app.js import 0` ✅ / CSS 区 `px 962`（60 个不同值）✅ —— **全部与文档一致**。
- **`projections.ts` 依赖面**：实测引用方 = `panels-check.ts:12/344`、`sidechat-check.ts:25`、`agents-check.ts:26`、`store.ts:6`、`panels/registry.tsx:34`、`cards/registry.tsx:18`、`cards/agent-card.tsx:8`、`tests/panels.test.ts:6/159`、`tests/agents.test.ts:26`、`tests/sidechat.test.ts:17`、`tests/m3b.test.ts:13` —— 与 `03 §7.4` 表**逐行吻合**，证实"简报低估了依赖面"的修正成立。
- **`--sidebar-w` 冲突**：CSS `252px @index.html:17` vs `data-def="264" @1414`，`app.js:588` 写 `prop` ✅ —— F2 成立。
- **`data-archived` 死代码**：`sessionItemHTML(122-166)` 区间 grep `archived` = **0 命中**；`renderArchive(483-497)` 输出 `.arch-row[data-id]`；守卫 `@419/465` —— VIS-06 / F-5 成立。
- **字形覆盖（`02 §B.2`）**：**自己写了极简 TTF cmap 解析器**（`/tmp/yan_cmap.py`，仅 stdlib）解析 `SFNS.ttf` 与 `Apple Symbols.ttf`。**11 格中 10 格吻合**：`SFNS` 有 `✓ ✗ ● ○ × !`、缺 `⊘ ⏸ ⏳ ❚` ✅；`Apple Symbols` 有 `⊘`、缺 `⏸ ⏳ ❚` ✅ → **「⊘ 仅 Apple Symbols、⏸⏳❚ 全缺」的核心结论成立**。唯一不符：`U+26A0 ⚠` 文档记 `SFNS 无`，**实测 SFNS 有**（不影响"用 SVG"的结论）。
- **上一轮规范（`outputs/ui-v3-forge/02-design-system.md`）**：确认其 `--sidebar-w=264 @index.html:14`、`--dur-1/--dur-2/--ease-enter/--ease-standard` 均**真实存在于该文件** → `02 §0.2` 对"上一轮过时/虚构"的 15 条纠错**方向成立**。

### V10. **未能验证的项（如实列出）**

| 项 | 为何没验 |
|---|---|
| 「门禁 26 道中 **9 项未证**」（`00 §8`/`01 §4 F`） | 需在真实环境跑 `TERM=dumb pnpm gates` 并解读 `UNVERIFIED=<n>`；本审查未启动门禁（耗时长且需凭据），**故对"9 项"既不证实也不证伪**。 |
| `panels-check` B 相 7 探针"vanilla 命中全 0" | 需 CDP + 启动 Electron 渲染进程；本审查只静态核对了探针**源码指向**（确为 `[data-m1e-*]`），**未跑运行时命中**。静态层面成立。 |
| 10k 事件 DOM ≤300 / 滚动 ≤200ms | 性能口径属**落地轮**指标，当前无实现可测。 |
| `00 §1` HEAD=`5e8a10b` | 未核 `git rev-parse HEAD`（不影响本轮文档结论）。 |
| `PingFang SC` 字形覆盖 | `PingFang.ttc` 不在 `/System/Library/Fonts/`，未定位到文件，未解析。 |

---

## 3. 缺陷清单（P0 / P1 / P2 / P3）

### P0 — 必须修复（阻断发布）：**0 条**

> 四条红线（伪造 `data-m1e-*` / 重命名钩子 / 声称改 `src/` / 宣称门禁全绿）**全部通过**，详见 §6。故 **P0 = 0**。

### P1 — 建议修复（影响品质，进入落地轮前应修）：**2 条**

**P1-1 🔴 `01` 与 `03` 对 `MAINT-06` 给出相反的验收口径**
- **位置**：`01-requirements.md` §2.1 `MAINT-06` 与 §4 表 B 行 ／ `03-refactor-design.md` §7.4。
- **问题**：`01` 要求「`panels-check.ts` 的 `import` 目标**不再是** `projections.ts`」（把投影函数迁走、让 `projections.ts` 可归档）；`03 §7.4` 结论为「`import` 目标**仍是** `projections.ts`（保留即达标）」。**同一条需求，两份文档要求相反**。
- **证据**：
  - `01`：`"projectDiffCards/projectTokenUsage 迁至独立模块使 projections.ts 可归档"` + `"panels-check.ts 的 import 目标不再是 projections.ts"`。
  - `03 §7.4`：`"panels-check.ts:12/344 的 import 无需改指，projections.ts 保留"` + `"验收：panels-check.ts 的 import 目标仍是 projections.ts（保留即达标）"`。
- **判断**：`03` 的分析更正确（`projections.ts` 是框架无关纯 TS，被 **4 门禁脚本 + 4 测试 + store + cards/panels** 引用——本人 V9 已逐行核实）。但 `03` 只声明"纠正简报框架"，**未同步修订 `01` 的验收口径**，导致需求与设计不一致。
- **修法**：二选一并全团对齐——(a) 采纳 `03`：把 `01 MAINT-06` 验收改为「`panels-check.ts` 的 import 目标**仍是** `projections.ts`；`projections.ts` 提升为共享投影层，vanilla 层复用其投影、删除 `app.js` 内 `tokStr/diffHtml` 重复实现」；或 (b) 采纳 `01`：则 `03 §7.4` 必须改为"投影函数迁独立模块 + 更新 4 处 import"。**推荐 (a)**。

**P1-2 🔴 `A11Y-02` 验收口径不可判定（`grep -c` 语义错）**
- **位置**：`01-requirements.md` §2.4 `A11Y-02`；`02-design-system.md` §G.1、§G.3 断言 A2。
- **问题**：口径写「`grep -c 'aria-'` ≥ 298」。但 `grep -c` 统计的是**匹配行数**，非出现次数。实测 `grep -c 'aria-' index.html app.js` = **241**，而 `grep -o 'aria-' | wc -l` = **298**。→ **按字面口径，当前基线就已"不达标"（241 < 298），该口径永远无法通过**，属"看似可判定实则不可判定"。
- **证据**：本人实测 `241`（行）vs `298`（次）；`role= 30`（行=次，无此问题）；`prefers-reduced-motion 13`（无此问题）。
- **修法**：把 `01 §2.4` 与 `02 §G.1/§G.3` 的 aria 口径统一改为 **`grep -o 'aria-' src/renderer/*.{html,js} | wc -l` ≥ 298**；`role=` 同理建议显式用 `grep -o`。

### P2 — 可选优化（建议修）：**8 条**

**P2-1 `01 RESP-02` 的「三栏均可见」与断点设计矛盾**
- 位置：`01` §2.2 `RESP-02`。问题：验收要求"最小尺寸下**三栏均可见**且主区 ≥320px"，但 `02 §C.1`/`03 §4.3` 定的最小尺寸 **960px**，而 ≤1023 档侧栏已变**覆盖式 Sheet（默认隐藏）**——960 下不可能"三栏均可见"。
- 修法：`RESP-02` 改为"最小尺寸下**主区可用且侧栏/右板可经键盘开合**，无布局碎裂"。

**P2-2 `01 MAINT-01`「每模块 ≤500 行」与 `03` 保留 `projections.ts`（591 行）冲突**
- 位置：`01` §2.1 `MAINT-01` vs `03` §1.4/§9(#6)。修法：为 `projections.ts` 显式豁免（"投影层单文件可 >500，因框架无关且被 11 处引用"）。

**P2-3 `01 MAINT-02` 验收 `grep -c 'function render' = 0` 不可判定/自相矛盾**
- 位置：`01` §2.1 `MAINT-02`。问题：`03` 的目标态**必然**含 `renderCard/renderEvent/renderX` 等函数，"`function render` 命中 = 0"与之冲突，且该模式会误匹配一切 `render*`。修法：改为「不存在**覆写式赋值** `\w+ = (async )?function`（覆写原型函数）= 0」。

**P2-4 `01 PERF-03`「显著下降」无阈值**
- 位置：`01` §2.5 `PERF-03`；`03 §5.6`。修法：给具体阈值（如 `addEventListener` 80 → ≤40）。

**P2-5 `MAINT-05` 覆盖含糊：`03` 仍留 6 项"待判定"**
- 位置：`03 §7.3`（memory/plugins/sidechat）+ `§7.6`（onboarding/hooks/lib）。问题：`01 MAINT-05` 验收要求"`grep 未判定\|TBD\|待定` = 0"，而 `03` 现状含 6 处"待判定"。**`03` 已诚实标注"决策未定，非静默丢弃"**，但严格未达验收。修法：落地轮前收敛为三选一 + 理由，或在 `01` 明确"本轮允许标注决策项、落地轮收敛"。

**P2-6 钩子计数口径四套并存（30 / 32 / 41 / 65）**
- 位置：`00 §5` / `03 §0,§7.7,§12` / `02 §E.1`。修法：全团统一为「**41 个钩子**（65 个 token 形态）」并说明"32"为上一轮旧口径。

**P2-7 `02 §H` 交叉引用错引**
- 位置：`02 §H` 末行「支撑：MAINT-…/§A.7（CSS 分层输入）」。`§A.7` 实为**动效令牌**，非 CSS 分层。修法：改指 `§A.9`（迁移映射总表）。

**P2-8 `02 §B.1`「两处刻意同色不同形」实为三对**
- 位置：`02 §B.1`。`成功(--st-done)` 与 `运行(--st-run)` 亦同为 `--ok`，属第三对同色。修法：改述为"三对（成功/运行、被拒/失败、已中断/等待）"。

### P3 — 锦上添花：**8 条**

1. `02 §0.2#12`：「1748 行是 `finalizePending`」→ 实为 `finalizeAi`（`finalizePending` 在 1751）。
2. `02 §A.2.2`：`--border` dark `1.33` 列标"vs bg"，实为 vs `--surface`（vs `--bg` = 1.43）。
3. `02 §B.2`：`U+26A0 ⚠` 文档记 SFNS"无"，实测 SFNS"有"（结论不变）。
4. `02 §E.1`：`data-empty` 记 2（实为 3）；`data-ask` 引 `app.js:2130`（字面量在 2168）。
5. `evidence F-7`：`innerHTML = 36`（实测 37，与 `00 §6` 一致）。
6. `00 §1`：工作树快照遗漏 15+ 个已修改 `src/` 文件（实测 `git status` 35 项）。
7. `03 §3.5`：称"对齐 React `panels/registry.tsx` 8 类"但实列 7 类。
8. `03 §12`：自检"✅ §7.5 立 BLOCKED"，但 `BLOCKED.md` 无 2026-09-17 条目（`§7.5` 原文是"**应立**"，属建议非已立）。

---

## 4. 需求覆盖矩阵（27 条 × 02 / 03）

> ✅ = 有明确落地方案；◐ = 间接支撑/设计侧输入；✗ = 未覆盖；⚠ = 覆盖含糊。

| # | 需求 | 02 覆盖 | 03 覆盖 | 备注 |
|---|---|---|---|---|
| 1 | MAINT-01 模块边界 | ◐（§A.9 标尺输入） | ✅ §1.1–1.4/§2 | — |
| 2 | MAINT-02 隐式耦合 | ✗ | ✅ §1.3/§2.2 M2·M5 | 02 非其职责范围（合理） |
| 3 | MAINT-03 卡片注册表 | ✅ §D.1–D.3 | ✅ §3 | 11 类 ≥10 ✅ |
| 4 | MAINT-04 全量 innerHTML | ✗ | ✅ §5.5 | — |
| 5 | MAINT-05 React 归档 | ✅ §D.3/§F | ⚠ §7.1–7.3/7.6 | **6 项"待判定"未收敛**（P2-5） |
| 6 | MAINT-06 探针+projections | ✅ §E.2 | ✅ §7.4/§7.5 | **但 01↔03 口径矛盾**（P1-1） |
| 7 | MAINT-07 CSS 分层 | ◐（§A 标尺） | ✅ §1.4/§2.2 M7 | 02 §H 错引 §A.7（P2-7） |
| 8 | RESP-01 四档断点 | ✅ §C.1–C.2 | ✅ §4.1/4.2 | 4 串均给出 ✅ |
| 9 | RESP-02 最小尺寸 | ✅ §C.1 建议 | ✅ §4.3 | 01 口径与断点矛盾（P2-1） |
| 10 | RESP-03 中窄三栏 | ✅ §C.1 | ✅ §4.4 | — |
| 11 | RESP-04 分隔条 | ✅ §C.3 | ✅ §4.4 | — |
| 12 | VIS-01 四态语义色 | ✅ §A.1.2 | ✅ §3.4 | — |
| 13 | VIS-02 状态底栏 | ✅ §A.4/§C.1 | ✅ §8 | — |
| 14 | VIS-03 被拒色 | ✅ §B.1 | ✅ §3.4 | 01 未给 ΔH 阈值（轻微） |
| 15 | VIS-04 已中断/等待 | ✅ §B.1 | ✅ §3.4 | — |
| 16 | VIS-05 图形编码 | ✅ §B.1 | ✅ §3.4 | — |
| 17 | VIS-06 归档死代码 | ✅ §E.1 | ✅ §10 P2 | 死代码属实 ✅ |
| 18 | A11Y-01 自动门禁 | ✅ §G.3 | ✅ §6.4 | — |
| 19 | A11Y-02 资产不回退 | ✅ §G.1 | ✅ §6.3 | **口径不可判定**（P1-2） |
| 20 | A11Y-03 新动效降级 | ✅ §G.2 | ✅ §6.4 | — |
| 21 | PERF-01 长会话 | ✗ | ✅ §5.1 | — |
| 22 | PERF-02 口径恢复 | ✅ §E.2 | ✅ §5.4/5.6 | — |
| 23 | PERF-03 事件绑定 | ✗ | ✅ §5.3 | 「显著下降」无阈值（P2-4） |
| 24 | GAP-01 任务视图 | ✗ | ✅ §8 | — |
| 25 | GAP-02 状态底栏 | ✅ §A.4 | ✅ §8 | — |
| 26 | GAP-03 run 历史 | ✗ | ✅ §8 | 依赖 GAP-04，已降级占位 |
| 27 | GAP-04 IPC 需求单 | ✗ | ✅ §8.1 | 字段差集表 ✅ |

**缺口结论**：**无需求"两份都不覆盖"**。`02` 未覆盖 `MAINT-02/04`、`PERF-01/03`、`GAP-01/03/04`——但这 7 条**均非"设计系统"职责**（属架构/性能/结构），`02` 也**未虚假声称**覆盖它们，属**合理边界**。唯一**覆盖含糊**为 `MAINT-05`（P2-5）。

---

## 5. 反事实检查结论（文档有没有回避难点）

> 结论：**未回避**。三处"最容易糊弄过去"的难点均被正面处理。

1. **迁移策略是否真可行（4147 行单体怎么拆、每步是否真能保持门禁可跑）** —— ✅ **正面回应**。`03 §2.2` 给出 11 步（M0…M10）分步表，每步标注"抽/改什么 + 手法 + **结束判据（门禁+UI）**"；`§2.3` 明确抽取顺序按"状态耦合度从低到高"，并**点名最高风险步 = M2（抽状态层）**、次高 = M5（桥接重写），给出三条降险手法（同名 shim 转发 / 双跑 diff / 开关即回滚）。**不是"分个模块就完了"的空话**。
2. **性能方案是否给了可测指标** —— ✅ **可测**。`03 §5.6` 汇总 6 项指标（10k DOM ≤300、滚动 ≤200ms、首帧 ≤1s、innerHTML ≤12、addEventListener 下降、forced reflow = 0），每项标注**测量方法**（CDP `querySelectorAll` / `performance.now()` / DevTools Layout 计数）。唯 `addEventListener` 项为"显著下降"（P2-4）。
3. **是否有"以后再说"掩盖的未决问题** —— ✅ **诚实披露**。`03 §7.3/§7.6/§12` 明确列出 6 项"待判定"并写明"决策未定，非静默丢弃；落地轮须收敛"。**未把未决问题藏起来**——但**未决本身**仍是 `MAINT-05` 的覆盖含糊（P2-5）。
4. **`GAP-03` 依赖内核字段是否被回避** —— ✅ **未回避**。`03 §8.1` 实测确认 `events/index.ts` 无 `runId/ts`、`SessionInfoPayload` 无批次字段、唯一批次历史仅 `ScheduleSnapshot.history`（scheduled run），据此**降级为结构占位 + 出 IPC 需求单**，并给出字段差集表。**这是"承认做不了"而非"假装能做"**。

---

## 6. 红线核查结果（逐项）

| # | 红线 | 结论 | 证据 |
|---|---|---|---|
| 1 | **严禁伪造 `data-m1e-*` 钩子** | ✅ **通过** | 全仓 `grep -rn 'data-m1e' outputs/frontend-refactor-2026-09-17/` 仅出现在**禁用声明**中（`00 §4`、`02 §E.2/§7.5`、`03 §7.5` 均写"严禁伪造"）；**无任何一处建议新增 `data-m1e-*`**。`03 §7.7` 新增钩子清单亦明列"禁止新增 `data-m1e-*`"。 |
| 2 | **未重命名现有钩子** | ✅ **通过** | `02 §E.1`（41 钩子）与 `03 §7.7`（冻结清单）均声明"零重命名"；`02 §D.1` 对 `.body → .card-body` 采"**保留 `.body` 为别名**"；`03 §7.7` 对 `data-view`/`data-card` 采"**值扩展**"（键不变）。本人未发现任何重命名建议。 |
| 3 | **未声称改动 `src/`** | ✅ **通过** | `02 附` 与 `03 §12` 自检均写"本轮只写本 md"；`01 §3.2` 明确"❌ 不改 `src/`"。本人复核工作树：**本轮新增的 `outputs/frontend-refactor-2026-09-17/` 内只有 6 份 `.md` + `evidence/`**，无任何 `src/` 文件由本轮产出（`git status` 中的 `src/` 改动为**先前已存在**的未提交变更，非本轮文档产出）。 |
| 4 | **未宣称门禁全绿** | ✅ **通过** | `01 §4 F`「不得宣称全绿；未证 ≠ 通过」；`00 §8`「未证 9 项如实标注」；`03 §2.2 M6`「未批准则门禁保持红—不伪造绿」；`03 §7.5`「未获 BLOCKED 批准前，panels-check B 相保持红—不宣称绿」。**无任何"全绿"声称**。 |

> **红线判定：4/4 通过 → P0 = 0。**
> 附注（不构成违规，但影响"自检 ✅"的可信度）：`03 §12` 自检把"立 BLOCKED"打成 ✅，而实际 `BLOCKED.md` 无 2026-09-17 条目（`§7.5` 原文为"应立"）——属**自检表轻度过度声称**，已计入 P3-8 / 克制维度扣分。

---

## 7. 附录：复算脚本（可复现）

### 7.1 `/tmp/yan_contrast.mjs`（对比度独立实现，V1）

```js
// node yan_contrast.mjs —— 与文档 §I、与 evidence/*.py 均无复用
function srgbFromOklab(L, a, b) {
  const l_ = L + 0.3963377774*a + 0.2158037573*b;
  const m_ = L - 0.1055613458*a - 0.0638541728*b;
  const s_ = L - 0.0894841775*a - 1.2914855480*b;
  const l = l_**3, m = m_**3, s = s_**3;
  return [ 4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
          -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
          -0.0041960863*l - 0.7034186147*m + 1.7076147010*s ];
}
const oklchToLinear = (L,C,H) => { const r=H*Math.PI/180; return srgbFromOklab(L, C*Math.cos(r), C*Math.sin(r)); };
const clamp01 = x => Math.min(1, Math.max(0, x));
const relLum = lin => { const [r,g,b] = lin.map(clamp01); return 0.2126*r + 0.7152*g + 0.0722*b; };
const contrast = (c1,c2) => { const y1=relLum(oklchToLinear(...c1)), y2=relLum(oklchToLinear(...c2));
  return (Math.max(y1,y2)+0.05)/(Math.min(y1,y2)+0.05); };
const toHex = (L,C,H) => '#' + oklchToLinear(L,C,H).map(x => { x=clamp01(x);
  const s = x<=0.0031308 ? 12.92*x : 1.055*Math.pow(x,1/2.4)-0.055;
  return Math.round(clamp01(s)*255).toString(16).padStart(2,'0'); }).join('');
// 自检：oklch(1,0,0) 应为 #ffffff / 1.00
console.log(toHex(1,0,0), contrast([1,0,0],[1,0,0]).toFixed(2));
// 关键三项：
const BG_L=[1,0,0], S2_L=[0.987,0.003,250], BG_D=[0.168,0.012,250], SUR_D=[0.208,0.014,250];
console.log('--border-strong L', toHex(0.64,0.008,250), contrast([0.64,0.008,250],BG_L).toFixed(2)); // 期望 3.36（文档写 3.64）
console.log('--border-strong D', toHex(0.56,0.012,250), contrast([0.56,0.012,250],BG_D).toFixed(2)); // 期望 4.13（文档写 3.83）
console.log('--border D',        toHex(0.305,0.016,250), contrast([0.305,0.016,250],BG_D).toFixed(2),
            '/ vs surface', contrast([0.305,0.016,250],SUR_D).toFixed(2));                            // 1.43 / 1.33
console.log('--dim D vs s2', contrast([0.62,0.012,250],[0.244,0.015,250]).toFixed(2));                // 4.47 ✅
```

### 7.2 `/tmp/yan_cmap.py`（TTF cmap 覆盖复核，V9，仅 stdlib）

```python
#!/usr/bin/env python3
import struct, sys
def read_cmap(path):
    d = open(path,'rb').read(); n = struct.unpack('>H', d[4:6])[0]; t={}; o=12
    for _ in range(n):
        tag=d[o:o+4].decode('latin1'); to,tl=struct.unpack('>II',d[o+8:o+16]); t[tag]=(to,tl); o+=16
    co,_=t['cmap']; ns=struct.unpack('>H',d[co+2:co+4])[0]; cps=set()
    for i in range(ns):
        rec=co+4+i*8; pid,eid,sub=struct.unpack('>HHI',d[rec:rec+8]); so=co+sub
        fmt=struct.unpack('>H',d[so:so+2])[0]
        if fmt==4:
            segX2=struct.unpack('>H',d[so+6:so+8])[0]; seg=segX2//2
            ends=struct.unpack('>%dH'%seg,d[so+14:so+14+segX2])
            starts=struct.unpack('>%dH'%seg,d[so+16+segX2:so+16+segX2*2])
            for s,e in zip(starts,ends):
                if s!=0xFFFF: cps.update(range(s,e+1))
        elif fmt==12:
            ng=struct.unpack('>I',d[so+12:so+16])[0]
            for g in range(ng):
                sc,ec,_=struct.unpack('>III',d[so+16+g*12:so+16+g*12+12]); cps.update(range(sc,ec+1))
    return cps
for p in sys.argv[1:]:
    cps=read_cmap(p); print(p, len(cps))
    for cp,ch in {0x2713:'✓',0x2717:'✗',0x25CF:'●',0x25CB:'○',0x2298:'⊘',0x23F8:'⏸',0x23F3:'⏳',0x275A:'❚',0x26A0:'⚠'}.items():
        print(f'  U+{cp:04X} {ch} {"有" if cp in cps else "无"}')
# 运行：python3 yan_cmap.py "/System/Library/Fonts/SFNS.ttf" "/System/Library/Fonts/Apple Symbols.ttf"
```

### 7.3 复现用命令清单

```bash
# 基线
wc -l src/renderer/index.html src/renderer/app.js src/main/index.ts src/main/settings.ts
# 钩子全量枚举（V3）
grep -ohE 'data-[a-z0-9-]+' src/renderer/index.html src/renderer/app.js | sort -u | wc -l
grep -ohE 'dataset\.[a-zA-Z0-9]+' src/renderer/index.html src/renderer/app.js | sort -u | wc -l
# 口径不可判定（V6/P1-2）
grep -c 'aria-' src/renderer/index.html src/renderer/app.js        # 241（行）
grep -o 'aria-' src/renderer/index.html src/renderer/app.js | wc -l # 298（次）
# 死代码（V9）
sed -n '122,166p' src/renderer/app.js | grep -c archived           # 0
# projections 依赖面（V9）
for f in scripts/*.ts src/renderer/store.ts src/renderer/cards/*.tsx tests/*.ts; do grep -l projections "$f"; done
# 复算
node /tmp/yan_contrast.mjs && python3 /tmp/yan_cmap.py "/System/Library/Fonts/SFNS.ttf"
```

---

## 8. 审查官签署

- **结论**：**PASS**（21/25，P0 = 0，P1 = 2）。
- **给主理人的一句话**：这轮文档的**行号精度与证据密度是本项目迄今最高**（~100 处行号仅 1 处小错），四红线全过；**唯一需要在落地轮前处理的实质问题**是 `01↔03` 的 `MAINT-06` 口径矛盾（P1-1）与 `A11Y-02` 的不可判定口径（P1-2）——这两条不改，落地轮会拿错判据验收。
- **审查方式留档**：本报告的每一条"实测"均可由 §7 脚本/命令复现；**V10 列出的 5 项未验证**已如实标注，未以推断冒充实测。
