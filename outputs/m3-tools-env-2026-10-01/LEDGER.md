# M3 台账 · 工具与环境（2026-10-01，qoder 会话）

**一句话**：`diagnose`（结构化诊断）+ `web_search`（配置门控检索）落地，五面接线（含 2 处热文件 / M7 写范围各 1–2 行，同 M2 先例由本会话接齐）；决策「不做浏览器」理由全文在 `PROGRESS-entry.md`；反向验证两条（mainSessionSideEffect 翻反 → G-B 对账必红）；真料读数：**10,567 字节失败输出 → 960 字节结构化（0.091×）**。

## 交付

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/tools/diagnose-parse.ts` | 新 | 结构化解析层（纯函数）：tsc / unix 族 / eslint stylish / vitest 四种形状；**入口剥离 ANSI**（见下）；40 条帽 + total/truncated 分开报 |
| `src/tools/diagnose.ts` | 新 | 工具本体 + `diagnoseSurface`（可诊断面判据）+ `diagnoseSpec`。配置/执行/归因**全部复用** `src/agent/verify.ts`（loadVerifyConfig / ExecFn / classifyVerifyFailure），执行器由 runner 传 `verifyExec(sandbox)` |
| `src/tools/web-search.ts` | 新 | `web_search`：`.agent/config.json` 的 `search.endpoint`（含 `{query}`）门控；SearxNG `format=json` 契约；非 JSON 降级为有界原文并如实标注；**不跟随重定向**；SSRF 判据复用 `web-fetch-policy` |
| `tests/diagnose.test.ts` | 新 | 17 条（含带色真字节样本、封顶、负控、三面对账） |
| `tests/web-search.test.ts` | 新 | 15 条（配置面/传输面/网络类三格对账） |
| `outputs/m3-tools-env-2026-10-01/measure-diagnose.mts` | 新 | 读数探针（读仓内已提交真料，确定性、无墙钟） |

## 接线

| 面 | 文件 | 改动 |
|---|---|---|
| 注入（诊断） | `src/main/agent-runner.ts` | `diagnoseSurface` 条件注入（口径同 lsp 的按配置摘除）+ `pluginTools` 规格 + tools 行 `gatedTool("diagnose", …)`；`GatedName` += diagnose |
| 注入（检索） | `src/main/agent-runner.ts` | `searchConfigured` 条件注入 + `pluginTools` + `gatedTool("web_search", …)`；`GatedName` += web_search |
| 写向表 | `src/permissions/autonomy.ts` | `SIDE_EFFECT_TOOLS` += diagnose（执行进程=写向类）；`isNetworkCommandCall` += web_search（scope 钉 once） |
| 风险表 | `src/permissions/risk.ts` | `staticRisk`：web_search 与 web_fetch 同判 **high**——不给 high 的后果是 auto 档免批放行，撞「出网永不免批」红线 |
| 登记表 | `src/agent/tool-surface.ts` | `INJECTED_TOOLS` += diagnose（readOnly 摘）/ web_search（readOnly 留，与 web_fetch 同判） |
| 文档 | `README.md` | 新增「网络与沙箱边界」一节（默认断网 / 放行链 / 哪些要批 / 两个出网工具 / search 配置示例）；工具表 9→10（补登 M2 的 apply_patch）+ 注入表补两件 |

**注①（热文件与跨模块）**：`agent-runner.ts` 是共享热文件、`autonomy.ts`/`risk.ts` 属 M7 写范围（本笔各改 1–2 行，沿用 M2 已获业主裁决的「模块作者直接接齐」口径）；`README.md` 是 M3 交付物本身要求改的。接完请集成复核。
**注②（对照验收）**：计划书 M3 验收三条——INJECTED_TOOLS 登记（G-B 对账自动查三面）、写向判定与 isSideEffectTool 一致（G-B line 76 + 本笔单测）、只读档摘除面正确（diagnose 摘 / web_search 留，两向都有判卷）。

## 证据（读数指针）

| 证据 | 文件 | 读数 |
|---|---|---|
| 结构化省多少 | `measure-diagnose.log` | 真料（M2 留档的 vitest 六失败块全文）**10,567 字节 → 命中 6 条 / 渲染 960 字节 = 0.091×（≈11×）**；下界口径（回执另有两行固定行未计） |
| 探针自曝（记一笔） | 同上 + `tests/diagnose.test.ts` | 解析器**第一版在真料上命中 0 条**——真实输出带 ANSI（532 个 ESC），修在解析入口；带色样本用真实字节回钉 |
| 反向验证① | `reverse-verify-diagnose-flip.log` | diagnose `mainSessionSideEffect` true→false ⇒ G-B 精确 1 红（`写向判定漂移（表 false vs permissions true）`）exit=1 |
| 反向验证② | `reverse-verify-search-flip.log` | web_search false→true ⇒ 精确 1 红（`表 true vs permissions false`）exit=1 |
| 复原 | `reverse-verify-surface-hash-{before,after}.txt` + `reverse-verify-restored.log` | sha256 `25ec093…` 前后逐字节同；复绿 exit=0 |
| 全量判卷 | `full-suite.log` | `Test Files 267 passed (267)｜Tests 3595 passed (3595)｜exit=0｜173.39s`（较 M2 基线 265/3563 ⇒ 只增不减，+32＝诊断 17＋检索 15） |
| 门 | `gate-tools-check.log` / `gate-prompt-surface.log` / `gate-web-fetch-check.log` | 三道 ✅ exit=0（web-fetch-check 含「WF7-没有能关掉红线的开关 — 放行开关扫描：命中 0」） |
| typecheck | `typecheck.log` | ✅ `tsc --noEmit 通过（0 条报错）` exit=0 |

## 开放项（给集成 owner / 后继模块）

1. **与 M5（Claude）的接缝**：diagnose 只读复用 `verify.ts` 的 `loadVerifyConfig`/`ExecFn`（**未改 verify.ts**）；M5 若重构这两个符号的签名，需同步 `src/tools/diagnose.ts` 与 `tests/diagnose.test.ts`。`diagnose-parse.ts` 是纯函数，M5 的「多面验证收口」若要结构化输出可直接复用，不必再写一个解析器。
2. **web_search 端点契约**：只认 SearxNG `format=json` 形状（`results[].title/url/content|snippet`）；别的 JSON 形状降级为有界原文（不猜）。要不要支持更多形状（如通用 `{items:[…]}`）留裁决。
3. **diagnose 在只读档缺席**（写向类），而 `verify` 作为系统门在只读会话仍可被模型触发——这是本笔分类下的有意结果；若后续要「只读也能跑诊断」，属权限表改动，需单独裁决。
4. **新依赖：0 个**（web_search 零依赖，diagnose 零依赖）。
5. 合并由集成 owner/业主执行；本笔只提交到工作分支，一笔一事。
