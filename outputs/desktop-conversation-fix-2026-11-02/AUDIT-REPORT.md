# 视觉取证报告：署名条浮层 × 交付卡（同屏其他主面顺带审计）

- 仓库：`/Users/ze/Downloads/Cairn/cairn`，分支 `fix/spec-summary-double-count`；工作树未提交改动：我到场时 196 项，取证结束时 200 项（增长来自队友的在写文件，不是本次取证）
- 只读核对：`git diff --name-only -- apps/desktop/src apps/desktop/tests apps/desktop/scripts src tests scripts` 里与本批相关的只有 lead 改的三处（`apps/desktop/src/renderer/styles.css`、`apps/desktop/tests/conversation-rail.test.ts`、`apps/desktop/tests/design-minimal.test.tsx`）；`apps/desktop/dist/` 与 `.tmp/` 都在 `.gitignore`（`apps/desktop/.gitignore:1`）内，我重跑构建与落盘都不进 git
- 取证时间：2026-11-02 23:26–23:35（Asia/Shanghai）
- 只读纪律：未 reset / stash / commit；未改任何产品源码（`apps/desktop/src/**`、`src/**`、`tests/**`、`scripts/**` 一字未动，只读）；产物只落 `.tmp/audit-design/`
- 每条结论都带实测数字 + 文件:行号

---

## 0. 口径与工具（先看这一段，复跑用）

| 项 | 值 |
|---|---|
| 真 renderer | `apps/desktop/dist/index.html`（真 renderer + 真 CSS + 真 React，假 AgentApi） |
| 假 AgentApi | 仓里既有 `apps/desktop/scripts/ui-gallery-preload.cjs`（我复制成 `.tmp/audit-design/audit-preload.cjs`，**只**追加一个夹具开关，不动其它行） |
| 截图 | Electron `capturePage()`（不走 `screencapture`，不碰 TCC 录屏权限） |
| 视口 | 1440×900，`devicePixelRatio = 2`，light 主题 |
| hover 态 | `win.webContents.sendInputEvent({type:"mouseMove"})` 真把指针移进助手行，让 `:hover` 真的生效——**合成 class 点不亮 `.row-actions`**（第一版就错在这里，见 §5 方法学） |
| 构建 1（我到场时的 dist） | `dist/index.html` mtime `Nov 2 12:05:43`，4285 B，sha256 `cef2462e…` |
| 构建 2（修复前） | mtime `Nov 2 23:26:39`，sha256 `72c7e92d…`，CSS `assets/index-CwAcbGWl.css` |
| 构建 3（含 lead 的修复） | mtime `Nov 2 23:30:41`，sha256 `caf8c8d2…`，CSS `assets/index-Bnmeq0Gx.css` |

构建命令与已知噪音：`cd apps/desktop && pnpm --filter cairn-desktop build`。vite 段成功写出全部资产；**链尾 `tsc -p tsconfig.json --noEmit` 以退出码 2 结束**，报 `apps/desktop/src/renderer/components/settings-sections.tsx(662,18): error TS2322`（工作树既有错误，不是本批引入，也不阻止资产落盘）。本报告所有读数都基于「资产已写出」这一点，不依赖 tsc 结果。

**夹具必须说明白**（lead 指出的第一件事）：

| 夹具 | 轮尾结构 | `prevSiblingOfCard` | 浮层压到谁 | overlap 实测 |
|---|---|---|---|---|
| 仓里默认（`ui-gallery-preload.cjs` 原样） | 助手行 → **工具簇** → 交付卡 | `toolcluster` | 工具簇 | **6px**（ADR 认可的那种） |
| `--cairn-audit-tail-fixture`（.tmp 副本新增） | 助手行 → **交付卡** | `row assistant` | 交付卡 | **22px**（业主那一屏） |

两者都实测在案：默认夹具见 [`geometry.json`](.tmp/audit-design/geometry.json)（`bandNext.overlap = 6`），尾部夹具见 [`geometry-tail.json`](.tmp/audit-design/geometry-tail.json) / [`card-overlap.json`](.tmp/audit-design/card-overlap.json)。**业主那一屏必须用尾部夹具**——这一点在 §1 用三个数钉住。

---

