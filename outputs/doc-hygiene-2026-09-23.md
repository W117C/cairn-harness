# 文档清洁工轮 · 工作区文档盘点与清场就绪（2026-09-23）

> **性质**：只读盘点 + 已落地的索引补全 + **待确认的清场清单**。本轮**未删除、未迁址、未提交任何东西**。
> **事实源**：条目数以 `ls` 为准、引用数以 `grep -oE | sort -u` 为准；本文数字只作 2026-09-23 快照。
> **配套**：索引补全落在 `docs/DOCS-MAP.md` §3（全量枚举）/ §2.1（死指针登记）/ §6（本轮记录）。
> **纪律**：删除属破坏性收尾，**确认前一个都没删**（哪怕任务书写了「删除重复及冗余内容」）。

---

## 0. 事实面状态

| 事实面 | 状态 | 依据 |
|---|---|---|
| 代码 | `out-of-scope` | 纯文档工程；`src/` `scripts/` `tests/` 零改动（复跑：`git status --short src scripts tests`） |
| 运行态 | `not-applicable` | 未起服务、未跑门禁；只跑只读 `ls` / `find` / `shasum` / `git` |
| 文档 | `changed-and-verified` | `docs/DOCS-MAP.md` §3 补全至 121 项全量枚举 + §2.1 死指针登记 5 条 + §6 本轮记录 |
| 规则 | `verified-current` | `AGENTS.md` **零改动**（它在别人的在飞改动集里，见 §4） |
| 记忆 | `out-of-scope` | 本轮不写记忆；`.workbuddy*/` `.pi/` `.qoder/` `.mimosa/` 属**他平台**状态，只报体量 |
| 工作区 | `pending` | 残留/重复/废弃/误置已逐项清点（§5）；**清场待你确认** |

---

## 1. 影响（用户视角）

1. **查找成本**：`outputs/` 121 项里有 **50 项此前在索引里根本找不到**（旧索引用 `ui-design-*`、
   `code-review-report-2026-09-1{2,3,5}.md` 这类 glob/brace 简写，机械核对不过）⇒ 现在逐项可查。
2. **两处真重复**已定位到 sha256（不是「看起来像」，是逐字节相同）⇒ 各删一份零破断。
3. **3 处死指针**读起来像现态但指向不存在/已被清空的东西——其中 2 处在**只读**的 `agent-plan.md` 里，
   我不能就地改，已登记进 `DOCS-MAP` §2.1 走裁决。
4. **一条高价值警报**：别人的在飞 PNG 删除集正在拆**活着的文档所引用的证据**（详见 §3.6）。
   那个原子单元一旦按现状落地，`docs/README.md` 与 `ui-v3-forge/export/README.md` 会留下 3 处假指针。

---

## 2. 量测读数（每条可复跑）

**体量**

```sh
du -sh outputs .tmp .worktrees .mimosa .qoder .workbuddy-ai .workbuddy tmp .pi oh-src
ls outputs | grep -v '^\.DS_Store$' | wc -l        # 121 → 本轮新增 2 项 → 交稿前复跑 123
```

| 目录 | 体量 | 说明 |
|---|---|---|
| `outputs/` | 33M | 123 项调研/评审/设计/读数（本轮盘点对象；**本轮内 121→123，见 §3.7**） |
| `.worktrees/` | 75M | 3 个**已注册** git worktree，各挂未合并分支（§5-T6） |
| `.mimosa/` | 24M | Mimosa 扫描历史（他平台） |
| `.tmp/` | 16M | 102 项门禁日志/探针/整仓快照副本（§5-T1） |
| `.qoder/` | 4.3M | Qoder 状态（他平台） |
| `.workbuddy-ai/` + `.workbuddy/` | 276K | WorkBuddy 记忆 + 任务书（他平台） |
| `tmp/` | 124K | 根级调试残留，**未被 gitignore**（§5-T1 的高风险项） |
| `docs/` | — | 16 个 md + `superpowers/` 6 件 + `facts/`（gitignored）+ 2 张 png |

**顶层四大文档**

| 文件 | 字节 | 角色 | 处置 |
|---|---|---|---|
| `PROGRESS.md` | 254,761 | 过程史 | 不动（不回改） |
| `agent-plan.md` | 227,167 | 唯一权威方案 | 不动（只读） |
| `agent-plan.bak-0908.md` | 193,642 | v1 回滚点 | **保留**（见 §5-T7） |
| `BLOCKED.md` | 114,611 | 备案/裁决史 | 不动（不回改） |

**`outputs/` 路径引用数**（决定「能不能搬」的硬指标）

