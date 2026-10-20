# Claude 桌面端设计还原 · 实证调研（2026-10-20）

> **对象**：`/Applications/Claude.app` v2.42304.2（构建 2026-10-19，app.asar 56,088,935 B）
> **三条独立证据线**：① REA 静态分析（app.asar）② 编译产物 CSS 抽取 ③ 真机 AX 树 + 截图实测
> **纪律**：每个数字标注证据来源。①=REA 静态 ②=CSS 抽取 ③=真机实测。未抽到的写"未找到"，不编造。

---

## 0. 这次还原拿到了什么（实测口径）

| 证据线 | 实测规模 | 状态 |
|---|---|---|
| ① REA 静态分析 | 454 相关文件 / 436 JS 解析 / 6821 findings / 2251 节点 / 2533 边 / 9,532,381 AST 节点 | ✅ 完成 |
| ② asar 解包 + CSS 抽取 | 511 文件清单；抽取 30 个 css/html/png/json（1.55 MB） | ✅ 完成 |
| ③ 真机 | AX 树 241 元素（菜单 7 栏 + 主窗口 webview）；2 张桌面截图 | ✅ 完成 |

**REA 静态面实测**（①）：`browser_windows: 14`、`explicit_web_preferences: 37`、`context_bridge_apis: 52`、`exposed_api_members: 37`、`ipc.operations: 1535`（其中 `literal_channels: 10`、`dynamic_channel_operations: 1524`）、`utility_processes: 4`、`sender_validation_observations: 63`。
节点 kind 分布：unknown 845 / asar-entry 454 / javascript-asset 435 / javascript-module 240 / ipc-channel 114 / endpoint 53 / ipc-handler 37 / context-bridge-api 19 / artifact 14 / source-map 13 / electron-renderer 6 / package 6 / native-addon 5 / worker 3 / electron-main 1。

---

## 1. 色板：35 阶 gray，暗色整体反转（②）

```css
--cds-gray-0   #fff      --cds-gray-500  #6d6b67
--cds-gray-10  #fcfcfb   --cds-gray-550  #5f5e5a
--cds-gray-20  #f9f9f7   --cds-gray-600  #52514e
--cds-gray-30  #f6f6f4   --cds-gray-650  #454442
--cds-gray-40  #f3f3f0   --cds-gray-700  #383835
--cds-gray-50  #f0efec   --cds-gray-750  #2c2c2a
--cds-gray-60  #edece8   --cds-gray-800  #20201f
--cds-gray-70  #eae9e4   --cds-gray-810  #1e1e1d
--cds-gray-80  #e7e6e1   --cds-gray-820  #1c1c1b
--cds-gray-90  #e4e3dd   --cds-gray-830  #1a1a19
--cds-gray-100 #e1e0d9   --cds-gray-840  #181817
--cds-gray-150 #d2d1c7   --cds-gray-850  #151515
--cds-gray-200 #c3c2b7   --cds-gray-860  #131313
--cds-gray-250 #b4b3a8   --cds-gray-870  #111111
--cds-gray-300 #a5a49a   --cds-gray-880  #0f0f0f
--cds-gray-350 #97958d   --cds-gray-890  #0d0d0d
--cds-gray-400 #898781   --cds-gray-900  #0b0b0b
--cds-gray-450 #7b7974
```

**步进规律**（②）：0–100 每 10；100–800 每 50；800–900 每 10。共 35 阶。
**暗色反转机制**（②）：`--cds-neutral-<N>` 亮色 = `gray-N`（恒等）；暗色 = **`gray-(900−N)`**。
不动点解 `900−N = N` → **N = 450**（实测 `neutral-450` 亮暗同为 `gray-450`；`neutral-500` 暗色落 `gray-400`、`neutral-550` 落 `gray-350`，均可验证）。
> **更正**：本文件早前版本写"中轴在 500 不动"**是错的**，实测轴心是 **450**。一个语义名在亮暗两档自动落在不同色阶上，**不需要手写第二套值**。

### 真机核对（③）
| 部位 | 实测像素 | 换算 | 对应令牌 |
|---|---|---|---|
| **侧栏底** | `rgb(17,17,17)` = `#111111` | — | gray-870 |
| **主区底** | `rgb(21,21,21)` = `#151515` | — | gray-850 = `--cds-surface-0`（暗） |
| 亮色首帧底 | `#fcfcfb` / 暗 `#151515` | — | `--claude-background-color`（② index.html 首帧规则） |

