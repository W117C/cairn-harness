# Cairn 故障修复与桌面主题接入

已修复可复现的本地端点、浏览器依赖边界、桌面构建与 CSS 解析问题，并按照用户指定接入 dsh-claude-style 的视觉源码。

本报告记录工作树验证。仓库 HEAD 为 `29d1ea41c5ecb16fc3ecfc42025356b27fa823b1`；本次改动未提交，不能据此声称该 HEAD 已包含修复。原有其他会话的未提交改动已保留。

## 发现并修复的问题

| 问题 | 当前证据与处理 |
| --- | --- |
| 本地模型端点被拒，部分私网地址识别失效 | 基线核心测试出现 6 个失败，分布于 provider-config、provider-setup、model-discovery-io。临时 IP 正则把数字写成了字母 d；恢复 Node 标准库 isIP。相关 4 文件、57 项检查通过，最终核心全套通过。 |
| 为解决浏览器打包而削弱核心校验 | CustomProviderForm → provider-draft → provider-config 的运行时导入链把 node:net 带入浏览器。提取零平台依赖的 provider-identifiers，两侧共用规则，原导出保留。新增浏览器打包回归测试，反接旧导入时确实因 node:net 失败，恢复后通过。 |
| 桌面测试绿而桌面构建失败 | Radix SubContent 被传入不支持的 side/align；两个测试调用漏传 Sidebar 新增必需字段。修正调用和夹具形状，未删除或放宽既有断言；生产构建及桌面 TypeScript 检查通过。 |
| CSS 解析警告 | tokens.css 的块注释中再次嵌套块注释，导致注释后半段被当作 CSS。修正注释写法，构建中的 CSS 语法警告消失。 |
| 侧栏任务标题被时间挤压 | 标题和时间分两行，草稿/隔离标记进入次要信息行。相同约 187px 行宽下，标题可用宽度由 103.3px 增至 157.5px；时间继续常显。 |
| 设置入口难以发现且展示固定 Z 头像 | 保留同一个菜单，入口改为有文字的“设置与偏好”；模型状态点仍可进入模型配置。 |
| 设置页带着旧任务上下文 | 设置打开时，顶栏显示“设置”并收起任务工具和目标附属内容，关闭后恢复原会话。 |
| 首页分组松散、窄窗信息被截断 | 标题、项目与输入区共用左缘；模型名称不再在窄窗被强制截到 110px，工具行可换行。设置表单限制阅读宽度，并在容器变窄时改为上下排列。 |
| 暗色链接难读 | 接入上游 Markdown 样式与亮暗令牌，暗色链接由默认深蓝改为上游 #8ab4f8。 |

## 按指定仓库接入

上游：[Nwflower/dsh-claude-style](https://github.com/Nwflower/dsh-claude-style)，版本 0.17.0，固定提交 `484ece039400ab45a97e935abb5bc47245845a96`。

直接复用上游 tokens.json、画布 CSS、Markdown 排版、输入卡样式、首页标题样式及 Inter / Noto Serif / JetBrains Mono 开源字体。16 个未修改文件的 SHA-256 已与上游核对；一个排版文件仅移除官方宿主字体路由的 @font-face。来源清单记录在 apps/desktop/src/renderer/vendor/dsh-claude-style/UPSTREAM.json，许可随构建输出到 licenses/dsh-claude-style/。

官方主题插件依赖官方 DSH 的插件上下文、宿主 DOM 与私有路由。Cairn 使用独立 React/Electron 界面，因此本次接入的是其视觉层；任务、权限、会话与窗格继续使用 Cairn 的实现。没有迁移官方 DSH 的后端、插件宿主、账户或付费功能。

## 逐步界面核对

以下均为本次构建的真实 React 组件，通过隔离 Electron 用户目录及合成 AgentApi 渲染；这些数据不是模型实跑结果。

1. **首页：通过。** 标题、项目、输入区左缘一致；设置入口可见。见 [01-home.png](final/01-home.png)。
2. **会话：通过。** 侧栏标题获得主行，时间独占次行；Markdown、代码与表格使用上游样式。见 [02-session.png](final/02-session.png)。
3. **880×700 窄窗：通过。** 输入框完整、无页面横向溢出，模型与“思考 关”可识别。见 [03-narrow.png](final/03-narrow.png)。
4. **系统暗色：通过。** 经 Electron nativeTheme 切换，Cairn 和上游标记同步，链接为 rgb(138,180,248)。见 [04-dark.png](final/04-dark.png)。
5. **设置：通过。** 顶栏不显示旧任务，表单宽度收敛。见 [05-settings.png](final/05-settings.png)。

独立截图复核结论：通过，五张最终截图未发现材料级可见缺陷。修复前截图保存在 before/，布局探针的原始读数在 [final/checks.json](final/checks.json)。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| pnpm test | 439 文件，6151/6151 通过；修复后核心源码未再变化 |
| pnpm --filter cairn-desktop test | 149 文件，1120/1120 通过；包含新增浏览器打包与主题标记回归测试 |
| pnpm --filter cairn-desktop build | 通过，包括 preload、Vite 和桌面 TypeScript 检查 |
| node --import tsx scripts/typecheck.ts | 0 条错误 |
| pnpm desktop-boundary-check | 通过，桌面测试命令也运行了边界检查 |
| layout-smoke.cjs | 8/8 有效界面断言通过，覆盖真实构建后的 renderer |
| pnpm docs-check | 受检项通过；STATE.md 缺失导致 3 项未检，UNVERIFIED=3 |
| node --check 两个新增桌面脚本、相关 git diff --check | 通过 |

原始日志位于本目录 logs/。

## 验证边界与剩余项

- 未使用真实密钥或模型验证端到端调用；本地端点修复覆盖配置校验、发现和保存的测试路径。
- 未运行 pnpm gates、HEAD mutation 或 HEAD certification；未提交的工作树结果不能替代提交认证。
- 生产入口约 514.65kB 的 chunk 大小警告仍在；这是现有入口体积问题，本次未提高警告阈值或关闭检查。
- 初轮机械扫描记录到 5 条现有宽度过渡/弹性缓动提示；它们不属于本次主题接入新增内容。上游适配层的扫描结果独立保存在 logs/。
- 截图不能证明完整无障碍合规；本次未做屏幕阅读器、全量缩放和真实模型交互检查。

复跑界面验证：先执行桌面构建，再从仓库根目录运行 `pnpm --filter cairn-desktop exec electron scripts/layout-smoke.cjs <绝对输出目录>`。
