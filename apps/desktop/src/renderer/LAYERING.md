# 渲染层分层契约（LAYERING）

这份文件是**代码旁的规矩**，不是现态页：它写的是"每一层许做什么、不许做什么"，
以及"新来的人怎么加一个状态簇"。现态（有多少文件、多少行、体积多少）**不写在这里**——
现态会漂，写进来就是下一轮要清的谎。请用命令去量：

```
node --import tsx scripts/renderer-layer-check.ts     # 四条不变量的机器面
pnpm --filter cairn-desktop test                      # 桌面判卷
node --import tsx scripts/typecheck.ts                # 类型面
```

---

## 一、目录与职责

```
apps/desktop/src/renderer/
  App.tsx        composition root：接线 + 顶层布局。不装实现。
  state/         状态簇钩子：只吐「状态 + 动作」。无 JSX、不 import components/。
  derived/       纯投影：事件流 → 视图数据。无时钟、无随机、无 IO、无 await。
  components/    展示组件：props 进、事件出。既有层，本轮未动。
  panes/         大面板 / 布局片段：从 App.tsx 的 JSX 里搬出来的。props 进、事件出。
  顶层 *.ts      工具模块（纯函数为主）：send-queue / projections 门面 / theme / toast …
```

方向是**单向**的：

```
derived/  ←  state/  ←  App.tsx  ←  panes/  ←  （用户事件）
   ↑            ↑                      ↑
   └ 纯投影      └ 状态                 └ 界面
```

- `derived/` 不知道任何上层存在。
- `state/` 不知道界面存在（所以不 import `components/`）。
- `panes/` 不知道 `App.tsx` 存在（所以不 import `App.tsx`）。
- 组件层与工具模块之间可以互相引用，但**不许反向引用 `state/` 或 `derived/`**。

---

## 二、四条机械不变量（机器判卷）

`scripts/renderer-layer-check.ts` 逐条判，违规时打印**规则号 + 文件:行**并以非零退出码收摊。
`tests/renderer-layer.test.ts` 在临时目录里造违规样本，钉"每条规则真的会红"。

### I1 —— 组件层与面板层不许回流 `App.tsx`

`components/**` 与 `panes/**` 不许 import `App.tsx`。
**为什么**：App 是 composition root；组件一旦 import App，模块图就成了环——
热更新时来回解析、单元测试拉起整个应用、"抽组件"变成"搬依赖"。

### I2 —— 状态层不许长出界面

`state/**` 不许 import `components/**`。
**为什么**：状态簇是"这个界面长什么样"的**数据面**；它一旦 import 组件，就等于把界面
复制了一份到状态层，两份会长歪（同一个字段两处默认值、同一处修一半）。

### I3 —— 派生层必须纯

`derived/**` 里的每个文件：
- 不读时钟（`Date.now` / `new Date` / `performance.now`）、
- 不取随机（`Math.random`）、
- 不同步等待（`await` / `async`）、
- 不 import 运行时/宿主模块（`node:*` / `electron`）、
- 不 import 未登记的运行时模块（白名单见脚本里的 `DERIVED_RUNTIME_ALLOWLIST`）、
- 不留模块级可变态（顶层 `let` / `var`）。

**为什么**：投影是"UI 状态 = 事件流"的纯函数。掺进时钟或随机，它就**不可判卷**——
判卷没法"真跑"它，只能退回读源码字符串（本仓吃过这个亏）。
需要时钟的形状是**把时钟当参数传进来**（`elapsedSecondsFor(startMap, sid, now)`）。

> 注释里写禁词不算犯规：判据先剥注释与字符串再扫。

### I4 —— 行数帽

- 渲染层每个 `.ts`/`.tsx`（`vendor/` 除外）**不超过通用帽**。
- `App.tsx` 另有一条**更紧**的帽（composition root 只该接线，不该装实现）。

两条帽都写在 `scripts/renderer-layer-check.ts` 顶部的常量里。
**阶梯**是往下走的：通用帽 → App.tsx 帽 → 更小的一档。每一档是后续批次的账，
**只许收紧，不许放松**；也不许先立一个够不到的数（那把尺会变成一句空话）。

---

## 三、怎么加一个状态簇

1. **挑一个边界清楚的簇**。判据：这个簇的状态能不能用一句话说清？
   （"侧栏与外观"、"输入与草稿"、"运行与队列"——说不清就别开新文件，先在 App 里待着。）

2. **新文件 `state/<簇名>.ts`**，导出一个钩子 `use<簇名>(deps)`：
   - `deps` 是它**需要从外面拿**的东西（别的簇的动作、App 层的 refs）；
   - 返回一个**普通对象**：`{ 状态, 动作 }`；
   - 钩子内部**不许有 JSX**（那属于 `panes/`），**不许 import `components/`**（I2）。

3. **搬代码时逐行原样搬**。判卷钉的往往是声明行与依赖数组的写法
   （`const openSession = useCallback`、`}, [` 的换行、缩进），搬家不改写法。
   若某段代码里出现了判卷按**位置**切片用的锚点（两个锚点必须同住一个文件），
   搬的时候要把**两个锚点一起搬**，或者把那段留在原处。

4. **App.tsx 里解构**：`const { a, b, c } = use<簇名>({ ... })`。
   解构出来的名字**保持与搬走前同名**——判卷按名字钉。

5. **跑判卷**：`node --import tsx scripts/renderer-layer-check.ts` 与
   `pnpm --filter cairn-desktop test`。两者都绿才算搬完。

---

## 四、搬 JSX 到 `panes/` 的规矩

- `panes/` 里的组件是**展示件**：props 进、事件出。
  状态在哪住，props 就从哪来（不要让面板自己去读全局态）。
- `panes/**` **不许 import `App.tsx`**（I1）。
- 懒加载组件（`lazy(() => import(...))`）要**跟着搬**：搬到别处就改成相对路径，
  **别把动态 import 改成静态 import**——那会把插件面板/设置页拖进主窗的静态闭包，
  体积门（`scripts/bundle-audit.mjs`）会当场变红。
- 搬出来的 JSX 若含判卷要认的**字面量**（如某个 className、某个 props 组合），
  那些字面量必须**原样留在新文件里**。

---

## 五、判卷读面（源码文本判卷怎么读文件）

桌面判卷里有相当一批用例是**读源码文本**断言接线形状的。拆分之后：
- 读单文件的断言若要跟着搬（锚点搬家），把它**指到新文件**；
- 钉"应用里有没有这段代码"的断言，读**应用外壳面**
  （`apps/desktop/tests/helpers/app-surface.ts` 的 `readAppSurface()`）；
- 钉"**App 自己**不许做 X"的断言，读**编排层**
  （同文件的 `readAppShell()`：App.tsx + state/ + derived/ + panes/）。

三者都是**读面迁移**，不是改断言：断言文本一个字都不许动。