> `#151515` 与规范 §4.1 写的 `--bg-100` 暗色 `#262624` **不符**——真机主区是 `#151515`（gray-850），不是 `#262624`。这是规范的一处实测定性偏差。

---

## 2. 三层令牌：Cairn 缺的整整一层（②）

Claude 是 **色阶 → 角色(role) → 语义** 三层，Cairn 规范 §4.2 只有"色阶 → 语义"两层。

| 层 | Claude 实例 | Cairn 现状 |
|---|---|---|
| ① 色阶 | `--cds-gray-10…900`（35 阶） | ✅ 有（自建 13 阶） |
| ② **角色 role** | `--cds-role-{accent,danger,pro,success,tooltip,warning}-{50,100,250,300,400,450,600,700,800,850,fill,fill-hover,on}` **57 个** | ❌ **完全没有** |
| ③ 语义 | `--cds-text-primary/secondary/muted`、`--cds-bg-accent`、`--cds-fill-accent`、`--cds-border-accent` | △ 部分（无 accent 三件套的分主题值） |

**角色层的实测接法**（②）：
```css
--cds-role-accent-250: var(--cds-blue-250);
--cds-role-accent-fill: var(--cds-role-accent-450);
--cds-border-accent: var(--cds-role-accent-250);   /* 亮 */
--cds-border-accent: var(--cds-role-accent-700);   /* 暗 */
--cds-text-accent:  var(--cds-role-accent-300);    /* 亮 */
--cds-text-accent:  var(--cds-role-accent-600);    /* 暗 */
--cds-bg-accent:    var(--cds-role-accent-100);    /* 亮 */
--cds-bg-accent:    var(--cds-role-accent-800);    /* 暗 */
```
一个 `accent` 语义在亮暗各取不同刻度，**但组件只写 `--cds-border-accent` 一个名**。

---

## 3. 表面层级 surface（② + ③）

Cairn 规范 §4.1 的 `--bg-000…500` 是"五档底"，Claude 是**四档 surface + 独立 page-bg**：

| 令牌 | 亮 | 暗 | 用途 |
|---|---|---|---|
| `--cds-page-bg` | `var(--cds-surface-0)` | 同 | 页面最底（另有 `transparent` 变体） |
| `--cds-surface-0` | gray-20 `#f9f9f7` | gray-900 `#0b0b0b` | 页面 |
| `--cds-surface-1` | gray-10 `#fcfcfb` | gray-850 `#151515` | 抬升一层 |
| `--cds-surface-2` | gray-0 `#fff` | gray-830 `#1a1a19` | 再抬升 |
| `--cds-surface-3` | gray-0 `#fff` | gray-800 `#20201f` | 最高（弹层） |

> 注意暗色是**越抬升越亮**（900→850→830→800），亮色是**越抬升越白**（20→10→0）。方向相反，靠 neutral 反转自动完成。

---

## 4. 文字语义（②）

| 令牌 | 亮 | 暗 |
|---|---|---|
| `--cds-text-primary` | `var(--cds-neutral-900)` | `var(--cds-gray-50)` |
| `--cds-text-secondary` | `var(--cds-neutral-600)` | `var(--cds-gray-200)` |
| `--cds-text-muted` | `var(--cds-neutral-400)` | `var(--cds-gray-400)` |
| `--cds-text-disabled` | `var(--cds-alpha-4)` | 同 |

另有 `undimmed-*` 一套（`--cds-undimmed-text-primary/secondary/muted`、`--cds-undimmed-text-stays-secondary`）——用于弹层/遮罩下**不被压暗**的文字。Cairn 无对应概念。

---

## 5. 刻度：双轴变体（②）

每个刻度令牌都带 **尺寸轴** 与 **文字轴** 两套变体，Cairn 规范 §4.5 提到"双轴"但代码层未见：

- 尺寸轴：`--cds-{h-control,pad-xs…xl,icon,checkbox,radius,font-size-*,leading-*}` → 各带 `--xs/--sm/--md/--lg`
- 文字轴：同名 + `--textsm/--textmd/--textlg`（随用户字号偏好）
- 计算一律 `calc(<rem> * var(--cds-rem-scale,1))`

