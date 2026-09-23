# 项目文档地图（2026-09-22 整理）

> **性质**：导航页，只指路、不改写历史文档。过期内容**标注但不回改**（仓规：改写即伪造历史）。
> **事实源约定**：门数/测试数/行数以 `scripts/gate-manifest.ts`、`tests/`、当日复跑为准；本文数字只作 2026-09-22 快照。
> **配套报告**：`docs/PROJECT-REPORT-2026-09-22.md`（全景 + 优缺点 + 优化 + 发展路径）。

---

## 0. 一页导航（按「你现在想干什么」）

| 你想… | 去哪 |
|---|---|
| 知道怎么跑门禁 / 环境有什么坑 | 根目录 `AGENTS.md` |
| 读懂产品定位与全部定稿方案 | `agent-plan.md`（只读权威） |
| 看项目全景、优缺点、路线 | `docs/PROJECT-REPORT-2026-09-22.md` |
| 查某能力验收到哪一步 | `docs/m{2,3,4,5}-acceptance.md` |
| 查当前 UI 事实与复跑命令 | `docs/ui-fact-baseline.md` |
| 查代码结构地图 | `docs/CODE-WIKI.md`（⚠️ 渲染层章节已过时，见文内 banner） |
| 查为什么这么设计 / 当时踩了什么坑 | `PROGRESS.md`（过程史）、`BLOCKED.md`（裁决史） |
| 查竞品差距与战略优先级 | `outputs/best-agent-roadmap-2026-09-18.md`、`outputs/agent-landscape-gap-analysis-2026-09-18.md` |
| 查上一轮全面评审 | `outputs/project-review-2026-09-21.md` |
| 查架构对照六仓的真缺口 | `outputs/architecture-uplift-2026-09-21.md` |
| 查「每请求固定成本 / 工具面膨胀」的调研与已落地能力 | `outputs/model-surface-budget-2026-09-23/`（四册：调研综述 / 装配账读数 / 设计与判据 / 施工回执）|
| 查「缓存前缀抖动 / 为什么不能拿命中率当判据」 | `outputs/prefix-churn-2026-09-23/`（实测发现 + 设计与判据 + 施工回执；门 `prefix-churn-check`）|
| 查「压缩一次值多少缓存钱 / 摊销策略」 | `outputs/compaction-amortization-2026-09-23/`（主张与依据 + 施工回执；判据 PC7 与 `cc-*` 针脚）|
| 查「长时程装配读数（第 N 轮作废多少前缀）/ 靶场只能跑一轮怎么办」 | `outputs/long-horizon-probe-2026-09-23/`（为什么缺这张表 + 实测与回执；CLI `pnpm gym-long`）|
| 查「重跑为什么不一样 / wall-clock 漏进身份字段」 | `outputs/reproducibility-2026-09-23/`（主张与判据 + 实测与回执；门 `replay-determinism-check`，登记债在 `IDENTITY_DEBTS`）|
| 查「裁剪为什么每轮都作废前缀 / 攒够再剪」 | `outputs/prune-batching-2026-09-23/`（主张与判据 + 施工回执；判据 PC8 与 `pb-*` 针脚）|
| 查「已经断过一次头，为什么还要再断第二次」 | `outputs/prune-free-ride-2026-09-23/`（免费车：压缩那轮顺手剪；判据 PC9 的集合相等 + 对照臂，针脚 `pb-free-ride-*`）|
| 查「权限第四档 guided 是怎么来的 / 为什么 edit_file 还出卡」 | `outputs/permission-guided-mode-2026-09-23.md`（`MODE_POLICY` 逐型裁决表 + 三臂复跑读数；锚点 `guided-*`/`tier-order-*`）|
| 查安全绕过复现与修法 | `outputs/shell-permission-bypass-2026-09-21.md` + `scripts/probe-shell-bypass.ts` |
| 查判断层校准路线 | `docs/judgment-layer-calibration-proposal.md` |
| 看验收截图（**历史 UI**） | `docs/*.png`（vanilla 迁移前，勿当现状） |

---

## 1. 分层结构

