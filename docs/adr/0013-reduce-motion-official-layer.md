# ADR 0013：应用内「减弱动效」要盖住官方组件层（机制早就在，覆盖面缺了一块）

- 状态：**已接受**——2026-11-12 业主令「按照我们调研的数据开始优化我们的项目」
- 日期：2026-11-12
- 决策者：仓库所有者
- 取代：`docs/adr/0010-claude-desktop-5x-benchmark.md` 第四节待办的第 5 条（该条把「机制」误当成「差距」——
  实情是**机制早已实装、覆盖面缺了官方组件层那一块**，见第二节）
- 关联：`apps/desktop/src/renderer/cds-components.css`、`apps/desktop/tests/cds-components.test.ts`、
  `apps/desktop/src/renderer/state/motion-pref.ts`、`apps/desktop/src/renderer/styles.css`

## 一、这条是从哪来的（不是凭空想的）

对标 Claude Desktop 5.1231.2 的实测：**上游的编译产物里 `[data-reduce-motion]` 钩子有 88 处**，
逐个组件族覆盖。本仓的对应机制在 **2026-10-28 第 758 页**就照上游做了
（`apps/desktop/src/renderer/state/motion-pref.ts`，文件头原话「对标 Claude 的 `data-reduce-motion` 根属性」）：
偏好（跟系统 / 应用内强制减弱）、localStorage 持久化、根属性 `html[data-reduce-motion="true"]`、
CSS 侧停动规则、JS 侧 `appMotionReduced()`（`useStickyScroll.ts` 的平滑滚动降级正在读它）。

⇒ **机制不是差距**。ADR 0010 把这条列成候选是**判错了**（更正见该 ADR 第四节第 5 条与台账第 1174 页）。

## 二、真正的缺口：官方组件层那一路没盖（实测）

本仓的「应用内减弱动效」规则只停**Cairn 自有**的几处动效
（`.md-word` / `.mp-name` / `.cursor` / `.cairn-loader path` / think 标签 / 工具簇标签…），
而**官方 CDS 组件层**（`vendor/cds-official/components.css`）里的动画**一条都没被覆盖**：

| 官方层里的动画 | 归属 | 系统偏好那条 | 应用内开关那条 |
|---|---|---|---|
| `cds-skeleton-breathe`（2s infinite，骨架呼吸） | `[data-cds=SkeletonGroup]` / `[data-cds=Skeleton]` | **停**（官方层自带 `@media (prefers-reduced-motion:reduce)` 块，7 处） | **不停** ← 缺口 |
| `cds-placeholder-reveal`（占位揭示） | 同上 | 停 | **不停** ← 缺口 |
| Card 按压过渡（5 条）/ MessageActions 显现 | `[data-cds=Card]` / `[data-cds=MessageActions]` | 停（transition:none） | **不停** ← 缺口 |

⇒ **用户在应用里把「减弱动效」打开，骨架照样呼吸、消息操作条照样显现**；
系统偏好那条（全局媒体查询）才停得住。两路入口本该等价，现在不等价。

## 三、修法：对官方组件层一刀切

在 `apps/desktop/src/renderer/cds-components.css`（Cairn 自己的层，晚于 adapter 载入 ⇒ 能压过官方层）加一条：

```css
html[data-reduce-motion="true"] body[data-dsh-claude-style] [data-cds] {
  animation-duration: .01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: .01ms !important;
}
```

三点取舍：

1. **整层一刀切，而不是逐族挂**。上游是逐族（88 处），逐族挂的代价是**上游每加一个带动画的组件，
   本仓就得补一条**；一刀切（`[data-cds]` 属性存在即命中）让未来的新族自动被覆盖。
2. **值用「立刻跑完」而不是 `animation: none`**。`animation: none` 会让动画停在**首帧**
   （骨架是暗的那一帧），看着像卡住；`.01ms` + 迭代 1 让它**落在最后一帧**——
   与上游骨架那族的写法（`animation-duration:.01ms;animation-iteration-count:1`）同语义，
   也与本仓全局媒体查询那条（`styles.css`）同值。
3. **`!important` 是必须的**：官方规则的选择器特异性更高
   （`body[data-dsh-claude-style] [data-cds=SkeletonGroup][data-motion=wave] [data-cds=Skeleton]`），
   靠书写顺序压不住。

## 四、判卷（`apps/desktop/tests/cds-components.test.ts` 新增 5 条）

1. 官方层**确实有动画**（这一格若为 0 条 ⇒ 下面的规则是空转）。
2. 官方层**每一条**带动画的规则都挂在 `[data-cds=…]` 上 ⇒ 整层规则**盖得住**（不是「大概盖得住」）。
3. 本仓层有那条整层规则，值与全局媒体查询那条一致，且带 `!important`。
4. 反向哨兵：不得改成 `animation: none`（停在首帧）。
5. 系统偏好那条仍在（两条入口都要在）。

取料用**顶层规则解析**（递归跳过 `@media`/`@supports` 外壳）而不是正则一把抓——
正则会把媒体查询的外壳当成选择器（`@media (prefers-reduced-motion:reduce){ … }` 的 prelude 里没有 `}`），
抓出来的「选择器」根本不是选择器 ⇒ 那条判据会假红（写第一版时真踩到了）。

### 红绿证明（现跑，四种失配各一）

| 造的红 | 变红的格 |
|---|---|
| 删掉整层减弱规则 | 「本仓层有那条整层规则」＋「不得改成 animation:none」 |
| 把它改成 `animation: none` | 「值与全局媒体查询那条一致」＋反向哨兵 |
| 去掉 `!important` | 「值与全局媒体查询那条一致」 |
| 官方层新增一条**不在** `[data-cds=]` 上的动画族（上游日后可能加的） | 「每条带动画的规则都挂在 `[data-cds=…]` 上」＋既有的「生成物每条规则都点名 data-cds」＋摘要对账 |

四条都红、还原后全绿。

## 五、边界

- 本批**零视觉改动**的承诺**不成立**：这条**就是**视觉改动（应用内开关下骨架不再呼吸）。
  真机观感（骨架静止时停在最后一帧是否好看）**归业主验收**；本机 Electron 起不来，本轮**未跑真机**。
- 覆盖范围只到 `[data-cds]` 这层：官方层里**不**带 `data-cds` 的族（如 `.cds-skel-sweep-band`）
  本来就没被抽进 vendor 层（抽取只取 `[data-cds=*]` 规则），本仓产物里不存在 ⇒ 无需处理。
- 本仓**自有**动效的停动规则仍散在 `styles.css` 与 `stream-process.css` 两处，
  与本条**并存**（本条只管官方层）；把两边合并成一块是另一次重构，本批不做。