```sh
grep -oE 'outputs/[A-Za-z0-9._/-]+' <file> | sort -u | wc -l
grep -rhoE 'outputs/[A-Za-z0-9._/-]+' src scripts tests | sort -u
```

| 出处 | refs / unique | 可否就地改 |
|---|---|---|
| `outputs/` 内部互引 | **109** unique | ❌ dated 页「不回改」 |
| 门禁/脚本/测试（`src` `scripts` `tests`） | **22** distinct | ✅ 但必须**同提交**改，否则门禁红 |
| `PROGRESS.md` | 13 / **11** | ❌ 历史正文不回改 |
| `docs/DOCS-MAP.md` | 13 / 13 | ✅（本轮已改） |
| `docs/README.md` | 10 / 9 | ✅ |
| `AGENTS.md` | 3 / **3** | ❌ **在飞改动集内**（§4） |
| `BLOCKED.md` | 6 / **6** | ❌ 历史正文不回改 |
| `agent-plan.md` | 4 / **2** | ❌ **只读**，改它要走 §3.7 最小 diff 流程 |
| `docs/CODE-WIKI.md` + `PROJECT-REPORT-2026-09-22.md` | 1 + 3 | ✅ |

⇒ **约 158 处引用，其中 22 处落在不可改正文**（`agent-plan.md` + `AGENTS.md` + `PROGRESS.md` + `BLOCKED.md`）。

---

## 3. 发现分类

### 3.1 索引漏项（50 项，已修）
旧 `DOCS-MAP` §3 用 glob/brace 简写，机械核对不过。复跑（glob 感知，把简写展开再比）：

```sh
node -e 'const fs=require("fs");const m=fs.readFileSync("docs/DOCS-MAP.md","utf8");
const sh=[/^code-review-report-2026-09-1[235]\.md$/,/^optimization-log-2026-09-1[25]\.md$/,/^ui-design-/,
/^desktop-design-/,/^desktop-redesign-/,/^desktop-optimize-/,/^ui-critique/,/^ui-disclosure/,
/^solpi-.*-2026-09-17\.md$/,/^loop-eval-/,/^ga-strategy-2026-09-20/];
const e=fs.readdirSync("outputs").filter(n=>n!==".DS_Store");
console.log("ORPHAN:",e.filter(n=>!m.includes(n)&&!sh.some(r=>r.test(n))).length);'
```

改前实测 **ORPHAN: 50**（含 `claude-subagent-research.md` —— 那是 `agent-plan.md` §4.4 的证据源，居然没人索引）。
补全后两次复跑（都留着，不合并成一句）：
- 第一次：`outputs entries: 123, ORPHAN: 1` —— 那 1 项是**并发会话刚建的** `truncation-account-2026-09-23/`（见 §3.7）；
- 把它补进 `DOCS-MAP` §3.3 并标【在飞】后：`outputs entries: 123, ORPHAN: 0`。

⇒ 本轮断言是 **50 → 0**；中间那个 **1** 是并发写盘的证据，不是遗漏。

### 3.2 真重复（2 对，sha256 相同）

```sh
find . -type f -name '*.md' -not -path './node_modules/*' -not -path './.git/*' \
  -not -path './fixtures/todo-app/node_modules/*' -exec shasum -a 256 {} \; | sort | uniq -w64 -D
```

| # | 文件 A | 文件 B | sha256（前 8） | 建议 |
|---|---|---|---|---|
| 1 | `outputs/ui-polish-2026-09-19.md` | `outputs/ui-polish-2026-09-19/变更清单.md` | `4c06aa3b` | 删 **A**（B 与 7 张截图同行；A 全仓 0 引用） |
| 2 | `outputs/ui-refine-2026-09-19/设计学习报告.md` | `outputs/learn-from-v0.1.6-2026-09-20.md` | `3486af25` | 删 **B**（A 全仓 0 引用；B 被 `DOCS-MAP` + `project-review-2026-09-21.md` ×2 引用） |

两对的**破断面都是 0**（被删那份全仓零入站引用）。

> 注：`outputs/ui-optimize-2026-09-19.md` 与 `outputs/ui-optimize-2026-09-19/` 是**同名文件/目录**，但**不是重复**
> （`.md`=方案文本，目录=`index.html` + 15 张截图）。只算命名混淆，不进删除清单。

### 3.3 死指针（3 条，已登记 `DOCS-MAP` §2.1）
- `agent-plan.md` 声明的 `agent-plan.bak-0908-v2.md` / `-v3.md` —— **两个文件从未落盘**（根目录只有 v1 那份）。
- `outputs/ui-v3-forge/export/README.md` 逐张列出的 14 张 `shots/` —— **目录已被在飞删除集清空（0/14）**。

