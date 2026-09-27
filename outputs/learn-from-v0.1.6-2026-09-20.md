# 向 v0.1.6-alpha.2 桌面端设计学习的结论与落地

**参照**：`/Users/ze/Downloads/deepseek-harness-dsh-v0.1.6-alpha.2`（同一项目的更新版源码，9-17）
** ours**：`~/Downloads/deepseek harness`（当前工作副本）
**结论**：学到了 5 件可落地的、2 件刻意不搬的。全部已验证：build ✅ / 结构门禁 84/84 ✅ / 可访问性 3/3 ✅ / 测试 123 文件 1154 项 ✅

---

## 一、先看清对方是什么

v0.1.6 的桌面端**不是一个 2000 行的 `index.html`**，而是：

```
apps/desktop      极薄的 Electron 壳（只有 强制更新门 / 更新弹窗 / 策略登录页，共 261 行）
apps/web          壳，真正 UI 来自 @deepseek-ai/dsh-client-web
packages/client/  约 50 个 ui-* 包：ui-chat / ui-sidebar / ui-settings-* / ui-theme / ui-primitives …
                  每个包 CSS Modules，样式与组件同目录
```

所以「学它的桌面端设计」真正该学的不是某个组件的写法，而是它的**设计语言**——集中在
`packages/client/ui-theme/src/styles/`（`design-platform.css` 346 行令牌表 + `corner-shape.css` + `scrollbar.css`）。

## 二、它的设计语言：五条可迁移的原则（附证据）

### 1. 三层令牌命名：static → alias → specific

```
--dsw-static-neutral-bluish-850        原始色阶（只有色值，没有语义）
--dsw-alias-bg-layer-2                 语义角色（背景第 2 层 / 文字第 1~3 级 / 边框 l1~l4）
--dsw-specific-sidebar-fill            具体场景（侧栏填充 / 气泡 / 菜单 / 提示）
```

层级不是靠「猜这个灰能不能用」，而是有名有姓。**这是我们最值得学的一条**——上一轮我把
阴影收敛成 2 级、z-index 收敛成 5 档，本质上是在手工做这件事，但它把"层级"直接做成了令牌体系。

### 2. 中性色是「偏蓝灰」，不是纯灰

`neutral-bluish-950 = rgb(21,21,23)`（近黑但带一丝冷调）、层级 950/900/875/850/800。
纯灰黑在深色界面里会显得"闷"，偏冷的黑才有通透感。

### 3. 边框用 alpha，而不是实色

暗色 `border-l1 = rgba(255,255,255,.06)`、`l2 = .12`、`l3 = .16`、`l4 = .2`——四档 alpha。
alpha 边框会与底色融合，比实色边框通透得多。

### 4. **0.5px 发丝线**（这是我们最容易抄、见效最快的一条）

组件里的真实写法：`border-bottom: 0.5px solid var(--dsw-alias-border-l2)`。
1px 在 Retina 上是"两条物理像素"，0.5px 是一条——视觉重量直接减半，精致感立刻上来。

### 5. **全局 superellipse(1.5) 平滑圆角**（最前沿的一条）

```css
@supports (corner-shape: superellipse(1.5)) {
  :root { --dsw-corner-shape: superellipse(1.5); }
  *, *::before, *::after { corner-shape: var(--dsw-corner-shape); }
}
```

所有圆角面沿超椭圆过渡（介于正圆与方圆之间）。注释里还写了一条很专业的约束：
**全圆形状必须显式退出**（配 `corner-shape: round`），因为超椭圆会把正圆压成方圆、把胶囊两端削平。

### 其他细节（记下，暂不用）

- 标题字重 **400**（不是 500/600）——克制到发丝级的字重
- 行高显式配对：14px/22px、12px/18px
- 动效 `cubic-bezier(0.4, 0, 0.2, 1)`，时长 0.1/0.2/0.3s 三档
- 正文字号可由用户调节，副文案 = 主字号 − 1（`--dsh-content-font-delta`）
- 滚动条有独立令牌（bg/hover 各两层）
- 一条很专业的注释：*Figma 的 font-weight 510（SF Pro 可变字重）在非可变字体平台会不可预测地跳档，所以这里一律写 500*

## 三、落地的五项（全部已验证）

| # | 改动 | 改法 | 证据 |
| --- | --- | --- | --- |
| 1 | **0.5px 发丝线** | `1px solid var(--border)` 全量 → `0.5px`（23 处）；焦点环与 1.5px 控件描边不动 | Retina 上一条物理像素，分隔线视觉重量减半 |
| 2 | **superellipse 平滑圆角** | `@supports` 守卫 + `--corner-shape` 令牌 + 通配选择器；注释写明全圆形状需显式退出 | 渐进增强，不支持则维持原样，零风险 |
| 3 | **暗色改冷调近黑** | `--bg` oklch(16.8% 0.012 **250**) → oklch(18.5% 0.006 **260**)，surface 三档同调；色度 0.012→0.006 | 从"暖灰黑"到"冷调近黑"，层级更通透 |
| 4 | **暗色边框 alpha 化** | `--border` oklch(30.5%) → `rgba(255,255,255,0.09)` | 与底色融合，不再有"描了一圈灰"的生硬感 |
| 5 | **标题字重降档** | 分区/卡片/空态标题 500→400，风险确认标题 600→500 | 字重越少越克制；只保留主按钮与当前项的 500 |

## 四、刻意不搬的两件（以及为什么）

**① 品牌蓝 `deepseek-500 = rgb(65,118,230)`**
我们有自己已经收敛好的强调色体系，而且上一轮刚把强调色引用从 106 降到 88。
搬它的蓝等于把刚做完的「强调色配额」作废，还引入第二套品牌色。

**② 三层令牌命名（static/alias/specific）与 50 包拆分**
这是**架构级**的，前提是 50 个包、每包 CSS Modules。在单文件里仿造三层命名只会多一层间接、
没有任何收益。值得学的是它背后的**思想**（层级要有名字），这个思想我们已经用
「阴影 2 级 / z-index 5 档 / 行高 4 档 / 字距 2 档」落实了。

## 五、过程中的一次取舍（值得记）

**`--border-strong` 不能跟着 alpha 化。**
第一次我把暗色 `--border-strong` 也改成 `rgba(255,255,255,0.20)`，a11y 门禁立刻红：
`composer-box` / `searchInput` 的边界对比度 **1.89:1 < 3:1**。
原因是这两个令牌承担的是**两种不同的事**：

- `--border` → 大量**分隔线**（装饰性，可 alpha，0.5px）
- `--border-strong` → **控件描边**（输入框、卡片边界——可访问性要求 ≥3:1，必须实色）

所以最终：`--border` alpha 化 + 0.5px；`--border-strong` 保持实色 `oklch(58% 0.006 260)`。
**教训：两个令牌名字相近不代表职责相近，改令牌前先看它被谁用。**

## 六、复现方式

```bash
pnpm build && pnpm renderer-arch-check && pnpm a11y-check && pnpm test
node --import tsx scripts/shots.ts --out /tmp/v9-shots --prefix v9   # 截图
```

改动全部在 `src/renderer/index.html`（纯 CSS，未动 DOM 与 JS）。
