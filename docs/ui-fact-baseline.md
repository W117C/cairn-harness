# UI 事实基线 · 可判定量（2026-09-18）

**本页只放实测数字 + 各自复跑命令。** 不放色值、尺寸、形态建议（按用户裁决「暂不定形态」，未决）。
三条约定：① 与 `agent-plan.md` 冲突时**以 `agent-plan.md` 为准**并在此标出；② 数值取自**工作树**，
全部数值为 **HEAD 态**实测（渲染层 P0 已落 `eafcbfb`，本批文件与 HEAD 逐字节一致）；③ **每条命令都已跑过并复现左值**——
表里没有一个是转抄来的数（这正是 `frontend-refactor` / `desktop-optimize` 旧基线失效的原因）。

shell 侧只用 `grep -E`（`\b` / `\s` 在 BSD grep 静默失效，AGENTS.md 有案）。
⚠️ 表格内的 `\|` 是 markdown 管道转义，**复制执行时去掉反斜杠**（左列数值均以去转义后的命令复现）。

| # | 量 | 值 | 复跑命令 |
| --- | --- | --- | --- |
| F1 | 渲染器份数 | **2** | `grep -oE 'function (renderEvent\|renderHistoryRow)\(' src/renderer/app.js \| sort -u \| wc -l` |
| F2 | 事件类型总数 | **27** | `grep -oE 'type: "[a-z_]+"' src/events/index.ts \| sort -u \| wc -l` |
| F3 | live 与 replay **都无渲染器**的类型 | **15** | `node -e 'const f=require("fs"),h=x=>f.readFileSync(x,"utf8");const j=h("src/renderer/app.js"),w=h("src/renderer/history-window.js");const t=[...new Set([...h("src/events/index.ts").matchAll(/type: "([a-z_]+)"/g)].map(m=>m[1]))];const L=new Set([...j.matchAll(/case .([a-z_]+).:/g)].map(m=>m[1]));const R=new Set([...w.matchAll(/e\.type === .([a-z_]+)./g)].map(m=>m[1]));const n=t.filter(x=>L.has(x)===false&&R.has(x)===false);console.log(n.length,n.join(" "))'` |
| F4 | 折叠机制 | **4**（手写 3 + 原生 `<details>` 1） | `grep -oE 'createElement\(.details.\)' src/renderer/app.js \| wc -l`（=1）<br>`grep -oE '(collapsed\|expanded)' src/renderer/app.js \| sort \| uniq -c`（=26 / 30，两种反义状态名） |
| F5 | 空态 | **2 套 / 3 标识符** | `grep -oE 'CHAT_EMPTY_HTML\|showEmptyStream\|panelEmptyHTML' src/renderer/app.js \| sort -u`（`CHAT_EMPTY_HTML` 是 `showEmptyStream` 的数据） |
| F6 | diff 着色 | **2** | `grep -oE 'function (highlightDiffLine\|diffHtml)\(' src/renderer/app.js \| wc -l` |
| F7 | 内联 SVG 出现次数 | **113**（`index.html` 66 + `app.js` 47） | `cat src/renderer/index.html src/renderer/app.js \| grep -oE '<svg' \| wc -l` |
| F8 | `index.html` id 总数 / 无 JS 引用数 | **101 / 37** | `node -e 'const f=require("fs");const H=f.readFileSync("src/renderer/index.html","utf8"),J=f.readFileSync("src/renderer/app.js","utf8");const i=[...new Set([...H.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))];console.log(i.length, i.filter(x=>J.includes(x)===false).length)'` |
| F9 | 令牌：声明 / 去重名 / 重复声明名 | **128 / 79 / 42** | `node -e 'const s=require("fs").readFileSync("src/renderer/index.html","utf8");const a=[...s.matchAll(/(--[\w-]+):/g)].map(m=>m[1]);const d=a.filter((v,i)=>a.indexOf(v)!==i);console.log(a.length,new Set(a).size,new Set(d).size)'` |
| F10 | 浮层机制 | **4 套** | `grep -oE 'function showPop\(' src/renderer/app.js \| wc -l`（=1 套 JS 测距）<br>`grep -oE 'registerPop\(' src/renderer/app.js \| wc -l`（=4：1 定义 + 3 注册）<br>`grep -oE 'id="(workspacePanel\|branchPanel\|permPanel\|modelPop)"' src/renderer/index.html \| wc -l`（=4 容器）<br>另两套：`.sb-menu` 重挂 body、`ask-pop` 运行时构建（`grep -oE "className = .ask-pop" src/renderer/app.js`） |
| F11 | 模态机制 | **2** | `grep -oE 'id="(settingsOverlay\|riskScrim)"' src/renderer/index.html \| sort -u \| wc -l` |
| F11b | 手写 `inert` 站点 | **6**（html 2 + `app.js` 4） | `for f in src/renderer/index.html src/renderer/app.js; do echo $f $(grep -oE 'inert' $f \| wc -l); done` |
| F12 | 双实现函数（顶层定义 + `window.agent` 块内重赋值） | **7** | `grep -oE '^[[:space:]]*(send\|selectSession\|deleteSession\|archiveSession\|renderSide\|openView\|closeView) = (async )?function' src/renderer/app.js \| wc -l` |
| F13 | **零引用令牌**（CSS 无 `var()` 且三个渲染 JS/TS 文件内不出现该名字） | **28 / 79 名（35%）**：`--sp-*` 缺 10/12、`--r-*`+`--r-pill` 全 8、`--st-*` 缺 5、另 `--code-bg` `--ease-spring` `--font-display` `--t-instant` `--st` | `node -e 'const f=require("fs"),c=f.readFileSync("src/renderer/index.html","utf8"),j=["app.js","history-window.js","projections.ts"].map(x=>f.readFileSync("src/renderer/"+x,"utf8")).join("");const n=[...new Set([...c.matchAll(/(--[\w-]+):/g)].map(m=>m[1]))].filter(x=>c.includes("var("+x+")")===false&&j.includes(x)===false);console.log(n.length,n.join(" "))'` |
| F13b | 曾报「零引用令牌 0」的更正 | 2026-09-18 本会话先按「只删 `--tap-min`/`--rail-w` 两个」记为已清，随后用 F13 口径复跑发现**真值是 28**——原判定口径太窄（只查 `--tap-min`/`--rail-w` 两个名字，未普查全体）。**此行为该页自己的 C1 类缺陷留证**：减法面比记账的大一个数量级 | 同上 |
| F14 | 布局断点 | **3**（`min:1600` / `max:1279` / `max:1023`） | `grep -oE '@media[^{]*\((min\|max)-width: ?[0-9]+' src/renderer/index.html` |
| F15 | `prefers-reduced-motion` 块 | **13** | `grep -oE 'prefers-reduced-motion' src/renderer/index.html \| wc -l` |
| F16 | 静态标记 `aria-*` 出现次数 | **195** | `grep -oE 'aria-[a-z-]+' src/renderer/index.html \| wc -l` |
| F17 | `z-index` 档位集合 | **6 40 60 61 70 71 80 90**（**无 30**） | `grep -oE 'z-index: ?[0-9-]+' src/renderer/index.html \| sort -u` |
| F18 | `app.js` / `index.html` / `history-window.js` 行数（`wc -l` 口径） | **2690 / 1973 / 116**（`index.html` 1977→1973 因 `7d2c880` 删 4 行死令牌） | `wc -l src/renderer/app.js src/renderer/index.html src/renderer/history-window.js` |
| F19 | 前端运行时依赖数 | **0** | `node -e 'const p=require("./package.json");const d=Object.assign({},p.dependencies,p.devDependencies);console.log(Object.keys(d).filter(k=>/react\|tailwind\|radix\|shadcn\|^lit$\|vue\|svelte\|solid\|preact/.test(k)).length)'` |
| F20 | 门禁条数 | **29**（HEAD 态；`git show HEAD:scripts/gate-manifest.ts` 复跑）。工作树现测 30——他人在飞新增 `ipc-reachability-check` 未提交，**不计入本页** | `git show HEAD:scripts/gate-manifest.ts` 与页内 node 切片命令（见正文下） |