```text
deepseek harness/
├── AGENTS.md                 # 工程纪律 + 环境坑 + 当前状态（活文档，短）
├── agent-plan.md             # 唯一权威方案（大，只读）
├── agent-plan.bak-0908.md    # 方案备份（存档）
├── PROGRESS.md               # 过程史（大，按里程碑连载）
├── BLOCKED.md                # 备案/待裁决/裁决记录（大）
├── overview*.md              # 历史概览快照（文内自带过期声明）
├── docs/
│   ├── README.md             # docs 索引（截图效力说明）
│   ├── DOCS-MAP.md           # 本文件
│   ├── PROJECT-REPORT-2026-09-22.md
│   ├── CODE-WIKI.md          # 代码地图（部分过时）
│   ├── ui-fact-baseline.md   # UI 事实基线（可复跑）
│   ├── judgment-layer-calibration-proposal.md
│   ├── solpi-port-proposal.md
│   ├── m{2,3,4,5}-acceptance.md / m{2,3,4}-audit.md
│   ├── facts/                # pnpm facts 机器可读事实
│   ├── superpowers/          # goal/plan 模式与编排设计稿
│   └── *.png                 # 里程碑截图（历史 UI）
├── outputs/                  # 调研/评审/设计/读数产出（dated，按主题归档）
├── scripts/                  # 门禁与工具脚本（清单 = gate-manifest.ts）
├── tests/                    # 测试（196 文件，2026-09-22 快照）
├── fixtures/                 # 判卷靶子 / mock 剧本 / gym 靶场
└── src/                      # 源码（~34k 行，2026-09-22 快照）
```

---

## 2. 权威与效力（防假指针）

| 文档 | 效力 | 过期时怎么办 |
|---|---|---|
| `scripts/gate-manifest.ts` + `tests/` | **数字与门禁的唯一事实源** | 任何文档写死门数/测试数一律视为快照 |
| `agent-plan.md` | 意图/方案权威 | 只读，不改；变更走 BLOCKED 裁决后追加 |
| `AGENTS.md` | 工程现状权威（短） | 追注须量字节（D-1 豁免水位有限） |
| `docs/ui-fact-baseline.md` | UI 可判定量权威 | 每条自带复跑命令 |
| `docs/m*-acceptance.md` | 里程碑三态证据 | 未证 ≠ 通过 |
| `outputs/*` dated 页 | 当日快照调研 | **不回改**；引用前看文内「失效条件」 |
| `docs/*.png` | 历史验收证据 | 不能判断当前 UI |
| `overview*.md` / `CODE-WIKI.md` 部分节 | 历史 | 顶部/节内有过期 banner 的以 banner 为准 |

**已知假指针教训**：`overview.md` 曾把「当前权威」指到已漂移的 frontend-refactor 数字层；现已降为存档。新增指针时写「失效条件」挂在**可判读事实**上，**禁止挂 SHA**。

---

## 3. outputs/ 主题索引（2026-09-22）

### 3.1 总评 / 战略
- `project-review-2026-09-21.md` — 全面评审（优缺点/路线/优化）
- `best-agent-roadmap-2026-09-18.md` — harness-only 超越 Codex/CC
- `agent-landscape-gap-analysis-2026-09-18.md` — 能力面差距 A1–A9
- `architecture-uplift-2026-09-21.md` — 六仓对照真缺口 + 执行面契约
- `harness-deep-analysis-2026-09-21/` — 六仓深挖原始册
- `model-surface-budget-2026-09-23/` — 模型面总预算（工具面膨胀）：外部读数 + 降配梯 + `model-surface-check` 门
- `prefix-churn-2026-09-23/` — 前缀抖动：真实录制的 cache 读数 + 排序纪律进 `prefix-churn-check` 门
- `long-horizon-probe-2026-09-23/` — 长时程回放（不动判卷区的放大重放）+ 两尺度实测
- `reproducibility-2026-09-23/` — 可复现性：同一输入两次跑逐字段等值；把 #56 从个案抽成纪律（含被门撑大的范围）
- `prune-batching-2026-09-23/` — 分批裁剪：少断几次可缓存前缀（实测 5→2 次 / 作废 -39%）
- `prune-free-ride-2026-09-23/` — 免费车：压缩已打断前缀的那一轮顺手剪（PC9 判集合相等 + 对照臂证旋钮接得上）
- `design-contradictions-2026-09-18.md` — 渲染侧矛盾台账
- `zcode-study-2026-09-21.md` · `laya-evaluation-2026-09-21.md` · `aseos-vision-evaluation-2026-09-21.md`
- `brain-cognition-mapping-evaluation-2026-09-23.md` — 外部「人脑功能 → Agent」13 条映射：11 条已是现状、
  1 条缺承载面（`AgentEvent` 无「执行前预期」成员）、1 条与自家实测反向（风险层真流量区分度 1/99，
  默认档 91 次出卡全在 `L3-mode`）。**含一处腐判**：judgment-layer 附录 A 的可粘贴命令在 HEAD 已 TypeError
