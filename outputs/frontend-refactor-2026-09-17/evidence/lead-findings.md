# 证据 · 主理人独立实测发现（2026-09-17）

> 本文件由主理人画统筹在 Phase 1/2 等待期自行实测产出，**不依赖任何成员结论**。
> 每条给出可复核的实测方式。供质量审查官在 Phase 4 逐条独立验证。

---

## F-1 🔴 持久化布局 schema 完全绑死在已死的 React 层

**实测**：`src/main/settings.ts` 的 `DEFAULT_SETTINGS.layout`：

```ts
layout: {
  open: { approvals: false, token: false, git: false, memory: false,
          plugins: false, sidechat: false, agents: false, schedule: false },
  activePanel: null,
  width: 32,
}
```

这 8 个键**正是 React 树 `panels/registry.tsx` 的面板 id**（`approvals/token/git/memory/plugins/sidechat/agents/schedule`）。

而 vanilla 层（发货层）的视图集是 **`files / browser / review / terminal`**（`app.js:684-689` 的 `VIEW_META`）——**与上面 8 个键零重叠**。

**结论**：
1. vanilla 层**无法消费**这个持久化结构 → 面板开关状态实际无法持久化（或需一层映射）。
2. 单位也不一致：schema 用百分比 `width: 32`，vanilla 用像素 `--sidebar-w: 252px` / `--drawer-w: 340px`。
3. ⚠️ **`panels-check` A1/A2 是"无意义的绿"**：它断言 `layout.open.git === true` / `activePanel === 'git'`，在纯 Node 下能过，但**断言的是一个发货层根本不用的数据结构**。这比"红"更隐蔽——红门会被修，无意义的绿门不会。

**处置建议**：布局持久化 schema 需按 vanilla 视图集重定义（并入 MAINT 组），并把 A1/A2 的断言目标改为 vanilla 视图 id。

---

## F-2 🔴 发货渲染层 4147 行完全在静态检查之外

| 检查手段 | 是否覆盖 `src/renderer/app.js` / `index.html` |
|---|---|
| TypeScript（`pnpm typecheck`） | **否**。`tsconfig.json` 的 `include` 是 `["src","scripts","tests"]`，但 **`allowJs` 未开启**（默认 `false`）→ **`.js` 文件不进编译程序**。`app.js` 2281 行完全不被检查。`index.html` 内联 1358 行 CSS 同理。 |
| ESLint / Biome | **不存在**。仓库无 eslint / prettier / stylelint / biome 任何配置或依赖。 |
| CI | **不存在**。无 `.github/`。门禁靠人工 `pnpm gates`。 |

**结论**：**唯一有类型/静态保障的是已死的 React 树**（`.tsx` 被 typecheck 覆盖），而**真正发货的 4147 行零保障**。这是"可维护性"目标下最根本的一条——不是代码写得乱，是**没有任何机制阻止它变乱**。

---

## F-3 🔴 长会话无任何虚拟化/上限，全量同步渲染

**实测** `app.js:2209-2230`（`selectSession`）：

```js
const r = await api.openSession(id);
streamInner.innerHTML = '';
r.events.forEach(renderEvent);   // ← 全量，无上限、无分批、无 rAF 节流
finalizePending();
scrollStream();
```

**结论**：打开一个 10000 事件的会话 = **同步渲染 10000 个节点**。旧 `panels-check` B1 的验收口径是「1 万条事件 → DOM 消息节点 ≤ 300 + 滚动一屏 ≤ 200ms」——**该口径当前无人守**（探针死了，见简报 §4），且**即使修好探针也必然红**。

**另测**：全仓检索 `slice(-`/`.pop()`/`LIMIT`/`MAX_` 在 `app.js` 中**无任何消息数量上限逻辑**；`react-virtuoso` 仅被已死的 `conversation.tsx` 引用。

---

## F-4 🟠 `scrollStream()` 是布局抖动源

**实测** `app.js:894-897`：

```js
function scrollStream() {
  const stream = $('.stream');
  stream.scrollTop = stream.scrollHeight;   // 读 scrollHeight（强制布局）→ 写 scrollTop
}
```

调用点密集：打字机每 **6 个字符**调一次（`app.js:994`、`app.js:1109`），每次消息追加调一次（`1702`/`1719`），会话打开调一次（`2225`）。

**结论**：`scrollHeight` 读取强制同步重排（forced reflow），与逐字符 `textContent` 写入交替 → **读写交替的布局抖动**。打字机用 `setInterval` 逐字符（`app.js:992`、`1107`），未用 `requestAnimationFrame` 合帧。

