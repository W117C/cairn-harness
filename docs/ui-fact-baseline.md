# UI 事实基线 · 可判定量（2026-09-18）

**本页只放实测数字 + 各自复跑命令。** 不放色值、尺寸、形态建议（按用户裁决「暂不定形态」，未决）。
三条约定：① 与 `agent-plan.md` 冲突时**以 `agent-plan.md` 为准**并在此标出；② 数值取自**工作树**，
全部数值为 **HEAD 态 `cd101fa` 实测**（2026-09-19 全表逐条复跑：5 行有改 = F4（**原值「1」系本页自证过度**，
真值 2 套）/F7/F13（28→27，判据假阳性，见 F13c）/F18/F20，其余复跑值未变）；③ **每条命令都已跑过并复现左值**——
表里没有一个是转抄来的数（这正是 `frontend-refactor` / `desktop-optimize` 旧基线失效的原因）。

shell 侧只用 `grep -E`（`\b` / `\s` 在 BSD grep 静默失效，AGENTS.md 有案）。
⚠️ 表格内的 `\|` 是 markdown 管道转义，**复制执行时去掉反斜杠**（左列数值均以去转义后的命令复现）。

| # | 量 | 值 | 复跑命令 |
| --- | --- | --- | --- |
| F1 | 渲染器份数 | **1**（R1b B1 前为 2：`renderEvent` + `renderHistoryRow` 桩；桩已删） | `grep -oE 'function (renderEvent\|renderHistoryRow)\(' src/renderer/app.js \| sort -u \| wc -l` |
| F2 | 事件类型总数 | **27** | `grep -oE 'type: "[a-z_]+"' src/events/index.ts \| sort -u \| wc -l` |
| F3 | live 与 replay **都无专属 case** 的类型 | **15**（⚠️ 口径告警：R1b 后这 15 类**已有通用宿主**——单一渲染器的 `default` 分支给它们一张记录卡（中文标签 + `.tag` 归因 + 可展开原文），只是没有**专属** case。本命令看不见 `default`，所以 "15" 现在量的是「缺语义卡」不是「不渲染」；R2 的目标是把它降到 0） | `node -e 'const f=require("fs"),h=x=>f.readFileSync(x,"utf8");const j=h("src/renderer/app.js"),w=h("src/renderer/history-window.js");const t=[...new Set([...h("src/events/index.ts").matchAll(/type: "([a-z_]+)"/g)].map(m=>m[1]))];const L=new Set([...j.matchAll(/case .([a-z_]+).:/g)].map(m=>m[1]));const R=new Set([...w.matchAll(/e\.type === .([a-z_]+)./g)].map(m=>m[1]));const n=t.filter(x=>L.has(x)===false&&R.has(x)===false);console.log(n.length,n.join(" "))'` |
| F4 | 折叠机制 | **2 套、且状态名相反**（⚠️ 本行原记「1」是**本页又一次 C1 类缺陷**：口径只覆盖了 `[data-tool-toggle]` 一条路，看不见第二条）。真跑路径 = **1 个**委托处理器、**1 个**属性名 `data-tool-toggle` → `.collapsed`（`app.js:1736-1744`）；第二套 `.think-head` → **`.expanded`**（`app.js:1695-1702`）**只服务演示 `send()`**（`app.js:1100` 打字机假回复、`index.html:1526` 静态演示转录），真跑路径不产 `.think` 块 ⇒ 「折叠 1 套」只在真跑路径内成立。R1b B3 前为 4（卡片 `data-card-toggle` 一套 + 工具 `.ti-head`/`.tg-head` 两套 + 原生 `<details>` 一套），`<details>` 确已归零 | `grep -c "e.target.closest('\[data-tool-toggle\]')" src/renderer/app.js`（=1 真跑处理器）<br>`grep -c "e.target.closest('.think-head')" src/renderer/app.js`（=1 演示处理器）<br>`grep -c "createElement('details')" src/renderer/app.js`（=0）<br>`grep -oE '\.collapsed\|\.expanded' src/renderer/index.html \| sort \| uniq -c`（10 / 3 两套极性并存） |
| F5 | 空态 | **2 套 / 3 标识符**（R1b 后**未降**：把 chat-empty 与 settings-empty 并成一套属定形态，见 spec §8；台账 G2/G3 记的两处假象已修——删除会话路径不再绕过 `showEmptyStream()`，零会话启动不再留 `index.html` 的演示对话） | `grep -oE 'CHAT_EMPTY_HTML\|showEmptyStream\|panelEmptyHTML' src/renderer/app.js \| sort -u`（`CHAT_EMPTY_HTML` 是 `showEmptyStream` 的数据） |
| F6 | diff 着色 | **2** | `grep -oE 'function (highlightDiffLine\|diffHtml)\(' src/renderer/app.js \| wc -l` |
| F7 | 内联 SVG 出现次数 | **114**（`index.html` 66 + `app.js` 48；113→114 = `7793fe1` 给记录卡补 chevron，唯一一处） | `cat src/renderer/index.html src/renderer/app.js \| grep -oE '<svg' \| wc -l` |
| F8 | `index.html` id 总数 / 无 JS 引用数 | **101 / 37** | `node -e 'const f=require("fs");const H=f.readFileSync("src/renderer/index.html","utf8"),J=f.readFileSync("src/renderer/app.js","utf8");const i=[...new Set([...H.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))];console.log(i.length, i.filter(x=>J.includes(x)===false).length)'` |
| F9 | 令牌：声明 / 去重名 / 重复声明名 | **128 / 79 / 42** | `node -e 'const s=require("fs").readFileSync("src/renderer/index.html","utf8");const a=[...s.matchAll(/(--[\w-]+):/g)].map(m=>m[1]);const d=a.filter((v,i)=>a.indexOf(v)!==i);console.log(a.length,new Set(a).size,new Set(d).size)'` |
| F10 | 浮层机制 | **4 套** | `grep -oE 'function showPop\(' src/renderer/app.js \| wc -l`（=1 套 JS 测距）<br>`grep -oE 'registerPop\(' src/renderer/app.js \| wc -l`（=4：1 定义 + 3 注册）<br>`grep -oE 'id="(workspacePanel\|branchPanel\|permPanel\|modelPop)"' src/renderer/index.html \| wc -l`（=4 容器）<br>另两套：`.sb-menu` 重挂 body、`ask-pop` 运行时构建（`grep -oE "className = .ask-pop" src/renderer/app.js`） |
| F11 | 模态机制 | **2** | `grep -oE 'id="(settingsOverlay\|riskScrim)"' src/renderer/index.html \| sort -u \| wc -l` |
| F11b | 手写 `inert` 站点 | **6**（html 2 + `app.js` 4） | `for f in src/renderer/index.html src/renderer/app.js; do echo $f $(grep -oE 'inert' $f \| wc -l); done` |
| F12 | 双实现函数（顶层定义 + `window.agent` 块内重赋值） | **7** | `grep -oE '^[[:space:]]*(send\|selectSession\|deleteSession\|archiveSession\|renderSide\|openView\|closeView) = (async )?function' src/renderer/app.js \| wc -l` |
| F13 | **零引用令牌**（CSS 无 `var(--x)` 亦无 `var(--x, 回退)`，且三个渲染 JS/TS 文件内不出现该名字） | **27 / 79 名（34%）**：`--sp-*` 缺 10/12、`--r-*`+`--r-pill` 全 8、`--st-*` 缺 5、另 `--code-bg` `--ease-spring` `--font-display` `--t-instant` | `node -e 'const f=require("fs"),c=f.readFileSync("src/renderer/index.html","utf8"),j=["app.js","history-window.js","projections.ts"].map(x=>f.readFileSync("src/renderer/"+x,"utf8")).join("");const n=[...new Set([...c.matchAll(/(--[\w-]+):/g)].map(m=>m[1]))].filter(x=>new RegExp("var\\(\\s*"+x+"\\s*[,)]").test(c+j)===false&&j.includes(x)===false);console.log(n.length,n.join(" "))'` |
| F13b | 曾报「零引用令牌 0」的更正 | 2026-09-18 本会话先按「只删 `--tap-min`/`--rail-w` 两个」记为已清，随后用 F13 口径复跑发现**真值是数十个**——原判定口径太窄（只查 `--tap-min`/`--rail-w` 两个名字，未普查全体）。**此行为该页自己的 C1 类缺陷留证**：减法面比记账的大一个数量级 | 同上 |
| F13c | F13 **判据自身**的第二次更正（28 → 27） | 旧判据写的是字面量 `c.includes("var("+x+")")`，**漏掉带回退值的读取** `var(--st, 0)`（`index.html:416` 运行指示环的相位偏移）⇒ 把**已接线**的 `--st` 记成死令牌，28 里含 1 个假阳性。改为 `var\(\s*--x\s*[,)]` 后逐个复核其余 27 名，均为真零引用。**教训：`includes` 式的"读取面"判定在 CSS 变量上不成立**（回退值、空格、`setProperty` 三种写法都漏）。28 这个数字已被 `outputs/t6-run-state-spec-2026-09-19.md` §4 转抄，见下表分歧行 | 左列命令给出 27 与逐名清单；假阳性复现：`grep -n "var(--st," src/renderer/index.html` → 416 |
| F14 | 布局断点 | **3**（`min:1600` / `max:1279` / `max:1023`） | `grep -oE '@media[^{]*\((min\|max)-width: ?[0-9]+' src/renderer/index.html` |
| F15 | `prefers-reduced-motion` 块 | **13** | `grep -oE 'prefers-reduced-motion' src/renderer/index.html \| wc -l` |
| F16 | 静态标记 `aria-*` 出现次数 | **195** | `grep -oE 'aria-[a-z-]+' src/renderer/index.html \| wc -l` |
| F17 | `z-index` 档位集合 | **6 40 60 61 70 71 80 90**（**无 30**） | `grep -oE 'z-index: ?[0-9-]+' src/renderer/index.html \| sort -u` |
| F18 | `app.js` / `index.html` / `history-window.js` 行数（`wc -l` 口径） | **2769 / 1973 / 124**。较 `7d2c880` 记账值（2690 / 1973 / 116）**净 +79 / 0 / +8**，逐笔可归因：app.js `b696a62`(B1 收敛单一渲染器) +90 → `4afcee9`(B2+B3 折叠/空态) −20 → `7793fe1`(记录卡 chevron+归因) +9 = **+79**；history-window.js `b696a62` +5 → `3c77360`(贴底钉住) +3 = **+8**；index.html **一字未动**（减法没换来 markup 变薄，因为删的是 JS 侧第二套渲染器）。⚠️ **减法轮的行数不是净减**，写收益前先跑这条 | `wc -l src/renderer/app.js src/renderer/index.html src/renderer/history-window.js` |
| F19 | 前端运行时依赖数 | **0** | `node -e 'const p=require("./package.json");const d=Object.assign({},p.dependencies,p.devDependencies);console.log(Object.keys(d).filter(k=>/react\|tailwind\|radix\|shadcn\|^lit$\|vue\|svelte\|solid\|preact/.test(k)).length)'` |
| F20 | 门禁条数 | **30**（HEAD 态；2026-09-19 复跑，`ipc-reachability-check` 已入库故 29→30） | `node -e 'const s=require("child_process").execSync("git show HEAD:scripts/gate-manifest.ts",{encoding:"utf8"});const m=s.match(/export const GATES[\s\S]*?\n\];/)[0];console.log([...m.matchAll(/^\s*"([\w:-]+)",$/gm)].length)'` |

