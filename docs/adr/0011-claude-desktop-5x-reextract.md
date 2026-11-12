# ADR 0011：CDS 重抽取到上游 5.1231.2 ＋ 新增「上游漂移」判据

- 状态：**已接受**——2026-11-12 业主令「按照我们调研的数据开始优化我们的项目」
- 日期：2026-11-12
- 决策者：仓库所有者
- 取代：`docs/adr/0010-claude-desktop-5x-benchmark.md` 第四节待办的第 1、2 条（**其余三条仍在**：桥面归属域、`[data-reduce-motion]` 属性开关、插件描述写法对标）
- 关联：`apps/desktop/src/renderer/vendor/cds-official/`（五件产物）、`apps/desktop/tests/cds-parity.test.ts`、
  `apps/desktop/tests/cds-components.test.ts`、`apps/desktop/tests/cds-upstream-drift.test.ts`（新）、
  `apps/desktop/scripts/extract-cds-tokens.py`、`apps/desktop/scripts/extract-cds-components.mjs`、
  `outputs/claude-desktop-benchmark-2026-11-12/`

## 一、这一批落地的是哪两件事

ADR 0010 是**只出报告**的一轮（业主定案），它把差距排成五条待办。本批落地其中两条：

1. **CDS 重抽取**：仓库 vendored 的 CDS 停在 Claude Desktop **3.6556.2**，本机上游已是 **5.1231.2**，
   两边的令牌薄、渲染层 CSS、组件集全部对不上（ADR 0010 第三节的实测）。
2. **漂移判据**：ADR 0010 指出 `cds-parity.test.ts` 钉的是「vendored 自身与记录一致」而非「vendored 与本机上游一致」，
   ⇒ **上游每更新一次都是静默漂移**。这一批补上那道会响的门。

## 二、重抽取的实测结果（全部现跑，命令见下）

| 项 | 3.6556.2（旧） | 5.1231.2（新） |
|---|---|---|
| tokens 字节 / 声明 / 名 | 41,505 / 1,021 / 704 | **38,918 / 957 / 674** |
| 令牌成员 | `.vite/build/index.chunk-CbnfBP-3.js` | `.vite/build/index.chunk-SLtcb4nU.js` |
| 渲染层 CSS | `MainWindowPage-BjVtjJFx.css`（237,153 B） | `MainWindowPage-CinbABxl.css`（246,160 B） |
| 组件数 / 规则 / 声明 | 45 / 115 / 465 | **48 / 112 / 468** |

- **令牌级**：新增 0 个、删除 **30 个**（全是 git-diff 状态色族：`--fill-git-*` / `--on-git-*` / `--text-git-*` /
  `--bg-git-*` / `--border-git-*`）、同名字段改值 **1 个**（`--opacity-icon-secondary` 0.4 → 0.3）。
  ⇒ **本仓对这 30 个令牌与那个改值零消费**（`grep` 命中的 54 处全在 vendored 薄自身），
  重抽取时它们被自然带走，**不需要本仓先做适配**。
- **上游还改了 body 字号轴的命名**：`--cds-font-size-body--textsm` / `--textmd` 不再存在，
  现为 `--cds-font-size-body--xs`（comfortable .8125rem = 13px）/ `--own`（.875rem = 14px）/ `--sm` / `--lg`（.9375rem = 15px）。
  ⇒ 本仓**没有引用**这些名字（它们只活在编译产物里），无影响；但 `UPSTREAM.json` 的 `quotedFacts` 已按新名重测。
- **组件集**：上游新增 `CellChartContainer` / `CoachMark` / `ShimmerText` / `Spinner` 四个、删掉 `Heatmap`；
  `Prose` 从 13 条规则 33 声明缩到 **3 条 10 声明**（只剩 `@media print`）。

### 对本仓消费面的影响（现读核过，零冲击）

- 本仓 `cds-components.css` 消费的 6 个官方契约变量（`--cds-message-bubble-measure/radius/pad-y/pad-x`、
  `--cds-assistant-message-text-stop/inset`）在新抽取里**全部仍有定义**。
- 本仓的正文排版**不吃**上游私有 `--_prose-*` 变量（自己的端口：官方 em 标题阶 + 自有 font-size/leading 令牌），
  ⇒ 上游把 prose 的屏幕排版规则撤出 CDS 层，本仓无感。
- 骨架呼吸关键帧 `cds-skeleton-breathe` 与其选择器在新抽取里**仍在**。

## 三、组件账的逐条重判（`component-map.json`：45 → 48 条）

旧账的三档语义含混：有 5 个条目（`Button` / `ButtonGroup` / `ModelSelector` / `ModelSelectorEffort` /
`SplitDropdownButton`）被记成 `no-component-css`，但它们在官方产物里**各自有 1–3 条规则**（只是触摸设备与
screen 媒体查询下的 margin 补偿），「无组件 CSS」这句话在字面上是假的。本批把三档含义钉死并写进账的 `note`：