- `gap-fix-proposal-2026-09-23.md` — 上页实测差距的**修复提案**（七项 P0-1…G7，每项带判卷读数/成本/反转条件与
  原子簇切法）；两条本轮自校：`turn_truncated` 真语料 0 次 ⇒ P0-2 从"白拿"降级；13/30 类事件在可比语料无观测者

### 3.2 安全 / 权限
- `shell-permission-bypass-2026-09-21.md` — deny 包装绕过复现与修法
- （探针）`scripts/probe-shell-bypass.ts`

### 3.3 性能 / 成本
- `analysis-perf-2026-09-15.md` · `perf-optimization-exploration-2026-09-14.md`
- `optimization-log-2026-09-1{2,5}.md`
- `compaction-factor-measure-2026-09-19.md` · `economic-compaction-readout-2026-09-20.md`
- `w3-price-tag-readout-2026-09-20.md` · `anthropic-thinking-cost-2026-09-21.md` · `effort-param-surface-2026-09-21.md`
- `auto-verify-readout-2026-09-20.md` · `native-capability-2026-09-19.md`

### 3.4 UI / 渲染
- `renderer-refactor-proposal-2026-09-19.md` — 渲染层结构诊断与提案
- `frontend-refactor-2026-09-17/` — vanilla 迁移规范包（数字层已降存档）
- `learn-from-v0.1.6-2026-09-20.md` — 五条设计语言
- `desktop-ui-research-2026-09-18.md` · `ui-design-*` · `desktop-design-*` / `desktop-redesign-*` / `desktop-optimize-*` / `ui-critique` / `ui-disclosure` 等
- ⚠️ 带 `_superseded/` 的子目录 = 已废弃方案

### 3.5 代码审查 / 修复日志
- `code-review-report-2026-09-1{2,3,5}.md` · `code-review-optimization-plan-2026-09-14.md`
- `fix-log-2026-09-12.md` · `fix-brief-2026-09-14.md` · `mimosa-triage-2026-09-13.md`
- `head-door-table-2026-09-20.md` · `promote-output-scan-2026-09-21.md` · `stop-reason-blindspot-2026-09-21.md`
- `m7-closure-constraints-2026-09-18.md`

### 3.6 编排 / 评测语料
- `orchestration-prompt-review-2026-09-12.md` · `solpi-*-2026-09-17.md` · `repair-and-solpi-plan.md`
- `loop-eval-*` · `ga-strategy-2026-09-20*` · `gym-real-after-fix.json` · `t6-run-state-spec-2026-09-19.md`

---

## 4. 文档卫生约定（本仓已踩过的坑）

1. **不回改 dated 页**——过期就追加「更正/失效」，不改原文。
2. **禁止挂 SHA 作失效条件**——squash/rebase 后永不触发；挂可判读事实（断言名/文件/复跑命令）。
3. **门数/测试数/行数不写死**进长期文档；必须写就标「YYYY-MM-DD 快照」。
4. **判据有缺陷 → 写 `BLOCKED.md` 要求换判据**，不改代码绕过。
5. **门禁判据写在 JS 侧**；命令行排查用 `grep -E` + `-w`，**永远不信 shell grep 的 0 命中**。
6. **同族能力一个入口**——两头断（有模块/事件/消费端、无写路径）在本仓发生过多次，新能力必须双向核验。
7. 提交前对已跟踪文件做**相交检查**（`git status --short <file>`），避免吞并他人在飞原子单元。

---

## 5. 2026-09-22 整理动作（本次做了什么 / 没做什么）

**做了**：
- 新增 `DOCS-MAP.md`（本导航）与 `PROJECT-REPORT-2026-09-22.md`（综合报告）。
- `docs/README.md` 顶部补两个指针，并校正安全债状态（探针全绿）。

**没做**（有意）：
- 不改写 `PROGRESS.md` / `BLOCKED.md` / `agent-plan.md` / 历史 dated 页。
- 不删除 `outputs/` 任何调研产物、不重拍截图、不合并分支。
- 不在文档写死门数/测试数为「当前真值」——只作带日期快照。

**建议后续（勿与在飞任务重叠）**：
- 巨型文档切片须先合并 `doc-layer-migration` 分支的既有任务，再补 `agent-plan.md` 等未覆盖面。
- `CODE-WIKI.md` 渲染层章节可另立「重写或降档」任务，不在本轮动刀。