### 与既有记载的分歧（复跑后以本页为准）

| 出处 | 它写的 | 本页 | 结论 |
| --- | --- | --- | --- |
| `frontend-refactor-2026-09-17` 事实基线 | `app.js` 2281 / `index.html` 1866 | 2769 / 1973（F18） | 已漂移 +488 / +107 行；数字层作废，其 §1 裁决记录仍有效 |
| `desktop-optimize-2026-09-17/02` | reduced-motion 13→**17** | **13**（F15） | 自报数不成立 |
| `desktop-optimize-2026-09-17/02` | 新增 z-index **30**/40 | 档位无 30（F17） | 自报数不成立 |
| `.worktrees/r1b` spec 基线表 | 内联 SVG **73** | **114**（F7） | 73 在四种口径下均不可复现（含 `<svg` 的行合计 108 / html 行 60 / html 次 66 / app.js 次 48）；本页按 F7 口径发布 |
| `.worktrees/r1b` spec 基线表 | 无渲染器类型 15/**26** | 15/**27**（F2/F3） | 分母差 1 = P0 新增的 `error` 类型（已落 `eafcbfb`）；它被 live 与 replay 两路各自覆盖，故 F3 仍 15 |
| 本台账 `outputs/design-contradictions-2026-09-18.md` C5 | 静态 `aria-*` **194** | **195**（F16） | 194 = `23240bc`（P0 之前）实测，195 = HEAD；差 1 来自 `ic-stop` 的 `aria-hidden`。命令：`git show 23240bc:src/renderer/index.html \| grep -oE 'aria-[a-z-]+' \| wc -l` |
| 本台账 D2 | 手写 `inert` **4 处** | **6 处**（F11b） | 原计数只看了 markup，漏了 JS 侧 4 个写入点 |
| `outputs/t6-run-state-spec-2026-09-19.md` §4 | 零引用令牌 **28 / 79** | **27 / 79**（F13） | 它转抄的是本页旧判据的产物：`includes("var(--x)")` 漏读带回退值的 `var(--st, 0)`（`index.html:416`）⇒ 多算 1 个假阳性。**28 自此作废**，按 F13 新命令复跑得 27。T6 的其余裁决（7 态映射、不建 `--st-rejected`）不受影响 |

### 刻意不覆盖的一处冲突

`agent-plan.md` §10 结论行仍写「React 19 栈」，与 F19（前端运行时依赖 0）直接冲突。
AGENTS.md:30 明文该文件只读，协调会话已上报用户裁——**本页不改写、不覆盖，仅标记冲突**。