## 1. 缺陷 F1（主）：署名条浮层整排图标骑在交付卡表头里

### 现象

悬停助手行（或键盘聚焦该行）时，署名条现身：6 枚 30×30 操作按钮（复制/置顶/撤回/分叉/赞/踩）压在**紧接其后的交付卡表头上沿**，横跨卡头左半段（x 526.5…718.5），图标读起来像卡片自己的工具条。默认（未悬停）态下按钮被 `opacity:0 + pointer-events:none` 关掉，所以这一屏只在悬停那一瞬可见——这正是业主截到的那一帧。

### 实测数字（同夹具、同视口、同滚动位置；指针均已在行内点亮 hover）

| 量 | before（卡片顶距 8px） | after（工作树：卡片顶距 24px） |
|---|---|---|
| `a` 交付卡顶边 y（`.changes-card` rect.top） | **622.09** | **622.09** |
| `b` 署名条盒 `.assistant-footer` top → bottom | **614.09 → 644.09**（h = 30） | **598.09 → 628.09**（h = 30） |
| `c` 操作按钮字形（首个 `.row-action svg`）top → bottom | **623.09 → 635.09** | **607.09 → 619.09** |
| `c` 全部 6 枚字形是否都落在卡顶之上 | **false**（6/6 字形底边在卡内，最深 +13px） | **true**（全部在卡顶之上，最浅 −3px） |
| 字形底边相对卡顶 | **+13px（在卡片里）** | **−3px（在卡片上）** |
| `overlap = footer.bottom − card.top` | **22px** | **6px** |
| 卡头顶边那条带（`head.top+2…+21`）`elementFromPoint` 命中 | 6 个采样点全部 `row-actions` | dy=2 → `row-actions`；dy≥6 → 卡片自己的 `展开改动详情` / `cf-t` |
| 卡顶下 0–10px 带（卡自身内容之上）深色像素（截图 2× 计数） | **1148**（只能是浮层笔画） | **0** |
| `.changes-card` computed `margin-top` | 8px | 24px |
| 层级 | footer `z-index: 1`（computed `1`），card `auto` | 同左（**未变**） |

- before 的 8px 档是**运行时注入**得到的（`webContents.insertCSS(".changes-card { margin-top: 8px !important; }")`），不动源码；移除注入即 after。反向再注入一次复现 22px（`beforeAgain` 读数与 `before` 逐项相同），证明差值来自这一条声明，不是量测顺序或滚动位置。
- 22 → 6 的同时，卡片顶边 y 都是 622.09：流被“贴底吸住”，多出来的 16px 由上方内容上移吸收，所以两态的卡顶位置相同——像素差在**浮层与卡顶的相对距离**上，也正是肉眼看到的那一条。
- 图表实测：`.tmp/audit-design/before-card-03-zoom.png`（图标压在卡头里）vs `.tmp/audit-design/after-card-03-zoom.png`（图标整排在卡上）。整屏见 `before-card-01/02-*` 与 `after-card-01/02-*`。

### 根因（四级链条，逐条 file:line）

1. **浮层与卡不是父子，而是前后块**：`apps/desktop/src/renderer/components/Stream.tsx:594` 的 `<span className="assistant-footer">` 是 `.row.assistant` 的子元素；交付卡由 `apps/desktop/src/renderer/panes/WorkbenchView.tsx:693` 渲染在 `<Stream>` **之后**、`.reading`（`WorkbenchView.tsx:664`）之内；`.changes-card` 根节点在 `apps/desktop/src/renderer/components/ChangeSummaryCard.tsx:80`。实测 `cardParent = "reading"`、`prevSiblingOfCard = "row assistant"`、`.reading` 最后一块 = `changes-card`。
2. **浮层从行的下边缘往下铺整盒高**：`apps/desktop/src/renderer/components/stream-process.css:12-24`，`position: absolute; top: 100%; left: var(--rail-gutter); right: 0`（第 18 行）、`margin: 0 0 0 -6px`（第 23 行）、`z-index: 1`（第 24 行）。盒高 = 内层操作按钮高度 = 30px（实测）。
3. **盒高 30 覆盖了 token 的 22**：`stream-process.css:7-11` 的 `.row .row-action { width: 30px; height: 30px }`（第 8/9 行，**已入库**，不是本批临时态）压过 `apps/desktop/src/renderer/tokens.css:320-321` 的 `--w-row-action: 28px / --h-row-action: 22px`；后者才是 `apps/desktop/src/renderer/styles.css:679-685` 里业主裁「做宽一点」之后的口径（28×22，字形不动）。实测按钮 30×30，字形 12×12。
4. **下一块只留 8px 档**：`apps/desktop/src/renderer/styles.css:1700-1705` 的 `.changes-card`，顶距原为 `var(--space-sm)`（8px）。⇒ `30 − 8 = 22`。而轮内档是 `--turn-gap = 24px`（`tokens.css:444`），工具簇那条路是 `30 − 24 = 6`。