---

## F-5 🟠 死守卫：`data-archived` 从不被输出

**实测**：`sessionItemHTML`（`app.js:122-166`）**不输出** `data-archived`；归档区由 `renderArchive`（`app.js:489-496`）产出 `.arch-row[data-id]`。

但 `app.js:419` 与 `app.js:465` 两处写着：

```js
if (item && !item.dataset.archived) selectSession(item.dataset.id);
```

`item.dataset.archived` **恒为 `undefined`** → 守卫恒真 → **死代码**。意图（区分归档行与活跃行）从未生效。

---

## F-6 🟡 CSS 规模与令牌纪律（量化）

| 指标 | 实测值 |
|---|---|
| 内联 CSS 行数 | **1358**（`index.html:9-1367`） |
| CSS 类选择器定义数 | **322** |
| 静态匹配到使用 | **294**（其余 ≥26 为候选死类，含 `running`/`pinned` 等拼接形式假阴性） |
| 硬编码 px 出现次数 | **944**（含小数，如 `12.5px`），**60 个不同数值**（8px×113、12px×78、2px×68、10px×63、14px×62、1px×59、6px×57、13px×35、15px×34、11px×34、4px×32、12.5px×30…） |
| 非标尺步进 | `13px` / `15px` / `11px` / `9px` / `7px` / `12.5px` — **无间距标尺** |

> ⚠️ **本行初版曾低估为「700+ 处 / 20+ 个数值」**（当时的正则漏掉小数、只看了 Top20）。由设计系统专家复核纠正为 **944 / 60**，主理人已重跑正则二次确认（`(?<![\w.-])(\d+(?:\.\d+)?)px` → 944 次 / 60 值）。
> **留档**：这条低估本身是「未穷举即下结论」的实例——与 F-1 的「无意义的绿门」同源。**结论必须来自穷举或可复现的脚本，不能来自 Top-N 采样。**
| 令牌块之外的 oklch 字面量 | **仅 4 处** → 颜色纪律**良好** |
| `!important` | 2 处 |

**结论**：**颜色纪律强、尺寸纪律弱**。视觉一致性问题的根不在颜色，在**没有间距/尺寸标尺**。

---

## F-7 🟡 CSS↔JS 隐式契约（无类型保障）

| 指标 | 实测值 |
|---|---|
| JS 中 `classList` 操作次数 | **62** |
| JS 中 `className =` 赋值 | 12 |
| `innerHTML` 赋值（模板字符串渲染） | **36** |
| `insertAdjacentHTML` | 1 |
| `addEventListener` 总数 | **80** |
| 其中 `document` 级事件委托 | **11** → 其余 **69 处为直接绑定** |
| `querySelector` 调用 | **100** |

**结论**：322 个 CSS 类中，状态类（`.open` / `.dragging` / `.running` / `.pinned` / `.reduce-motion` …）由 62 处 `classList` 操作在 JS 侧切换——**CSS 与 JS 之间是纯字符串契约，无任何静态校验**（见 F-2：连 TS 都没覆盖）。69 处直接绑定在动态重建的 DOM 上，是内存泄漏与"绑定失效"的风险面。

---

## F-8 ✅ 已核实为**健康**的项（不得回退，也不必"优化"）

| 项 | 实测 | 结论 |
|---|---|---|
| 键盘可达性 | `app.js:459` `if (e.key !== 'Enter' && e.key !== ' ') return;` — **Enter 与 Space 都处理**（含 `.folder-row` / `.sort-btn` / `.session` 三条分支） | ✅ 正确 |
| 焦点管理 | 全局 `:focus-visible` 焦点环；弹层关闭后 `.focus()` 回位（如 `app.js:450`） | ✅ 正确 |
| 色板健康度 | 现有全部文字令牌实测 ≥ 5.06:1（详见 `contrast-recompute.md`） | ✅ 达标 |
| 四态语义色 | 09-15 方案值经独立复算偏差 ≤ 0.05 | ✅ 可直接采用 |
| 动效降级 | 13 处 `prefers-reduced-motion` 块 + `html.reduce-motion` 全局降级 | ✅ 完整 |
| 转义 | `esc()` 存在并在模板拼接中使用 | ✅ 有防护 |

**方法学意义**：F-8 与 F-1/F-2/F-3 并存说明——**这个前端不是"烂代码"，而是"好手艺 + 零工程护栏"**。优化重点应放在**护栏**（静态检查、口径、门禁）与**结构**（分层、标尺、虚拟化），而非重写视觉。
