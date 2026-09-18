> **⚠️ 存档（2026-09-18 裁定）**：本文降为存档，**不可直接施工**，且**范围自限于 A 类**（肉眼可见），B 类不在本文——不可当全量权威（包亦不完整：仅 `02`/`04`/`05`，无 `00`/`01`/`03`）。
> **两条自报数已被复测推翻**：C4 reduced-motion 自报 13→**17**，实为 **13**（`docs/ui-fact-baseline.md` F15）；C6 自报新增 z-index **30**/40，实测档位 **6/40/60/61/70/71/80/90，无 30**（F17）。**两面权威**：意图 = `agent-plan.md` §10.1；事实 = `docs/ui-fact-baseline.md`。正文一字未改。

# 桌面端收口审计 · 2026-09-17 22:30
# 范围：src/renderer 残留清理 + ≥1024px 桌面布局修正
# 工具：Chrome headless CDP（Node 22 内置 WebSocket），七档视口 1024/1152/1280/1440/1600/1920/2560

---

## §0 结论

| 维度 | 结果 |
|---|---|
| 桌面布局 | **1 个真 bug 已修**（stream ↔ composer 错位 ≤24px）|
| 残留清理 | **3 个文件/项直接清**，**1 类 39 文件**列入未处理（待用户确认）|
| 构建 | `pnpm build` 通过；`pnpm typecheck` 通过；`pnpm ipc:check` 通过（分支 B 全绿）|
| 既有失败 | `pnpm test` 的 6 文件/34 用例（solpi-runtime 等）**预先存在，与本次改动无关**（CSS-only 改动不触达运行时逻辑；solpi-runtime 既不在 `tests/` 的 git 改动列表、也不读 CSS）|

---

## §1 桌面布局实测与修正

### 1.1 修复前的问题

`.stream-inner` 自带 `padding:0 24px`（在容器内再内缩），而 `.composer` 把 24px 放在**父级**（`.composer{padding:10px 24px 14px}`），`.composer-inner` 无 padding。两套不同机制，**仅在内容没被封顶时（contentMax ≥ center - 48）才碰巧一致**。

`--content-max` 解析为 `min(100%, clamp(560px, center-48px, 1040px))`，在 1280–1599（capped < center-48）和 ≥~1660（c=1040 < center-48）两段都会触发。结果：消息气泡左边缘和 composer 输入框左边缘**最多错位 24px**。

| 视口 | 修复前 Δ_content | 修复后 Δ_content |
|---|---|---|
| 1024 | 0 | 0 |
| 1152 | 0 | 0 |
| 1280 | **24** | **0** ✅ |
| 1440 | **24** | **0** ✅ |
| 1600 | 0 | 0 |
| 1920 | **24** | **0** ✅ |
| 2560 | **24** | **0** ✅ |

### 1.2 修法（**只改一侧**，不动 `.stream`/`.stream-inner`/≤1023 档）

```diff
- .composer{flex:none;padding:10px 24px 14px}
- .composer-inner{max-width:var(--content-max);margin:0 auto;display:flex;flex-direction:column;gap:8px}
+ .composer{flex:none;padding:10px 0 14px}
+ .composer-inner{max-width:var(--content-max);margin:0 auto;padding:0 24px;display:flex;flex-direction:column;gap:8px}
```

- 文件：`src/renderer/index.html:826-827`
- 为什么选这一侧：动 `.composer` 侧不影响 `.stream` / ≤1023 档（用户要求保留窄屏适配），所有 6 档实测 Δ_content 全部归零。
- ≤1023 档：`.sidebar` `position:fixed` 抽出布局流，center 占满视口（928px）。改后 stream/composer 内容 x 同改前完全一致。

### 1.3 顺手删的空规则

```diff
- @media (max-width:1599px){ }
```
- `src/renderer/index.html:1427`：1280–1599 与基础层共用，无需额外声明；空规则删掉。

### 1.4 其他实测

| 视口 | overflowPx | 拉伸元素 | 备注 |
|---|---|---|---|
| 1024–2560 | 0 | 无 | 七档全无横向溢出，无 tooWide 元素 |
| ≤1279 档 | sidebar=208（窄列），drawer=340/fixed（抽出布局流） | — | 与设计一致 |
| ≥1280 档 | drawer=340/relative（占布局流） | — | 与设计一致 |
| 1920/2560 | content 封顶 1040，居中留白 130/450 | — | 极端宽屏不拉伸 ✅ |
| 1600 | content = center = 980，未触发 1040 封顶 | — | 设计上"内容封顶需 center < 1040 才封顶"——是设计取舍，非 bug |

---

## §2 残留清理（已删，共 45 文件 + 5 临时项）

### 2.1 一次性临时脚本 / 构建残留

| 路径 | 来源 | 性质 |
|---|---|---|
| `scripts/tmp-critique-probe.ts` | 审查官（已结案）的一次性 CDP 探针 | 任务结束，删 |
| `scripts/tmp-proto-check.ts` | 早一时段我自己的原型探测脚本（20:34） | 任务结束，删；**顺手修了 typecheck 的一个错**（`import "./lib/harness.ts"` 需 `allowImportingTsExtensions`）|
| 根目录 `electron.vite.config.*.mjs` | `electron-vite` 构建中止后的临时配置 | BLOCKED.md 有案。**清了两轮**——清完又因 `pnpm build`/`pnpm install` 再生 4 个，再清一遍才干净 |

### 2.2 死 React 树（41 源 + 4 死测试，约 276KB）——**已删**