### 最小修法建议

- **R1（lead 已落地，实测有效）**：卡片顶距 8px → `var(--turn-gap)`（`styles.css:1703`）。实测 overlap 22 → 6、字形 +13px → −3px、卡顶下 0–10px 带深色像素 1148 → 0。
- **R2（治残余 6px 死带，二选一，不要都做）**
  - **R2a 让浮层盒高回到 token**：`stream-process.css:8-9` 的 `30px` 改 `var(--w-row-action) / var(--h-row-action)`（22px）⇒ 盒高 22 ≤ 档 24，overlap 与死带**同时归零**，且与 `styles.css:679-685` 的 28×22 口径自洽。代价：操作靶面 30 → 22，需要业主确认「做宽」那一裁是否覆盖到 22/28。
  - **R2b 保留 30px 靶面，把「卡前那一档」定义成浮层的真实高度**：新增一枚令牌（如 `--byline-strip: calc(2rem * var(--size-scale))`）供 `.changes-card` 顶距读取（≥ 30px）⇒ 死带归零、靶面不动。代价：卡与上一段的档从 24 变 30，破了 ADR 0008 §2「每一档都是 24」，需要在 ADR 里改口径（R2a 不动该口径）。
- **R3（独立于 R2，治「隐藏态吃指针」）**：`stream-process.css:12-24` 这条规则里**没有** `pointer-events` 声明，实测 computed = `auto`；被关掉的只是内层 `.row-actions`（`styles.css:677/678`）。于是浮层那条 672×30 的透明盒始终参与命中：在卡头 `head.top+5` 派发一次真实 `click`，实测 `target = assistant-footer`、`aria-expanded false → false`（**点卡头顶边打不开卡片**）。最小修法：给浮层盒本体 `pointer-events: none`，只在 `.row.assistant:hover > .assistant-footer` 恢复，且把恢复作用域限定到 `.row-actions` / `.meta`。注意：这一条只能减少「误点/吃点击」，**治不了** hover 链——浮层是行的后代，指针落在浮层上时行的 `:hover` 仍成立（实测 `rowHovered = 1` 且指针已停在卡片顶边带内），所以视觉重叠必须靠 R1/R2 的几何来消。
- ADR 现状：`docs/adr/0008-conversation-rail.md:44-51`（裁决 3）写的是「浮动、默认不可见、隐藏态必须不吃指针」；实测三件事里第一件成立、第二件是分层成立（`.meta` 与 `.row-actions`，但盒本体始终可见地“存在”）、第三件只在按钮层成立。

### 证据文件

`.tmp/audit-design/card-overlap.json`（原始读数，含 before / after / beforeAgain / afterOnBand 四态与每枚按钮+字形的 rect）、`card-overlap.cjs`（探针源码）、`before-card-01/02/03-*.png`、`after-card-01/02/03/04-*.png`、`geometry-tail.json`、`geometry.json`、`tail-06/07-realhover-*.png`。

---

## 2. 同屏其他主面（只报能量出来的；无缺陷的写清读数，方便日后回归对比）