实测值举例（②）：
| 令牌 | 值 |
|---|---|
| `--cds-h-control` | 1.25 / 1.5 / 1.75 / 2 / 2.5 rem |
| `--cds-h-control-nested` | 1 / 1.125 / 1.25 / 1.375 / 1.75 rem |
| `--cds-pad-xs…xl` | .125 / .25 / .375 / .5 / .625 / .75 / .875 / 1 / 1.25 / 1.375 / 1.5 / 1.75 rem |
| `--cds-icon` | .75 / 1 / 1.25 / 1.5 rem |
| `--cds-checkbox` | .875 / 1 / 1.125 / 1.25 / 1.5 rem |
| `--cds-font-size-caption` | .625 / .6875 / .75 / .8125 rem |
| `--cds-font-size-body` | .75 / .8125 / .875 / .9375 rem |
| `--cds-font-size-prose` | .8125 / .875 / .9375 / 1 / 1.125 rem |
| `--cds-leading-body` | 1.0625 / 1.1875 / 1.25 / 1.375 rem |
| `--cds-leading-prose` | 1.1875 / 1.25 / 1.375 / 1.5 / 1.6875 rem |
| `--cds-radius` | .25 / .3125 / .375 / .4375 / .5 / .625 rem |

---

## 6. 动效（②）

| 令牌 | 值 |
|---|---|
| `--cds-dur-snap` | `.12s` |
| `--cds-dur-fast` | `60ms` |
| `--cds-dur-base` | `.2s` |
| `--cds-dur-sheet` | `.3s` |
| `--cds-dur-slow` | `.45s` |
| `--cds-ease-out` | `cubic-bezier(0,0,.2,1)` / `cubic-bezier(.165,.84,.44,1)` |
| `--cds-ease-snap` | `cubic-bezier(.32,.72,0,1)` |
| `--cds-ease-overshoot` | `cubic-bezier(.34,1.3,.64,1)` |

**五档时长 × 四档缓动** = 20 种组合，全部令牌化。Cairn 现有 `--t-fast` 一档。

---

## 7. 焦点环（②）

```css
--cds-focus-shadow: inset 0 0 0 1px var(--cds-page-bg),
                    0 0 0 1px var(--cds-fill-accent),
                    0 0 6px 1px var(--cds-bg-accent);
```
三层：内描边（页面底色隔开）+ 1px 实环 + 6px 外发光。另有 `--cds-ring-inner: 1px/0px`、`--cds-ring-outer: 0px/1px` 切换。Cairn 是单层 2px outline。

---

## 8. 会话专有令牌（②）

| 令牌 | 值 |
|---|---|
| `--cds-message-bubble-radius` | 由 `--cds-radius` 派生：`calc(var(--cds-message-bubble-radius) - .25rem * var(--cds-rem-scale,1))` |
| `--cds-message-bubble-radius-meeting` | `4px` |
| `--cds-message-bubble-radius-head/-foot` | 引用上面两者（`!important` 变体存在） |
| `--cds-message-actions-opacity` | `0` / `1`（hover 显隐） |

---

## 9. 首帧 / 冷启动（② index.html）

- `<html class="cds-root" data-mode="system" data-density="comfortable" data-platform="desktop">` —— **首帧就盖章**，避免令牌未解析的闪白
- 首帧内联规则（unlayered，压过 `@layer base`，全文档生命周期有效）：亮 `#fcfcfb` / dark `#151515`
- **boot placeholder**：`--boot-placeholder-sidebar-width`、`48px` 高 drag strip、`--boot-placeholder-scale`；侧栏骨架色 `color-mix(in srgb, #f9f9f7 50%, #fcfcfb)`（亮）/ `color-mix(in srgb, #151515 80%, black)`（暗）；行 `rgba(11,11,11,.05)` / `rgba(255,255,255,.075)`；缝 `rgba(11,11,11,.1)` / `rgba(255,255,255,.1)`
- 窄视口折叠：`window.innerWidth / scale <= frame.narrowViewportMaxWidth` → 侧栏收起

---

## 10. 真机信息架构（③ · AX 树）

