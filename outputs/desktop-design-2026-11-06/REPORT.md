# Cairn 桌面设计精修 · 2026-11-06

本轮保留现有奶油白、陶土色、48px 全局导航轨与工作台结构，优先修复已在真实 renderer 中复现的字体、可读性和点击目标问题。用户确认由本代理判断并直接实施。

代码位于 `/Users/ze/Downloads/Cairn/cairn`，分支 `fix/spec-summary-double-count`，基线 HEAD `fc6e3638`。结果覆盖当前未提交工作树；共享工作区其他会话的改动已保留。

## 已实施

- 恢复现有 `UPSTREAM.json` 已登记但缺失的 Inter 和 JetBrains Mono 正体文件。两份字体均从清单锁定的上游 revision 取回，写入前校验 SHA-256；已有 OFL 许可文件保留。未修改 vendor CSS、官方 CDS token 或版本清单，也未引入新依赖。
- 回复正文、加粗文字和表格统一使用 UI 无衬线字体。代码继续使用独立等宽字体，并把系统等宽字体放到中文字体之前，改善字体加载失败时的回退。
- 侧栏项目菜单、新任务、会话菜单和时间分组开关达到至少 28px 点击目标；同步增加标题与紧凑模式标记的避让空间。
- 会话时间、时间分组、添加项目及输入提示改用现有次级文字色，保持可读性。
- 浏览器审批卡分别显示“打开浏览器页面”“读取浏览器页面”“查找网页元素”，导航地址和元素选择器直接展示。仅改变展示投影，权限与执行规则不变。

## 实测

| 项目 | 修改前 | 修改后 |
| --- | --- | --- |
| Inter / JetBrains Mono | 两份资源缺失 | 离线 bundle 实际加载成功，摘要与清单一致 |
| 代码 `iiiiiiii` / `WWWWWWWW` 宽度 | 32.52 / 113.76px | 72 / 72px |
| 侧栏三类小按钮 | 20 × 20px | 28 × 28px |
| 浅色会话时间对比度 | 2.73:1 | 6.04:1 |
| 浅色分组及添加项目对比度 | 3.41:1 | 7.53:1 |
| 浅色输入提示对比度 | 3.59:1 | 7.94:1 |

最终检查的四类辅助文字，在亮暗主题下均达到 4.5:1；深色最低实测为会话时间 7.11:1。字体、颜色和几何读数来自真实 Electron 的 computed style、字体加载状态及 canvas 度量。测试使用合成 AgentApi、演示数据和临时用户配置，不调用真实 Provider。

## 验证记录

- `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts --maxWorkers=2`：331 文件、2,280 项通过，并发 2。见 [desktop-tests.log](desktop-tests.log)。
- 新增字体资源测试先复现两份缺失文件；新增浏览器审批说明测试先复现三种 JSON 兜底展示，修改后通过。首次全量测试中的 `approval-coverage.test.ts` 两项失败已通过补齐展示映射修复，未改原有断言。
- `desktop-readability-smoke.cjs`：21 项通过，覆盖 1440×900、1120×720、880×640，亮暗主题、输入框边界、点击目标、字体实际加载与等宽性、辅助文字对比度、模型菜单及 Esc 焦点返回。见 [checks.json](after/checks.json) 和 [smoke.log](smoke.log)。
- `node --import tsx scripts/typecheck.ts`：通过，0 报错。
- `pnpm renderer-layer-check`、`pnpm desktop-boundary-check`：通过。
- 隔离 Vite 构建通过，无字体缺失警告，未覆盖共享 `dist`。见 [build.log](build.log)。
- 本代理按 OCR delegate 选文件并解析规则后审查本轮变更，未调用模型驱动的 `ocr review` 或 `ocr scan`。
- 本轮文件的 `git diff --check` 和新 smoke 的 `node --check` 通过。全工作区 diff 检查另发现已有 `tests/projection-invariant.test.ts:287` 的 EOF 空行，未改动该文件。

设计 detector 对两个样式文件报告两条已有侧栏 `transition: width` 警告（`styles.css:161,176`），不在本轮变更行内，未宣称静态扫描全绿。见 [detector.json](detector.json)。旧 `ui-gallery.cjs` 仍依赖旧版模型菜单选择器，基线检查失败；本轮新增了使用当前菜单和真实输入事件的可复跑检查，未声称旧画廊已修复。

## 前后截图

真实 Electron 窗口，演示数据；Retina 位图尺寸为 CSS 窗口的两倍。

| 场景 | 修改前 | 修改后 |
| --- | --- | --- |
| 浅色 1440px | [截图](before/conversation-light-1440.png) | [截图](after/conversation-light-1440.png) |
| 深色 880px | [截图](before/conversation-dark-880.png) | [截图](after/conversation-dark-880.png) |

本轮源文件范围：`dsh-claude-style.css`、`styles.css`、`components/cards.ts`、两份恢复的字体资源、`font-resources.test.ts`、`browser-approval-description.test.ts`、`desktop-readability-smoke.cjs`。`styles.css` 的既有大部分 diff 属于前序工作，本轮不将其认领为新增设计。

未提交、未发布，未运行 HEAD 认证、mutation 或完整核心 gates。上述证据不代表真实 Provider、打包安装或已发布应用的验证。