| 主面 | 实测 | 判定 |
|---|---|---|
| **会话流 · 左轨对齐** | `reading.left = 454.5` + `padding-left: 41px` + `--rail-gutter` 28 = **523.5**；实测正文 `md-body` 523.5、交付卡 523.5、过程折叠行 `.process-fold` 523.5（隐藏的 toolcluster 副本 rect 为 0，已按可见性过滤——不过滤会读出 0 这个假数） | 成立，无缺陷 |
| **会话流 · 右缘** | 助手行 / 正文 / 交付卡 right 均为 **1189.5** | 成立，无缺陷 |
| **会话流 · 署名条左缘** | 浮层盒 517.5（因 `margin-left:-6px`），首枚按钮字形左缘 **526.5**——既不对齐轨道 523.5，也不对齐其它锚点 | 观察项，未判为缺陷（无用户可见后果） |
| **会话流 · 顶/底渐隐** | 滚到底：`fade-top data-on=true`、`fade-bottom=false`；滚到顶：反向。渐隐带高 28px（底带 716–744），卡底 687.9 ⇒ 距 **28.1px**，不压卡片内容 | 成立，无缺陷 |
| **输入区** | `.composer-card` 内 7 个可见控件：中心 + 30%/70% 四点命中测试 **0 遮挡**；控件两两矩形重叠 **0**；textarea 724×36（2 行 × 21px 行高），发送钮 32×32 在其右侧下方，不相交；卡片圆角 12px | 成立，无缺陷 |
| **侧栏** | 根 `aside.side`（48–303.5 × 38–862）9 个可见可交互控件 **0 遮挡**；会话行 242.5×52.1 无横向溢出；标题 `ellipsis` 且未截断（scrollW 194 = clientW 194） | 成立，无缺陷 |
| **设置页** | `.sp-page` 30 个可见元素**无一越界**（容器 0–1440 × 38–862）；27 个可交互控件 **0 遮挡**；文档无横向溢出；3 枚开关圆点全部在 track 内（overflowRight −14 / −2 / −2） | 成立，无缺陷 |

设置页截图：`.tmp/audit-design/before-05-settings.png`（修复前 dist）、`.tmp/audit-design/before-sidebar.png`（侧栏）。输入区截图：`before-04-composer.png`。

---

## 3. 「写进哪个 `apps/desktop/tests/*.ts` 能造红」的判据建议

先说清**现有判据 ⑨ 的实测分辨力边界**（`apps/desktop/tests/conversation-rail.test.ts:195-206`，lead 本批新增）：

| 候选判据 | 当前 CSS 面 | 「别处再压一次顶距」 | 「浮层改回行内」 | 「档改 16px」 | 「操作条改 36px」 |
|---|---|---|---|---|---|
| ⑨（现有：`ruleOf(styles, ".changes-card {")` 含 `margin: var(--turn-gap) …` + `barH − turn-gap ≤ 6`） | 绿 | **绿（空过）** | 绿（空过） | 红（30−16=14 > 6） | 红（36−24=12 > 6） |
| J1（建议新增 ⑩） | 绿 | **红** | 绿 | — | — |
| J2（建议并进 ⑨） | 绿 | 绿 | **红** | — | — |

分辨力自检脚本：`node .tmp/audit-design/judge-probe.mjs`（只在内存里改 CSS 文本，不写仓库），原文摘要：

```
当前面:            J1 true   J2 true   J3 true   (barH 30, gap 24, probe 6)
别处覆盖顶距后:     J1 false  J3 true            ← ⑨ 同款算术在这条路上不翻红
浮层改回行内后:     J2 false
J3 能打倒的另两条路: 档改 16px → false；操作条改 36px → false
```

**为什么 ⑨ 会在「别处覆盖」这条路上空过**：它用 `ruleOf(styles, ".changes-card {")` 读**第一条**匹配。我在真 renderer 里用 `insertCSS(".changes-card{margin-top:8px!important}")` 把 overlap 从 6 打回 22 的同一 DOM、同一视口下，`.changes-card {` 这段源码一字未改 ⇒ 判据仍绿。这正是 AGENTS.md「接受口径是真 renderer 的 `getComputedStyle` 读数，不是看着对的 CSS 文本」要防的那类空过。

三条建议（按性价比排序）：