### 3.4 会话/门禁残留（16M + 124K，见 §5-T1）
### 3.5 误置物（6 处非文档物混在 `outputs/`，见 §5-T5）
### 3.6 ⚠️ 在飞删除集正在拆活证据（本轮最重要的一条）

工作树里有一批**别人未提交的 PNG 删除**（`git status` 中 46 行 ` D`）。它拆掉的不只是「历史存档」，
还有**活着的文档正在指向的证据**：

| 被拆的证据 | 谁在指它 | 实况 |
|---|---|---|
| `outputs/ui-v3-forge/export/shots/`（14 张） | 同目录 `export/README.md`「产物清单」逐张列表 | **0/14 残留**，产物表三项缺一 |
| `docs/*.png`（25 张） | `docs/README.md` §一「25 张验收截图」、§二「重生成 m1e-*」 | 23 张已删，落盘只剩 `m0c-ui-dark.png` / `m0c-ui-light.png` |
| `outputs/frontend-refactor-2026-09-17/evidence/shots/` | `docs/README.md` §二「最新证据截图」 | 6 张在，3 张已删 |

**我没有去改那两份 README**：删除还没进 HEAD（可能被撤回），现在改等于把未定的事写死。
已登记进 `DOCS-MAP` §2.1，等那个原子单元落地后**据实收窄**。

### 3.7 本轮实测到「有并发会话正在写这个工作区」（不是推测，是两次读数之差）

| 读数 | 开工时 | 交稿前 | 差 |
|---|---|---|---|
| `ls outputs \| grep -v '^\.DS_Store$' \| wc -l` | 121 | **123** | +`doc-hygiene-2026-09-23.md`（我）+`truncation-account-2026-09-23/`（别人） |
| 在飞改动集（`git status --short` 非删图项） | `AGENTS.md` / `package.json` / `scripts/gate-check.ts` / `scripts/gate-manifest.ts` / `src/agent/gym/score.ts` / `src/frozen.ts` | 同上 **+ `src/renderer/app.js` + `src/renderer/projections.ts`** | +2 个源码文件被并行编辑 |

**推论（影响你怎么做后续）**：
1. 本文所有计数**都只作本轮快照**，复跑命令在 §2 —— 这不是客套，是本轮就地失真了一次。
2. **绝不要 `git add -A` / `git add outputs`**：会把别人正在写的半成品（`truncation-account-2026-09-23/` 只有一个探针脚本，正文还没落）
   和别人改到一半的 `app.js`/`projections.ts` 一起吞进一个提交。
3. §5 的删除清单**每项都用精确路径**、不用通配符 —— 万一执行时别人又新建了同名类目录，不会被误伤。
4. `truncation-account-2026-09-23/measure-truncation.mts` 是又一个误置脚本（同 §5-T5 类），但**在飞，本轮不动**，落地后并入 T5。

---

## 4. 边界：本轮什么不能碰

| 对象 | 为什么 |
|---|---|
| `AGENTS.md` / `package.json` / `scripts/gate-check.ts` / `scripts/gate-manifest.ts` / `src/agent/gym/score.ts` / `src/frozen.ts` | **别人的在飞改动集**（`M`）。AGENTS.md 规矩：只追加不改写，或先备份 diff 再重建 ⇒ 本轮干脆零接触 |
| 46 张已删 PNG | 同上，是**别人的原子单元**，不代为收尾、不撤回 |
| `fixtures/**`（含 `fixtures/todo-app/tests/**`、`fixtures/mock/**`） | **冻结判卷文件**（sha256 在 `scripts/frozen-sha256.json`），改它等于作弊 |
| `agent-plan.md` | 只读权威；改它要走 `outputs/desktop-design-2026-09-22/总册.md` §3.7 最小 diff 流程 |
| `PROGRESS.md` / `BLOCKED.md` / `outputs/*` dated 页 | 「不回改历史」（改写即伪造历史） |
| `.workbuddy*/` `.pi/` `.qoder/` `.mimosa/` | 他平台的自有状态与记忆；未知控制面默认只读 |
| `.worktrees/` 3 个 worktree | 各挂未合并分支（§5-T6），属破坏性清场，必须单独确认 |

---

## 5. 清场候选清单（**待你确认；确认前一个都没删**）