### 与既有记载的分歧（复跑后以本页为准）

| 出处 | 它写的 | 本页 | 结论 |
| --- | --- | --- | --- |
| `frontend-refactor-2026-09-17` 事实基线 | `app.js` 2281 / `index.html` 1866 | 2690 / 1973（F18） | 已漂移 +409 / +107 行；数字层作废，其 §1 裁决记录仍有效 |
| `desktop-optimize-2026-09-17/02` | reduced-motion 13→**17** | **13**（F15） | 自报数不成立 |
| `desktop-optimize-2026-09-17/02` | 新增 z-index **30**/40 | 档位无 30（F17） | 自报数不成立 |
| `.worktrees/r1b` spec 基线表 | 内联 SVG **73** | **113**（F7） | 73 在四种口径下均不可复现（60 行 / 66 次 / 47 次 / 合计 113）；本页按 F7 口径发布 |
| `.worktrees/r1b` spec 基线表 | 无渲染器类型 15/**26** | 15/**27**（F2/F3） | 分母差 1 = P0 新增的 `error` 类型（已落 `eafcbfb`）；它被 live 与 replay 两路各自覆盖，故 F3 仍 15 |
| 本台账 `outputs/design-contradictions-2026-09-18.md` C5 | 静态 `aria-*` **194** | **195**（F16） | 194 = `23240bc`（P0 之前）实测，195 = HEAD；差 1 来自 `ic-stop` 的 `aria-hidden`。命令：`git show 23240bc:src/renderer/index.html \| grep -oE 'aria-[a-z-]+' \| wc -l` |
| 本台账 D2 | 手写 `inert` **4 处** | **6 处**（F11b） | 原计数只看了 markup，漏了 JS 侧 4 个写入点 |

### 刻意不覆盖的一处冲突

`agent-plan.md` §10 结论行仍写「React 19 栈」，与 F19（前端运行时依赖 0）直接冲突。
AGENTS.md:30 明文该文件只读，协调会话已上报用户裁——**本页不改写、不覆盖，仅标记冲突**。
