# F3 / ADR 0003 组件栈：裁决输入（2026-11-15）

- **状态**：裁决输入（未改 ADR 0003 的 D2、未加/删依赖、未迁移组件）。
- **问题**：ADR 0003 的 D2 推荐 `@radix-ui/themes`，但主应用从未采用；现状是 `@radix-ui/react-dropdown-menu`
  + 手写控件 + CDS token 三层混用。F3 要回答的是「到底选哪套、边界在哪」，不是再写一遍原则。
- **基线**：HEAD `c52ca3d5`（代码面 `907deda7`）；引用点都按本仓文件核过。

## 一、现状（有证据）

1. **ADR 0003 自己还挂着待确认**：`docs/adr/0003-desktop-ui-component-stack.md:3` 写「原则已接受；
   具体库选型待业主确认」，D2 的主库是 `@radix-ui/themes`（同文件 `:34-36`）。
2. **主应用没有 Radix Themes**：`apps/desktop/package.json:26` 只有 `@radix-ui/react-dropdown-menu`；
   `@radix-ui/themes` 只在预览包的 `apps/desktop/preview/package.json:12`，预览的 6 个文件 import 它
   （`apps/desktop/preview/src/{main.tsx,surfaces.tsx,SettingsPage.tsx,AppPage.tsx,PreviewApp.tsx,controls.tsx}`）。
3. **主应用实际用的是 Radix 原语，不是主题库**：14 个 renderer 文件 import
   `@radix-ui/react-dropdown-menu`（`apps/desktop/src/renderer/components/` 下，含 Sidebar、AccountMenu、
   PaneDock 等）；其余按钮/输入/弹层仍是手写。
4. **组件面很大**：`git ls-tree -r --name-only HEAD apps/desktop/src/renderer/components | wc -l` = 140 个文件；
   没有 `components/ui/` 这样的统一原语层。
5. **视觉契约已经独立于组件库**：CDS token 逐字节 vendored，`apps/desktop/tests/cds-parity.test.ts` 钉
   adapter 与 `outputs/cds-parity-verify/values.json` 的实测值；换主题库会先撞这条判据，而不是先撞产品。
6. **ADR 0003 的 D1 原则**是「标准控件优先来自组件库；禁止在页面里重写完整交互与样式」；现状满足的只有
   dropdown 一族，dialog/select/tooltip/switch 仍有手写实现。

## 二、四种选型

| 选项 | 含义 | 代价 | 与现状的关系 |
|---|---|---|---|
| **A. Radix Themes 进主应用** | 按 ADR D2 用完整主题库 | 140 个组件的视觉迁移；新增 `@radix-ui/themes`；与 CDS token 双主题层 | 预览已验证能看，但主应用要重做视觉契约 |
| **B. Radix Primitives + CDS（推荐）** | 只取无样式原语（dialog/select/tooltip/switch 等），视觉全走 CDS；建 `components/ui/` 薄封装 | 增量迁移；按需加 `@radix-ui/react-*` 小包；无新主题层 | 与现状最接近，只把「已经用的原语」变成明文规则 |
| **C. 全手写 + CDS** | 不引任何 UI 库 | 键盘/焦点/ARIA 每处自补；140 个文件继续分散 | 与「组件不要手写」的原始要求相反 |
| **D. 换 Ant/MUI 等整套库** | 完整设计语言 | 最大；与 CDS/Claude 视觉冲突 | ADR 0003 已排除 |

## 三、推荐：B（Radix Primitives + CDS）

1. **不把 Radix Themes 引进主应用**：它是一套完整主题语言，会和 CDS token 抢同一层；预览包保留它做设计沙盘
   即可（`apps/desktop/preview/` 不是产品面）。
2. **建立 `apps/desktop/src/renderer/components/ui/` 薄封装层**：每个原语只做三件事——套 CDS token、
   统一尺寸/图标、补产品语义；页面不直接 import `@radix-ui/react-*`。
3. **先迁 a11y 关键的三族**：Dialog / Select / Tooltip（现有手写实现最容易在焦点、Esc、portal 上漂）；
   DropdownMenu 已用原语，收进同一层即可。Switch/Checkbox 次之；Button/Input 的视觉壳可继续手写，
   但行为要复用原语或统一封装。
4. **判据**：新增 `ui-primitive-boundary.test.ts`（页面不得直接 import `@radix-ui/react-*`，只能从
   `components/ui` 进）；`cds-parity.test.ts` 继续钉视觉；每个迁移补一条键盘/Esc/焦点用例。
**2026-11-15 第一步已落**：`components/ui/dropdown-menu.tsx` 唯一入口 + boundary 判据（`de5e1d16`，第 1223 页）；
8 个页面 import 归一；`cmdk` 也收进 `ui/command.tsx`（`70f232d0`）；Dialog/Select/Tooltip 未迁，Themes 未引。

5. **与「自研」的关系**：ADR 0003 的原始要求是「组件不要手写，找优秀组件库」；UI 原语用 Radix 不违背
   「核心功能自研」。若业主把「自研」解释为「UI 也不许第三方」，那就只能选 C，代价是 a11y 维护回到手写；
   这个口径要单独回答。

## 四、若批准 B，实施顺序（先判据后迁移）

1. 建 `components/ui/` 与 boundary 判据（先红后绿，证明页面真的不能再直连原语）。
2. 收 DropdownMenu（14 个 import 先归一到一层，行为不变）。
3. 迁 Dialog / Select / Tooltip 各一批；每批带键盘/Esc/焦点/portal 判据。
4. 更新 ADR 0003：D2 从「Radix Themes」改为「Radix Primitives + CDS」，状态改为「已接受」。

## 五、未决（需业主回答）

1. 选 A / B / C / D 哪个？
2. 「自研」是否允许 UI 原语使用 Radix（B）？还是 UI 也必须全手写（C）？
3. 若 B：先迁 Dialog / Select / Tooltip 三族，还是只收 DropdownMenu 一层？
4. 预览包继续保留 `@radix-ui/themes` 做设计沙盘吗？

## 六、参考

- `docs/adr/0003-desktop-ui-component-stack.md`（D1/D2 与状态）
- `apps/desktop/package.json:26`、`apps/desktop/preview/package.json:12`
- `apps/desktop/tests/cds-parity.test.ts`、`apps/desktop/src/renderer/cds-adapter.css`
- `apps/desktop/src/renderer/components/`（140 个文件；14 个 DropdownMenu import）