1. **J3 · 证据文件判卷（最值钱，本仓既有范式）** — 落 `apps/desktop/tests/card-overlap.test.ts`，形态照抄 `apps/desktop/tests/ime-guard.test.ts:117` / `apps/desktop/tests/overlay-mutex.test.ts:76`（`existsSync(evidence)` 缺席就 skip，**skip 不算通过**）；探针落 `apps/desktop/scripts/card-overlap-probe.cjs`，原型就是本报告的 `.tmp/audit-design/card-overlap.cjs`（真 renderer + 假 AgentApi + `capturePage`，写 `outputs/card-overlap/checks.json`）。断言（全部实测有值）：
   ```ts
   expect(m.fixture.prevSiblingOfCard).toBe("row assistant");   // 防夹具漂移后判卷空过
   expect(m.allGlyphsAboveCardTop).toBe(true);
   expect(m.overlapFooterBottomMinusCardTop).toBeLessThanOrEqual(6);
   expect(m.glyphToCardTopGap).toBeGreaterThan(0);              // 字形必须整排在卡上
   ```
   这是唯一能在**不改口径**的前提下对「22px 复现」变红的形状：把注入那条声明（或 R2b 的令牌）拿掉，四个数里至少三个立刻红。
2. **J1 · 新增 ⑩（便宜的补漏，加进 `conversation-rail.test.ts`）** — 沿用本文件既有的 `readCssFace()`（已排 vendor、去注释）：断言 `.changes-card` 的顶距**只有一处来源**且无 `!important`。造红方式：在任意 CSS 文件里再加一条 `.changes-card { margin-top: 8px !important }`（或在 `@media` 里覆盖）⇒ 立刻红，而现有 ⑨ 保持绿。
3. **J2 · 并进 ⑨（钉住它空算术的两个前提）** — `ruleOf(processCss, ".row.assistant > .assistant-footer {")` 必须仍含 `top: 100%`（浮层还在行下边缘之外；改成 `bottom: 0` 实测 ⇒ 红），并且 `.changes-card` 仍是 `.reading` 的直接子元素（DOM 形状只能在探针里钉，见 J3 的 `fixture` 断言）。⑨ 现有的 `barH − tokenPx("turn-gap") ≤ 6` 保留——它确实能打倒「档变窄 / 条变高」两条路（实测 16px 档与 36px 条都红），只是不覆盖 R1 被覆盖的情形。

现有判卷实跑读数：`cd apps/desktop && npx vitest run --config vitest.config.ts --maxWorkers=1 tests/conversation-rail.test.ts tests/design-minimal.test.tsx` → **2 files / 21 tests passed**（23:33，maxWorkers=1；`design-minimal.test.tsx:117-123` 的形状适配已随产品口径更新，见该文件 `⑥` 条注释）。未跑 `mutate-verify` / `head-cert`：它们量的是 HEAD，本批改动未提交。

---

## 4. 方法学提醒（下一轮别再踩）

1. **通用「遮挡扫描」抓不到 F1**：我按「每个可见交互控件的中心 + 30%/70% 内差点做 `elementFromPoint`，命中不是自己/后代即缺陷」扫了首页 / 会话流 / 侧栏 / 设置 / 输入区。第一版把会话流里 **11 枚隐藏操作按钮**全报成「被遮挡」（命中的是底下的 `.reading`）——那是 `styles.css:677` 的 `pointer-events: none` 在正常工作，是纪律不是缺陷；把 `pointer-events: none`（自身或祖先）的控件计为 inert 排除后，**各面 0 条**。F1 只存在于「悬停已点亮」那一态，必须专门测卡头那条带（本报告 §1 的做法）。
2. **合成 class 冒充不了 `:hover`**：`.row-actions` 的可见性挂在 `.row:hover`（`styles.css:675-678`）上，加个 `.audit-hover` class 只能点亮 `.meta`；要真 hover 必须发输入事件。
3. **量隐藏副本会读出 0**：`.toolcluster` / `.row.think` 在折叠态有 `rect = 0` 的死副本，`document.querySelector` 取到的是它 ⇒ 左轨读数会假成 0。按可见性过滤后再量。
4. **`getComputedStyle` 返回活对象**：临时改属性再读会拿到改后的值；所有读数必须在还原之前落成字符串/数字（照 `apps/desktop/scripts/layout-smoke.cjs:145-162` 的既有纪律）。
5. `outputs/` 只放非 TS 记录（AGENTS.md）；本报告所有产物都在 `.tmp/audit-design/`。目录下的 `reds/` 与 `REDS.md` **不是本次取证产物**（另一位队友的在写文件），不要混入本批证据。

