# 模态背景一直可达：a11y 门新相照出的 56 个可聚焦项（2026-09-22）

> **结论先行**：三个浮层（设置 / 新手引导 / 安全确认）在 `aria-modal="true"` 之下**从没把背景移出可交互树**——
> 实测设置浮层打开的那一刻，背景有 **56 个可聚焦元素**（底栏按钮、会话列表、搜索框……）。
> 这不是判据缺陷，是产品缺陷：`aria-modal` 只**告诉** AT「这是模态」，规范不因此免除 inert。
> 修法落在 `src/renderer/app.js` 尾部一处（`syncModalBackdrop` + 一个 `MutationObserver`），
> 判据落在 `scripts/a11y-check.ts`（新增 4 条规则 + 第 4 个相 + 一条「未知规则不得静默丢掉」的守卫），
> 离线观测者落在 `tests/renderer-modal-backdrop.test.ts`（9 条）+ 4 条变异锚点。
> 基线 HEAD `ee7db2d`，落地 commit `a9c4151`。

## 复算

```sh
pnpm build && pnpm run a11y-check          # 四相各打印逐规则计数；改前必红 56（见下「修前读数」）
pnpm run renderer-arch-check               # 84/84
pnpm panels-check                          # 真窗口 161 条断言：inert 不得挡住背景点击流
TERM=dumb pnpm test                        # 193 文件 / 1915 条（含 42 个跑 app.js 片段的测试）
```

**改 renderer 必须重新 `pnpm build`**：`a11y-check` / `panels-check` / `renderer-arch-check` 扫的是
`out/renderer` 那份构建产物，直接改 `src/renderer/` 不重跑构建 = 门在看旧代码（本轮实踩过一次，
装完 inert 同步后读数一动不动，才想起这条）。

## 修前读数（同一支门、逐相、按施工步序）

`modal-background-focusable` 一条的计数（日志留在 `/tmp/a11y-{1..5}.log`，命令重跑即可复现）：

| 步序 | 设置浮层打开态 | 引导浮层打开态 | 这一步在判什么 |
|---|---|---|---|
| 规则刚落地，产品未改 | **56** | —（还没这个相） | 缺陷本体：背景从没被移出可交互树 |
| 装 inert 同步、观测器漏 `subtree:true` | **56** | **71** | 代码看着对、读数一动不动 ⇒ 回调一次也没发生 |
| 补 `subtree:true` + 重新 `pnpm build` | 0 | **56** | 设置绿；向导仍红 = inert 判据取 `openModal()`，而该浮层在静态预览下未登记 |
| 判据改取 DOM | 0 | 0 | 四相全绿 |

三点要说清：

1. **71 与 56 的差不是产品差异**，是我给向导相造的假状态：第一版 prep 用 `classList.remove('show')` 关设置，
   而这类浮层靠 `opacity:0` 隐藏，整块面板（56 项背景之外的 15 项）仍留在 Tab 路径上。
   换成产品的关闭路径（`#settingsClose` → `closeSettings` 会补 inert）后向导相回到 56，
   与设置相同一批背景项——`closed-dialog-focusable` 就是为了让这种假状态**下次不能蒙混过关**。
2. 第 2 行为什么读数纹丝不动：**那一轮同时踩着两个原因**——观测器缺 `subtree:true`（代码侧），
   以及门读的是旧构建产物（流程侧，见上「复算」）。两者各自单独复现过一次，别把账记成一个。
3. 三条旧相从没扫过这件事：门原来只有「默认 / 抽屉 / 设置」三相，
   **没有任何一条规则问「浮层开着时背景还在不在 Tab 路径上」**——所以 56 这个数字在门里存在了零天。

## 缺陷与修法

### 1. 背景不 inert（产品侧，`src/renderer/app.js` 尾部）

`opacity:0; pointer-events:none` 那种「隐藏」**不 removes 焦点**：按 CSS/UIA 规范元素仍在可交互树里，
读屏器与键盘 Tab 照走。修法是浮层开着时给 `body > .app` 整块挂 `inert` + `aria-hidden="true"`，
关掉就摘掉。三个浮层共用一处实现（本仓反复踩过的「同族出口各抄一份」，这次从源头合成一份）。

### 2. inert 的判据不取 `MODAL_DISMISS`，取 DOM

