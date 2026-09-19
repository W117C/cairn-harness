rev: 1d6bbc4

## 在飞原子簇

- **本分支 `doc-layer-migration`**：文档分层迁移（spec
  `docs/superpowers/specs/2026-09-19-doc-layer-budget-design.md`）。合并回主树前，主树仍是
  旧分层（无 `archive/`、`STATE.md`），所以**这个 worktree 未合并期间不要在主树里搬同一批文件**。
- 主树此刻常有别的会话在写（`src/agent/*`、`src/main/*`、渲染层拆分等），并且会跑
  `mutate-verify`（见 `src/**/*.mutbak`）。动任何已跟踪文件前先 `git diff HEAD -- <file>`。
- 已落库的大簇：orchestrator / agent-runner 按职责拆轻、渲染层模块化、档位与价格表联网实测校准、
  靶场切轮与长时程 case、`docs-check` 门与 `pnpm facts` 账本。

## 开放裁决

- **裁决 3（请求改判据）**：靶场 case 实测全是单次请求 ⇒ 缓存命中、压缩触发、per-turn 回注、
  跨轮检索这些**只在多轮生效**的机制在靶场内一次都触发不到；基线 `successRate` 已到天花板，
  harness 改动在这里只能证明"不掉分"，不能证明"买到分"。`fixtures/gym/cases/**` + `index.json`
  在冻结判卷区内所以不动它，等裁两方案：① 新增一条足够多轮的冻结 case；② 只给探针加长链重放、
  不碰判卷文件。全文 `archive/progress.md`「新开 BLOCKED 裁决 3（请求改判据）」。
- **`settings.promptCache` 产品默认值已翻成开**（provider/API 层缺省仍是关，被变异锚点钉住）：
  这改变的是"Anthropic worker 默认带 cache 断点"，属产品决策，已上报，不擅自改回。
  全文 `archive/progress.md`「并发记账（不是我改的）」。
- **编排提示词缺口**（生产主会话没有系统提示词，验收暗卷脚本反而更完整）：待裁决立项，
  方案在 orchestration-prompt-review 记录里。

## 下一步

- 迁移收口：本分支合回主树，需要独占工作树 + `pnpm gates` 全量复验（`test` 门与 Electron/CDP 三门
  在 worktree 里不可信，见 `AGENTS.md` 并发纪律）。
- `docs-check` 还缺 D-6（文档指针与标签存在性）：它的判据最不机械（要认「」标签而不是 URL 锚点），
  必须先量命中面再定判据与水位。**命中面已量到**：存档与判卷页（`docs/m*-audit|acceptance|proposal`、
  `CODE-WIKI`、`agent-plan.md`、根目录 dated 报告）里仍有一批按旧路径写的 `PROGRESS.md` / `BLOCKED.md`
  引用——按本仓纪律那些**只读不改**，所以 D-6 的适用面应当只管 L0/L1 与 docs 现行页，
  存档面走白名单；活代码里那处注释指针（`tests/updater.test.ts`）已改指 `archive/progress.md`。
- **渲染层留位**：上下文芯片的 `WORKSPACES`（工作区切换器）与权限面板的 `BRANCHES`（分支列表）仍是
  演示数据，真化需连 IPC。
- 权威方案 `agent-plan.md`（仓里最大的一份文档）仍未分层：候选做法是生成分节索引，
  让会话按节 fetch 而不是整读。

## 未证面

- 联网/凭据受限项（远程 MCP、provider 真连、各 check 的暗卷段）逐门的"未证 n"由 `pnpm facts` 给出。
  **未证 ≠ 通过**；严格模式 `DSH_STRICT_UNVERIFIED=1` 或 `pnpm gates --strict-unverified` 让未证判红。
