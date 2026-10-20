# dsh-claude-style in Cairn

来源：[Nwflower/dsh-claude-style](https://github.com/Nwflower/dsh-claude-style)，版本 0.17.0，固定提交 `484ece039400ab45a97e935abb5bc47245845a96`。

Cairn 直接使用上游的配色/字体/动效令牌、画布样式、Markdown 排版和输入卡样式。`UPSTREAM.json` 记录原文件路径、SHA-256 和是否适配。`palette.css` 由上游 `tokens.json` 生成；`typography.css` 仅移除了依赖官方宿主字体路由的 `@font-face`。开源字体由 Cairn 适配层注册并经 Vite 打包。

官方插件依赖 DSH 的插件上下文、宿主 DOM 和私有路由。Cairn 不提供这些接口，因此本接入复用其视觉层，任务、权限、会话和窗格继续使用 Cairn 的现有实现。`../../dsh-claude-style.css` 负责令牌与 DOM 差异，不在上游文件内散布 Cairn 修改。

本次仅打包 Inter、Noto Serif、JetBrains Mono 的 OFL 字体；未引入上游排除 MIT 许可的 Anthropic 字体和 Clawd 帧图。源码与字体的许可随构建输出到 `licenses/dsh-claude-style/`。

离线重新生成：

```sh
node apps/desktop/scripts/sync-dsh-claude-style.mjs /path/to/dsh-claude-style
```

同步器要求源码位于上述固定提交。升级须显式更新提交，重新构建并运行桌面测试与 `layout-smoke.cjs`。