---

## 5. 复跑命令

```bash
# 0) 构建（先记录 dist mtime：本批基线 Nov 2 23:30:41 / caf8c8d2…）
cd /Users/ze/Downloads/Cairn/cairn/apps/desktop && pnpm --filter cairn-desktop build

# 1) F1 before/after 三个数（同夹具、同视口；before = 运行时注入 8px 档）
cd /Users/ze/Downloads/Cairn/cairn/apps/desktop && \
AUDIT_PRELOAD=/Users/ze/Downloads/Cairn/cairn/.tmp/audit-design/audit-preload.cjs \
AUDIT_EXTRA_ARGS=--cairn-audit-tail-fixture \
env -u ELECTRON_RUN_AS_NODE npx electron /Users/ze/Downloads/Cairn/cairn/.tmp/audit-design/card-overlap.cjs

# 2) 几何 + 命中带 + 左轨对齐（默认夹具=压工具簇 6px；加 AUDIT_PREFIX=tail 走尾部夹具）
cd /Users/ze/Downloads/Cairn/cairn/apps/desktop && env -u ELECTRON_RUN_AS_NODE \
  npx electron /Users/ze/Downloads/Cairn/cairn/.tmp/audit-design/geometry-audit.cjs

# 3) 其他主面（遮挡扫描 / 渐隐 / 输入区 / 设置 / 侧栏）
cd /Users/ze/Downloads/Cairn/cairn/apps/desktop && AUDIT_EXTRA_ARGS=--cairn-audit-tail-fixture \
  env -u ELECTRON_RUN_AS_NODE npx electron /Users/ze/Downloads/Cairn/cairn/.tmp/audit-design/surfaces-audit.cjs
cd /Users/ze/Downloads/Cairn/cairn/apps/desktop && env -u ELECTRON_RUN_AS_NODE \
  npx electron /Users/ze/Downloads/Cairn/cairn/.tmp/audit-design/sidebar-probe.cjs

# 4) 判据分辨力自检（不写仓库）
node /Users/ze/Downloads/Cairn/cairn/.tmp/audit-design/judge-probe.mjs

# 5) 现有判卷
cd /Users/ze/Downloads/Cairn/cairn/apps/desktop && \
  npx vitest run --config vitest.config.ts --maxWorkers=1 tests/conversation-rail.test.ts tests/design-minimal.test.tsx
```

---

## 6. 产物清单（`.tmp/audit-design/`，全部本次取证）

| 文件 | 是什么 |
|---|---|
| `REPORT.md` | 本报告 |
| `card-overlap.cjs` / `card-overlap.json` | F1 探针 + 原始读数（before / after / beforeAgain / afterOnBand） |
| `geometry-audit.cjs` / `geometry.json` / `geometry-tail.json` | 几何 + 命中带 + 左右轨 + 其他主面读数（默认夹具 / 尾部夹具） |
| `surfaces-audit.cjs` / `surfaces.json` | 其他主面遮挡扫描、渐隐态、输入区、设置 |
| `sidebar-probe.cjs` | 侧栏根节点与控件遮挡 |
| `judge-probe.mjs` | 建议判据的分辨力自检（两侧对照，不写仓库） |
| `audit-preload.cjs` | 仓里 `ui-gallery-preload.cjs` 的副本 + `--cairn-audit-tail-fixture`（只追加，不改原行） |
| `before-card-01-stream.png` `before-card-02-hover-armed.png` `before-card-03-zoom.png` | **业主那一帧**：基于含修复的 dist（23:30）+ 运行时注入 `.changes-card{margin-top:8px!important}`。图标压在卡头里 |
| `after-card-01-stream.png` `after-card-02-hover-armed.png` `after-card-03-zoom.png` `after-card-04-pointer-on-card-band.png` | 工作树现状（顶距 24px）：图标整排在卡上；04 是指针停在卡顶边带那一帧 |
| `before-01…05-*.png`、`tail-01…07-*.png`、`before-sidebar.png` | 修复前 dist（23:26）的整屏截图，供对照 |