### T1 · 会话/门禁残留 — 建议全清（16M + 124K）
| 目标 | 量 | 理由 |
|---|---|---|
| `.tmp/` 整目录 | 16M / 102 项 | 全部 gitignored；含 2026-09-14 整仓快照副本 `audit-0914-_aq2zg6d/`（14M，git 历史已有该时刻）、`ui-diag-2026-09-18/`（1.4M）、约 60 份 `*-check.log` / `base-*.log` / `baseline-*20260912*`、一次性探针 `diag-click.cjs` / `m2g-shot.ts` / `p3.ts` / `impact-perf-probe2.ts`、`*.pid` / `e2e-log.jsonl` 等运行垃圾 |
| `.DS_Store` ×2 | 8K | macOS 自动生成，无信息量，Finder 会再生成 |

⚠️ **`tmp/`（根目录，124K）本轮建议不动**：它没被 gitignore，且含**今天 12:21–13:08 写的** `dbg-fr2.mts` /
`dbg-freeride.mts` / `dbg-pb.mts` / `dbg-prune.ts` —— 很可能是**在飞会话的调试脚本**。另有
`README.md.inflight-backup-2026-09-21`（明确的备份件）。等在飞分支落地后再清。

### T2 · 真重复 — 建议删 2 件（破断面 0）
| 目标 | sha256 前 8 | 理由 |
|---|---|---|
| `outputs/ui-polish-2026-09-19.md` | `4c06aa3b` | ≡ `ui-polish-2026-09-19/变更清单.md`；全仓 0 入站引用 |
| `outputs/ui-refine-2026-09-19/设计学习报告.md` | `3486af25` | ≡ `learn-from-v0.1.6-2026-09-20.md`（活指针那份留着）；0 入站引用 |

### T3 · 已自我废弃 `_superseded/`（11 件）— **默认建议保留**，可选删 10 件
| 目标 | 件数 |
|---|---|
| `outputs/desktop-design-3col-2026-09-21/_superseded/` | 5（01 契约增补 / 02 骨架与四块 / 03 欠账与安全口径 / 04 设置页 / README） |
| `outputs/desktop-redesign-v2-2026-09-21/_superseded/` | 4（01 需求冻结 / 02 设计方案 / 03 后端欠账与落地代价 / README） |
| `outputs/desktop-redesign-2026-09-21/_superseded/` | 1（方案.md） |
| `outputs/ui-redesign-2026-09-19/_superseded/` | 1（`为什么废弃.md`） |

⚠️ 这批是**有意留的决策史**（`为什么废弃.md` 讲清了为什么否掉）。若你要极限精简：删前三组 10 件，
**留 `ui-redesign-2026-09-19/_superseded/为什么废弃.md`**。

### T4 · 草稿被终稿取代 — 建议删 1 组
| 目标 | 理由 |
|---|---|
| `outputs/ui-disclosure-2026-09-20/`（草稿，14 图） | 被 `ui-disclosure-final-2026-09-20/`（终稿，13 图）取代；代码侧 0 引用 |

（`ga-strategy-2026-09-20{,-rep2,-rep3}/` 与 `loop-eval-*` 四臂**不是**草稿/终稿关系，是**对照臂**，保留。）

### T5 · 误置物 — 是迁址不是删除（6 处）
| 目标 | 应去处 | 备注 |
|---|---|---|
| `outputs/ui-preview/`（3 文件） | `proto/` | 原型代码（`index.html`+`styles.css`+`app.js`） |
| `outputs/ui-v3-forge/export/forge-ui-v3.html`（193K） | 原型类 | 存档交付包里的原型 HTML |
| `outputs/measure-prefix-word-candidates-2026-09-22.mts` | `scripts/` | 量测脚本 |
| `outputs/native-capability-probe-2026-09-19.js` | `scripts/` | 探针脚本 |
| `outputs/gym-real-after-fix.json` | `fixtures/` 或 `docs/facts/` | 靶场数据 |
| `outputs/prefix-churn-2026-09-23/probe-prune-recipe.mts` | `scripts/` | ⚠️ **门禁脚本按路径引用**，迁址必须同提交改脚本 |

### T6 · 工作树/分支（破坏性清场）— **本轮明确建议不动**
| 目标 | 量 | 理由 |
|---|---|---|
| `.worktrees/doc-layer` | — | 分支 `doc-layer-migration`（`da60f0d`）**未合并**；`DOCS-MAP` §5 已登记「巨型文档切片须先合并它」= 待办前置 |
| `.worktrees/goal-plan` | — | 分支 `feat/goal-plan-mode`（`1d6093d`）未合并 |
| `.worktrees/r1b` | — | 分支 `codex/r1b-renderer-subtraction`（`0bae71c`）未合并 |