### 10.1 菜单 7 栏（实测）
| 菜单 | 项 |
|---|---|
| **Claude** | About Claude / Settings… / Check for Updates… / Services / Hide / Hide Others / Show All / Quit |
| **File** | New Session / New Session in New Window / ~~New Side Chat~~ / Open File… / Open Folder… / Close Window / 全部关闭 / ~~Reopen Closed Session~~ |
| **Edit** | Undo/Redo/Cut/Copy/Paste/Paste and Match Style/Delete/Select All / **Find** → (Find… / Find Next / Find Previous / ~~Find in Files…~~) / 自动填充 / 开始听写 / 表情与符号 |
| **View** | Command Palette… / Hide Sidebar / Show Terminal / Show Changes / Show Preview / Show Files / Show Side Chat / Close Pane / **Split View** → (9 项含 Move Left/Right/Up/Down) / Actual Size / Zoom In / Zoom Out / Reload / Enter Full Screen |
| **Go** | Back / Forward / **Cowork** / **Code** / Previous Session / Next Session / Search… |
| **Window** | 标准 macOS + **Show Main Window** |
| **Help** | Claude Help / Keyboard Shortcuts / **Troubleshooting** → (15 项，含 Developer Mode / Cowork VM 调试 / Import Claude Code CLI Sessions…) / Get Support |

（删除线 = 当前态 disabled）

### 10.2 侧栏（实测）
`Hide sidebar` ▸ `Search` ▸ **Cowork / Code 分段** ▸ `New` ▸ `Routines` ▸ `Customize` ▸ `More navigation items` ▸ 项目分组（`deepseek harness`、`Cairn`，各带 `New session in <项目>`）▸ `Filter` ▸ 会话行（`Idle <名称>` / `Something went wrong <名称>`，行内 `More options`）▸ `Resize sidebar`（AXSplitter）▸ 账户行 `ze Gateway`

### 10.3 主区（实测）
- 错误告警条：`Can't reach 127.0.0.1:15721` + `The provider didn't respond. Check your network or VPN, then try again.` + **Details / Open Setup / Check again** 三按钮 + Dismiss
- `Welcome back, ze`（hero）▸ `Sessions` 标题 ▸ 会话列表（`Needs input` / 名称 / 项目 / `3d ago`）
- Composer：`Local` ▸ `Cairn` ▸ `Add another folder` ▸ `Prompt` textarea ▸ Send ▸ `Add` ▸ **`Bypass permissions`** ▸ `Model: OpenRouter / minimax/minimax-m3.1-flash:free` ▸ `Effort: Extra` ▸ `Usage: Context 0` ▸ `Fast mode off`

### 10.4 与 Cairn 规范的关键出入（③）
| 项 | 真机 | Cairn 规范 § |
|---|---|---|
| 权限模式名 | **`Bypass permissions`** | §2.2 写"Manual/Accept edits/Plan/Auto/Bypass"——真机实测确为 `Bypass permissions`，但**四档分段的 UI 形态未实测到**（本次仅见 PopUpButton，未展开） |
| 视图三档 | 未在主区实测到（Composer 无 effort 分段控件，effort 在 PopUpButton 里） | §3.8 写"Normal/Thinking/Verbose" |
| 侧栏项目分组 | 项目名 + `New session in <项目>` + 会话行 | 规范未提"项目内新建"入口 |
| Composer 元素顺序 | 目录 Local / 项目 / 加目录 → 输入框 → Add / 权限 / 模型 / Effort / Usage | 规范 §3.2 未定序 |

---

## 11. 待补（诚实登记）

- **未测**：侧栏精确宽度（真机实测到侧栏/主区接缝在窗口内约 231/1400 缩放位，但窗口非原生尺寸，需原生 1× 重测才能给 pt 值）。规范写 242px，**本轮未证真或伪**。
- **未测**：会话行高 26px、字 13px、分组留白 12px、气沟 41px、回复右侧 56px——均需原生 1× 窗口截图逐项量。
- **未抽**：IPC 具体通道名（REA 实测 `literal_channels: 10` / `dynamic_channel_operations: 1524`，**绝大多数通道名是模板字符串动态拼接，静态不可恢复**）。
- **未抽**：`--cds-role-*` 57 个令牌的完整亮暗值对（本轮只抽到 accent 一支的接法，其余 5 个角色同构但未逐条记录）。
- **未做**：Cairn 侧现状审计（并行任务中）。