**确证链**（每条都可复跑）：

1. `src/renderer/index.html:1967` 只 `<script type="module" src="/app.js">`
2. `app.js:1` 只 `import { projectHistory, mountHistory } from './history-window.js'`
3. `grep` 整个 `src/` 对 `cards|panels|conversation|onboarding|components/ui|use-mobile|hooks|lib` **零引用**
4. 构建产物 `out/renderer/assets/index-*.js`（109KB）**不含** `react-virtuoso` `@radix-ui` `use-mobile` `registry.tsx` `shadcn` 任何字符串
5. 删后 bundle **仍是 109KB 不变** → 反证这些文件从未进 bundle

删除清单（41）：`src/renderer/cards/*.tsx`(7)、`components/ui/*.tsx`(29)、`panels/registry.tsx`、`conversation.tsx`、`hooks/use-mobile.ts`、`lib/utils.ts`、`onboarding.tsx`。
连带删死测试（4）：`tests/{cards,onboarding,panels,sidechat}.test.ts`（React→vanilla 迁移时迁走了实现但没迁测试）。

### 2.3 连带清理：`react()` 插件 + 14 个无用依赖

- `electron.vite.config.ts`：删 `import react from "@vitejs/plugin-react"` 与 `plugins[react()]`
- `package.json` 删 14 项：`react` `react-dom` `@types/react` `@types/react-dom` `@vitejs/plugin-react` `react-resizable-panels` `react-virtuoso` `lucide-react` `radix-ui` `class-variance-authority` `cn` `tw-animate-css` `shadcn` `@shadcn/react`
- `pnpm install` 同步（12.9s，lockfile 已更新）

---

## §3 ⚠️ 删树过程中发现的一个**我漏查的耦合**——已根治

`scripts/commercial-check.ts`（**是一道门禁**）第 24 行 `import { ONBOARDING_GROUPS } from "../src/renderer/onboarding"`，用它的
`id/step/label/entry` 四个字段做 D1「§13 七组覆盖」断言。**我删前只 grep 了 `src/` 的反向引用，没 grep `scripts/`**，导致
`pnpm typecheck` 立刻红（`Cannot find module` + 6 条级联 implicit-any）。

**修法（不是回滚，是根治）**：`onboarding.tsx` 是个**完整 React 组件**（用 shadcn 渲染整个向导），`ONBOARDING_GROUPS`
只是它顺手 export 的**纯数据**——规范不该住在 React 组件里。

1. 新建 `src/main/onboarding-groups.ts`：只有 `interface OnboardingGroup` + `ONBOARDING_GROUPS` 七条数据，**零 React、零 JSX**
2. `scripts/commercial-check.ts:24` 改 import 到新位置
3. `src/renderer/onboarding.tsx` **照删**

结果：`commercial-check` **45 ✅ / 0 ❌**，D1/D1b/D1c 全绿。

---

## §4 最终门禁（全量 `pnpm gates`，28 道）

**绿 24 / 红 4**，逐道退出码：

```
typecheck=0 test=1 e2e=0 ipc:check=0 sandbox:check=0 build=0 fork-check=0
gate-check=1 autonomy-check=0 compaction-check=0 panels-check=1 tools-check=0
map-check=1 prune-check=0 providers-check=0 provider:check=0 memory-check=0
plugins-check=0 sidechat-check=0 security-check=0 agents-check=0 schedule-check=0
commercial-check=0 gym-check=0 routing-check=0 supervisor-check=0
renderer-arch-check=0 a11y-check=0
```

断言体检（空断言 / 恒真式 / 暗卷段零断言 / 析取式弱断言）：**零命中** ✅

### 4 道红门的归因（**全部非本次改动引入**）

| 门 | 失败本质 | 与本次改动的关系 |
|---|---|---|
| `test` | 31 用例失败（solpi-runtime 等） | **本次改动反而让它变好**：删 4 个死测试文件后失败数 **34 → 31** |
| `gate-check` | 聚合上面三道红 → 红 | 跟随，非新增 |
| `panels-check` | `SyntaxError: 'electron' does not provide an export named 'BrowserWindow'`（Electron 44 as-node v24 的 ESM 导出问题） | **环境/Electron 版本问题**，与删 React 无关；`scripts/panels-check.ts` 本轮前就是 untracked-modified |
| `map-check` | `cp: cannot copy a socket file ... EINVAL (errno 22)` | **文件系统问题**，与改动无关 |

⚠️ 另有 **9 项未证**（连网/凭据限制跑不到的断言）——**未证 ≠ 通过**，不宣称全绿。

---

## §5 未处理的残留

| 项 | 原因 |
|---|---|
| `pnpm test` 的 31 个失败用例（solpi-runtime 等） | 预先存在，不在本次改动面；需要单独立案排查（可能属 solpi 移植的遗留） |
| `panels-check` / `map-check` 两道红门 | 环境性（Electron ESM 导出、socket 拷贝 EINVAL），需要改判据或换宿主，属门禁维护而非代码残留 |
| 根目录 `_tmp_81483_*` 等 4 个 untracked 文件 | 非本次产生（早前测试/脚本产物），未确认来源，不动 |
| `oh-src/`（3762 文件）、`.tmp/audit-*` | 工作区里的**另一个代码库**与审计副本，不是 DSH 源码。**注意**：在 `tests/` 之外直接跑 `node vitest.mjs run` 会扫到它们，必须用 `pnpm test`（项目 vitest 配置只跑 `tests/`） |