（三者合计 75M。要清必须先逐个核合并状态再 `git worktree remove` + 删分支；**不能 `rm -rf` 了事**，会留悬空 worktree 元数据。）
仓外另有 7 个 detached HEAD worktree（`/private/tmp/dsh-anchor-3f|776`、`dsh-head-real`、`dsh-neg`、`dsh-real`、
`wt-replay`、`~/Downloads/dsh-gates-f81`）＝ 探针/回放工作台，**在本工作区之外**，out-of-scope。

### T7 · 备份冗余 — **建议保留，不删**
`agent-plan.bak-0908.md`（193K）虽与 git 历史冗余，但 `agent-plan.md` 第 49 行把它声明为「v1 原始快照（回滚点）」，
而 `agent-plan.md` 是**只读**——删了就当场造出一条新死指针。

---

## 6. 「按主题归类 + 目录结构」的两个方案

### 方案 A（**本轮已做**）：逻辑归类 + 全量索引，物理路径不动
`outputs/` 保持平铺（路径是被 ~158 处引用的**证据锚点**），由 `docs/DOCS-MAP.md` §3.1–§3.9 承担主题归类与查找。
**破断面 0、可逆、已完成** —— 这也是 §4 规矩 9 的直接结论。

### 方案 B（物理归类）：8 个主题子目录，**需协调，建议排在在飞分支合并之后**
```text
outputs/
├── _strategy/      # §3.1  14 项   ├── _security/   # §3.4   6 项
├── _cost/          # §3.2  20 项   ├── _impact/     # §3.5   4 项
├── _grading/       # §3.3  24 项   ├── _review/     # §3.7   8 项
├── _ui/            # §3.6  28 项   └── _orchestration/ # §3.8 13 项
```
**四条阻塞条件**（任一未解就不该搬）：
1. `AGENTS.md` 在飞改动集未落地（3 处引用）—— 现在改会把别人的原子单元卷进来；
2. `agent-plan.md` 的 2 处引用要走它 §3.7 最小 diff 流程（agent 出 diff → 你 Review → 批准 → 落盘）；
3. `PROGRESS.md`（11 处）/`BLOCKED.md`（6 处）属「不回改」历史正文 ⇒ 只能**追加**「路径已迁移」更正注记，
   旧路径必然残留 17 处 ⇒ 须在 `DOCS-MAP` 加「旧路径 → 新路径」对照表兜住；
4. 门禁脚本 22 处引用必须**同提交**改完（否则门禁红）。

⇒ 排期建议：等 `codex/dsh-structural-hardening` 合并后，作为**一个原子提交**做完（`git mv` + 引用修 ~158 处 + 对照表）。

---

## 7. 遗留 / pending

- **`pending`**：§3.6 那 3 处「活文档 → 已被拆的证据」假指针，等别人的 PNG 删除集落地后据实收窄（已登记 `DOCS-MAP` §2.1）。
- **`pending`**：`agent-plan.md` 的 v2/v3 备份死指针，须走 §3.7 最小 diff 流程或 `BLOCKED.md` 备案裁决（我不能就地改）。
- **`pending`**：`tmp/`（根）含在飞会话调试脚本，留到在飞分支落地后再清。
- **`out-of-scope`**：`.mimosa/`（24M）/ `.qoder/`（4.3M）/ `.workbuddy*/`（276K）/ `.pi/` 他平台状态；仓外 7 个 worktree。
- **未消除 warning**：**有并发会话正在写本工作区**（§3.7 实测）。本轮改动（`docs/DOCS-MAP.md` + 本文）**未提交**，
  与别人在飞集合并列在工作树 ⇒ **别用 `git add -A` / `git add outputs`**，逐文件 `git add` 才安全。
- **未证 ≠ 通过**：本轮只跑只读盘点，**没跑任何门禁**（也没必要）；本文所有数字均为 2026-09-23 快照，
  且本轮已实测到一次失真（121→123），复跑命令在 §2。

---

## 8. 一句话汇总（等你点头）

**已做完且可逆**：索引从「71/121 被索引」补到**全量枚举**（复跑 `ORPHAN: 50 → 0`，123 项全量覆盖）
+ 死指针登记 5 条 + 卫生规矩 8–10 + 本轮记录。**零删除、零迁址、零提交。**
**等你确认才动手**：删 T1（16M 残留）+ T2（2 件重复）+ T4（1 组草稿）共 **3 类**；
T3（`_superseded/` 11 件）默认保留、你要求极限精简才删 10 件；T5 是迁址（6 处）；T6（3 个 worktree）建议不动。
回复「执行 T1 T2 T4」即可，我按 §5 的**精确路径**逐项删并补报清场结果（不用通配符，避免误伤并发会话的新文件）。