- `ported`＝Cairn 消费该组件的官方契约（须给 Cairn 选择器）；
- `no-cairn-counterpart`＝官方有规则但 Cairn 无对应形态、规则无处落；
- `no-component-css`＝官方产物里**没有**该组件的规则体（只在 Tailwind 工具类里被引用）。

于是那 5 条改判为 `no-cairn-counterpart`（`Pulse` 与新增的 `Spinner` 才是真正的 `no-component-css`，各 0 条规则），
新账 **ported 10 / no-cairn-counterpart 36 / no-component-css 2**，每条理由 ≥ 20 字且写明「为什么落不下去」。
四个新组件的裁决：**`ShimmerText`** 记 `no-cairn-counterpart`（ADR 0009 已裁决本仓走 Codex 的逐词到达、
不做扫光克隆层，两条不叠加）；**`CoachMark`**（Cairn 无引导气泡形态）、**`CellChartContainer`**（Cairn 无图表）
同理；**`Spinner`** 记 `no-component-css`。

## 四、新增的漂移判据（`apps/desktop/tests/cds-upstream-drift.test.ts`）

**唯一事实源是仓库自己的抽取脚本**：判卷跑 `python3 apps/desktop/scripts/extract-cds-tokens.py --check`，
它读本机 Claude.app 的 app.asar 现算官方令牌薄与渲染层 CSS 的摘要，再与 `UPSTREAM.json` 的记录对账。
判卷**不另写一份 asar 解析**（另抄一份就是新的漂移面）。

三态（**缺席不许读成通过**）：

1. **上游在位** ⇒ 必须 `PASS`（上游动了而本仓没跟上 ⇒ 红）；
2. **上游缺席** ⇒ 这一格**未检**（skip，不是绿）；
3. **与机器无关的那部分**（上游版本与摘要的钉、判据自身的接线）**永远判**，CI 上也判。

### 红绿证明（现跑）

- **造漂移**（把记录里的令牌薄摘要改成假值，模拟「上游动了没跟上」）⇒ **3 条断言红**，其中包含真正的漂移面那条
  「vendored 必须与本机上游一致」；
- **还原** ⇒ **7/7 复绿**。

## 五、纠正一条错账（`cds-pill-pop`）

ADR 0010 与台账第 1171 页都写过一句「上游把 pill 弹跳拆形了，本仓照抄的是旧一代形状」。**那句话是错的**：
本仓 `apps/desktop/src/renderer/styles.css` 的 `mp-name-pop-up` / `mp-name-pop-down` 与 5.1231.2 的
`cds-pill-pop-up` / `cds-pill-pop-down` **关键帧体逐字相同**（`scale(1.32)`），
时间切分也相同（40% 上冲 + 60% overshoot 落回）⇒ **本仓不需要改代码**。
两代之间真正变的是**上游的关键帧命名**（单名 `cds-pill-pop` → `-up`/`-down` 一对，另新增 `cds-pill-roll-out` /
`cds-pill-out` 等），而本仓从不引用上游的关键帧名（自有 `mp-name-*`）。
⇒ 更正已落三处：ADR 0010 §三第 3 条、`outputs/claude-desktop-benchmark-2026-11-12/02-CDS-上游漂移差分.md` §三第 4 条、
ADR 0009 的 pill 段追记；台账第 1171 页按「只追加」纪律**不改**，由本页（第 1173 页）记更正。

## 六、复现命令

```bash
# 重抽（写 vendor 目录）
python3 apps/desktop/scripts/extract-cds-tokens.py --write apps/desktop/src/renderer/vendor/cds-official
node apps/desktop/scripts/extract-cds-components.mjs <新的 MainWindowPage-*.css> apps/desktop/src/renderer/vendor/cds-official
# 只核对（判定上游漂移）
python3 apps/desktop/scripts/extract-cds-tokens.py --check
```

## 七、边界（明确不冒充的）

- `component-map.json` 是**逐条人工裁决**，脚本生成不了；本批 48 条里改了 13 条的状态或理由、
  删了 1 条（`Heatmap`）、加了 4 条 ⇒ **人工判卷的部分无法自动化**，下次重抽仍要逐条过。
- 新上游 CSS 的**关键帧时长/缓动未逐条量**（只量了名单、时长令牌与 `cubic-bezier` 取值集合），
  故上游动效的细节差异仍可能存在未登记项。
- `cds-parity.test.ts` 与 `cds-components.test.ts` 里依赖**真机 renderer** 的那几格
  （`outputs/cds-parity-verify/values.json`）本轮**未跑**（本机 Electron 起不来）⇒ 那是 skip，**不是通过**。
- 本批**零视觉改动**：vendor 重抽后本仓消费面零变化（第二节三条现读核对），但**真机观感仍需业主验收**
  （本轮不构成「视觉已验」）。
- 本批未落地 ADR 0010 的其余三条待办（桥面归属域 / `[data-reduce-motion]` 属性开关 / 插件描述写法）。
