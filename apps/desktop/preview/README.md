# Cairn 真实组件预览

这一层回答一个问题：**用组件库实现出来之后，到底长什么样。**

三层分工：

| 层 | 文件 | 职责 |
|---|---|---|
| 视觉意图稿 | `apps/desktop/design/v3-lite.html` | 布局、信息层级、分区、交互流向。手写 HTML/CSS，只表达"要什么"。 |
| 设计 token | `preview/src/theme.css` | 颜色、间距、字号、圆角、阴影的取值。预览与产品共用一份。 |
| 真组件预览 | 本目录 | 用真实组件库渲染基础控件、Composer、侧栏行、设置页、命令面板。 |

## 运行

```sh
pnpm --filter cairn-desktop preview:ui
```

或者在本目录直接跑：

```sh
pnpm --dir apps/desktop/preview dev
```

默认端口 `4188`（`strictPort`，被占用会直接报错而不是漂到别的端口）。

## 组件栈

依据 `docs/adr/0003-desktop-ui-component-stack.md`：

- 主库：`@radix-ui/themes`（Button / Select / Switch / Dialog / Tabs / ScrollArea / Tooltip / Badge / Callout / Card …）
- 图标：`lucide-react`
- 命令面板：`cmdk`
- 提示回执：`sonner`
- 三栏拖拽：`react-resizable-panels`

## 边界

- 这里不接 `window.agent`，不发 IPC，不执行任务；纯前端渲染。
- 这里不复制产品业务逻辑；页面片段只用于确认组件外观与交互手感。
- 这里也不反过来定义产品行为。行为仍以 `apps/desktop/src/` 与核心事件流为准。