首版写成「`openModal() !== null` 就锁」。跑门立刻红 56——但**这次是判据越界**：
`#onboardOverlay` 的登记（`registerModalDismiss('#onboardOverlay', …)`）在 `window.agent` 桥接段内部，
而该段开头 `if (!api || typeof api.listSessions !== 'function') return;`
在 `--static` 预览下整段提前返回 ⇒ 收起表里根本没有这个浮层 ⇒ `openModal()` 判「没开着」⇒ 背景不锁。

区分清楚了才动手：**登记表记的是「怎么关」**（Escape 需要一个 close 函数），
**inert 只需要知道「有没有模态开着」**。用前者判后者，等于让每一个未登记浮层自动漏在锁外——
而「未登记」恰恰就是「Escape 也关不掉」那一族缺陷的同根形态。改成按 DOM 选择器
`[role="dialog"][aria-modal="true"].show` 判，结构上就不存在「开着但不被管」。

`openModal()` 一字未动，仍服务 Escape 分层与 Tab 焦点圈。

### 3. `MutationObserver` 必须带 `subtree: true`

第一版只 `observe(document.body, {attributes:true, attributeFilter:['class']})`——
那**只盯 body 自己**的属性，子元素（浮层）改 class 一次都不会回调。实测症状：装完观测器
`inert` 永远是 `false`，门红着，代码看着却对。已在代码注释里钉住这条。

## 门侧新增（`scripts/a11y-check.ts`）

| 规则 | 级别 | 判什么 |
|---|---|---|
| `modal-background-focusable` | serious | 有浮层开着 ⇒ 背景不得有可聚焦项（本轮的 56） |
| `background-inert-no-modal` | serious | **成对反例**：没有浮层开着时背景不得被 inert——否则「永远锁死背景」这一种做法也能把上一条判绿 |
| `modal-self-inerted` | serious | **成对反例**：开着的对话框自己不得在 inert 子树里——否则「连浮层一起锁死」也能骗绿 |
| `closed-dialog-focusable` | serious | 收起的浮层必须自己 inert/aria-hidden：靠 `opacity:0` 收起 = 整块面板仍留在 Tab 路径上 |

外加两件事：

- **未知规则守卫**：扫描器里 `push()` 出一个名字不在 `RULE_ORDER` 的规则时，打印并计入 serious。
  否则新规则的违规会被汇总循环静默丢掉——那正是「加了一条判据、门却永远绿」的入口。
- **第四个相「引导浮层打开态」**：本门第一次扫向导。它的 prep 走**产品自己的关闭路径**收设置
  （`#settingsClose` → `closeSettings` 会补 inert），不用 class 直摘 `.show`——
  第一版就是拿 class 假关，于是照出一个「看着关了、其实整块面板还在 Tab 路径上」的假状态，
  读数 71 里有一多半是这个假状态贡献的。门的 prep 不能自己造假状态，
  这条正是 `closed-dialog-focusable` 要照的东西。
  该相判的是**机制**（背景可达性 / 可访问名），「向导真的会弹」由 panels-check B21 四次真启动判，两门不互相顶。

### 四条规则都当场造红验过非空转

只加不证伪的判据 = 下一颗假绿。做法：临时给 `STATES` 追加两相反（跑完即删，不进仓），
让门自己的扫描器照人为造的违规形态：

| 规则 | 造法 | 实测 |
|---|---|---|
| `modal-background-focusable` | 删掉产品的 inert 同步（即修前现状） | 红 56 |
| `background-inert-no-modal` | 无浮层时手动 `body > .app` 挂 inert | 红 1 |
| `modal-self-inerted` | 打开设置后给 `#settingsOverlay` 自己挂 inert | 红 1 |
| `closed-dialog-focusable` | 用 class 假关向导 + 摘掉 `#settingsOverlay` 的 inert | 红 2（两个面板各一条） |

造红过程还顺手把 `modal-background-focusable` 从「取第一个开着的浮层」改成**遍历全部**：
证伪相当场出现两个 `.show` 并存（一个 inert、一个没 inert），单数写法只会查第一个，
第二个里的可聚焦项既不算背景也不算对话框——一条被静默跳过的判据。

## 离线观测者与四条锚点

慢门不是观测者：`mutate-verify` 只消费 vitest 文件，所以这条产品判据若只有 a11y 门看着，
「inert 判据退回取 `MODAL_DISMISS`」「观测器漏掉 `subtree:true`」两类回归连锚点都挂不上——
而这两件事本轮各实踩过一次。补了 `tests/renderer-modal-backdrop.test.ts`（9 条，切 `app.js` 尾段进 vm 跑）：

