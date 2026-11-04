# Cairn 桌面优化 · 2026-11-02

本批已在本地工作区实现并完成视觉复核，持续优化目标仍在进行。视觉以用户本次选择的 Claude 风格为准。工作目录为 `/Users/ze/Downloads/Cairn/cairn`，分支 `fix/spec-summary-double-count`，HEAD 为 `7e23cdd6d579b6cad86ae99b284cea96862f5465`。HEAD 不包含本批未提交改动。

## 本批改动

- 记忆页的“最近更新”开始真正按时间排序，项目/全局保持各自分组，非法时间放在末尾；搜索覆盖正文，并增加正文预览与明确的排序选择。紧凑摘要和工具动作并为一行；浅色元信息和搜索占位文字对比度提高到 7.73:1。
- 模型控制移到输入框右侧。修复长模型名不收缩的问题，保留上下文元信息；修复 `data-highlighted="false"` 仍被当作高亮、每行都有灰底的问题。
- 排队消息的正文和动作分组，正文最多预览两行；消息列表独立滚动，不再随队列无限增高。编辑、取消、重排、移除与保存契约保留。
- 侧栏新任务按钮改为轻量描边；筛选按钮支持方向键打开，Esc 返回触发器焦点。
- 插件页修复跨窄窗/侧栏切换后，“全部”错误沿用旧能力分类的问题；保留并验证已有的一组视图标签与一组能力分类。
- 页面标题统一为更克制的字号和字重。复用现有 React、Popover、图标与官方 token adapter，未添加依赖或修改 vendor 文件。

本批在共享脏工作区中逐处修改，未重置、暂存、提交或发布已有改动。后端、IPC、Provider、插件安装与信任规则没有在本批中修改。

## 验证范围

全部为工作区证据。Electron 使用真实 renderer、合成 AgentApi 和测试配置；截图不是用户真实项目或真实 Provider 运行记录。

- 桌面完整测试：311 个文件、2123 项通过（`vitest run --config vitest.config.ts --maxWorkers=2`，2 workers），见 `desktop-suite.log`。
- 对比度修正后的聚焦测试：7 个文件、59 项通过，见 `focused-tests.log`。
- Electron 页面和导航：51 项断言通过，包含正文搜索、列表/详情、状态保留、焦点、单一插件视图入口与对比度，见 `shell-checks.json`。
- Electron 队列：11 项断言通过，包含编辑 Enter 提交、Esc 取消、重排和保存，以及 1440×900、880×640、880×480 下输入框可见；见 `queue-checks.json`。
- 亮暗画廊均完成。长模型名实测被截断且上下文信息可见；非高亮行背景透明；模型分组没有孤立组头，见两份 `gallery-*.log`。
- 根目录类型检查为 0 报错，见 `root-typecheck.log`；桌面类型检查、renderer layering、desktop boundary 和 docs-check 通过。
- OCR 仅运行 delegate preview/rule 选文件和解析规则，代码审查由当前代理执行；未运行 `ocr review` 或 `ocr scan`。没有发现 `.codegraph/` 索引，使用定向搜索。
- 独立视觉复核最终为 `ship`，详细判定见 `REVIEW.md`。检测器留下两条既有侧栏宽度过渡 warning。

未运行核心全量套件、真实 Provider/联网插件安装、完整 Electron 持久化重启、Windows、签名、公证、打包或发布验证；没有提交、推送或运行 HEAD 认证。

## 前后截图

模型菜单之前：

![模型菜单之前](/Users/ze/Downloads/Cairn/cairn/outputs/desktop-refinement-2026-11-02/before-model.png)

模型菜单之后：

![模型菜单之后](/Users/ze/Downloads/Cairn/cairn/outputs/desktop-refinement-2026-11-02/after-model-light.png)

880 宽记忆页之前：

![记忆页之前](/Users/ze/Downloads/Cairn/cairn/outputs/desktop-refinement-2026-11-02/before-memory-880.png)

880 宽记忆页之后：

![记忆页之后](/Users/ze/Downloads/Cairn/cairn/outputs/desktop-refinement-2026-11-02/after-memory-880.png)

880×480 长队列：

![小高度窗口长队列](/Users/ze/Downloads/Cairn/cairn/outputs/desktop-refinement-2026-11-02/after-queue-short.png)

同目录还保留记忆详情、1120 宽度、插件页与深色截图。`source-hashes.json` 记录本批涉及的 renderer 文件状态。

## 继续优化的范围

这一批解决点名表面的已复现问题，不把整个桌面宣称为全部达标。下一批继续检查工具/浏览器首页、自动化与设置的重复入口和文案，以及长对话和多项目侧栏的显示细节。现有记忆存储、提取质量与插件实际安装能力需要独立的功能验收，不从本次界面通过推导结论。