| 判什么 | 怎么判 |
|---|---|
| 开着 ⇒ `body > .app` 挂 `inert` + `aria-hidden` | 直接读 fake 元素的属性表 |
| 一支都没开着 ⇒ 不锁 | 成对负控（只测「锁上了」会放过「永远锁死背景」） |
| 开↔关来回都重刷 | 翻状态后手调 `syncModalBackdrop()`，两侧都断言 |
| inert 只落在背景，不碰对话框 | 断言对话框的属性表为空（写它就等于把浮层锁死） |
| **判据不取收起表** | 断言整段只查 `[APP_SEL, DIALOG_SEL]` 两个选择器，一次都不按 `#id` 找浮层 |
| 观测带 `subtree:true` 且盯 body | 断言 `observe` 的 target 与 options |
| 只有对话框/body 的 class 改动触发重刷 | 用捕获到的观测器回调喂三类 record，数取料次数 |

对应四条变异锚点（`backdrop-inert-decided-by-dismiss-registry`、`backdrop-observer-loses-subtree`、
`backdrop-never-uninerts-on-close`、`backdrop-resyncs-on-any-class-change`），
在干净 HEAD `a9c4151` 上逐条实跑**全部被杀死**：

```sh
TERM=dumb node --import tsx scripts/mutate-verify.mjs \
  backdrop-inert-decided-by-dismiss-registry backdrop-observer-loses-subtree \
  backdrop-never-uninerts-on-close backdrop-resyncs-on-any-class-change
```

## 读数（本轮实跑）

- `a11y-check`：四相全绿，逐规则 0，`4/4 项通过 ✅`（含四条新规则各 0）。
- `renderer-arch-check`：`84/84 通过 ✅`。
- `panels-check`：exit 0，`✅` 161 条——inert 没有挡住任何背景点击流（审批卡 / 侧栏 / 定时任务面板都在 `.app` 内，
  只有浮层开着时才会被锁，而那正是应有的行为）。
  **其中 B21 十七行是「向导真开着」时跑的**（首启必弹 + 焦点圈 + 三种关法 + 重开不再弹，四次真启动）：
  **其中一条直接回答了「锁背景会不会把对话框一起锁死」**：
  `✅ B21 Tab 圈在浮层内（焦点从末位绕回首位；实测 activeElement="onbLater"）`——
  同一份产物里背景已挂 inert，向导内的按钮仍拿得到焦点（拿不到就不会是 `onbLater`）。
- `commercial-check`：`46 ✅ / 0 ❌`（D2b/D2c 只判存储面，「首启必弹」在 panels-check B21，两门不互相顶）。
- `docs-check`：exit 0，并显式打印「STATE.md 不存在 ⇒ D-1/D-2/D-4/D-5 未受检，不等于通过」。
- `test`：exit 0，`Test Files 193 passed (193)` / `Tests 1915 passed (1915)`，74.99s。
  其中 28 个文件用 vm 跑源码片段（`app.js` 的区间切片在内），新增的模块级函数 `syncModalBackdrop`
  落在文件尾、且不被任何区间内引用 ⇒ 切片界外一条未破（界内引用会直接 `ReferenceError`）。
- `mutate-needles-check`：针脚 624 条（+4），阻断 0 / 待复认 0 / 未覆盖 0，改法语法全合法。
- **干净 HEAD 单验**（`git worktree add --detach /tmp/dsh-wt-a9c4151 a9c4151` + 软链 node_modules）：
  `tsc --noEmit` exit 0（0 行输出）；两个模态测试文件 14 条全过。
  主树 `pnpm typecheck` 的 exit 2 全部归因到另一会话的未跟踪草稿 `scripts/sidebar-probe.ts`——
  这句只在**同 HEAD 开 worktree 实跑**后才敢写（工作树口径的归因句不算证据）。

## 未证 / 留位

- **真窗口下没量过正面那半**：B21 判的是「焦点绕回浮层内」，不是「按 Tab 走不到背景」——
  后者由 a11y 门的 5b 在构建产物上判（改前红 56、改后 0），没在真 Electron 里按键复验过。
- **`inert` 对 `pointer-events` 的连带影响未逐项验证**：门与 panels-check 全绿是间接证据，
  不是「鼠标行为逐条对过」。
- `#riskScrim`（安全确认）本轮没单独造相——它和设置/向导共用同一份 inert 同步与同一条规则，
  三条成对反例对它同样生效。
