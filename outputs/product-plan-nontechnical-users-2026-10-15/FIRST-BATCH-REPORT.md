# 第一批执行报告（2026-10-15）

基线：分支 `fix/spec-summary-double-count`，HEAD `d7fe8556`，叠加其他会话在飞改动（见 INTEGRATION.md）。
本报告只记录**本会话实际执行并核对过**的内容；未执行的验证明确列在最后一节。

## 一、第一批 10 条的状态

| # | 计划条目 | 状态 | 落点 |
|---|---|---|---|
| 1 | 确认一页产品范围 | 完成 | `docs/adr/0004-desktop-first-nontechnical-audience.md`（受众/交付面/三类任务/支持边界/暂缓清单/验收口径） |
| 2 | 在飞改动集成范围 | 完成（清点与边界，未代提交） | `INTEGRATION.md`：169 条状态记录按功能区清点 + 建议提交批次 + 待确认项 |
| 3 | 修复语言补丁与 key 初值 | 完成 | `SettingsPanel.tsx`（`locale` 进 patch 白名单；key 缺省从选项集推导 = `glm`）；判卷更新 2 个测试文件 |
| 4 | 模型配置的连接状态与错误动作 | 完成 | `provider-connection.ts` + IPC `providerCheck` + 设置页「检查连接」（保存/发现模型/连接成功三态分开，失败带下一步；不耗 token） |
| 5 | 两条运行探针 | 完成 | `probes/run-probes.mts` + `probe.log`：static 0.0s 就绪、react-vite 真装依赖 12.1s 就绪，均 HTTP 200 |
| 6 | 模板初始化 → 自动预览 | 完成 | `project-templates.ts`（4 模板）+ `project-preview.ts`（static 进程内服务 / vite 受控子进程）+ IPC v6 + 侧栏「新建项目」→ 自动开浏览器窗格 |
| 7 | 每次修改保留可识别恢复点 | 已有能力接入交付卡 | 既有逐轮覆盖前快照 + `revertTurn`；交付卡新增「恢复上一版」（只对最后一轮） |
| 8 | 可理解的交付卡 | 完成 | `ChangeSummaryCard` 动作行：打开预览 / 恢复上一版 / 导出项目（+ 既有 改了什么/验证了什么/未验证/下一步） |
| 9 | 安装包复跑同一流程 | 完成（本机范围） | `Cairn.app` + `Cairn-macOS.zip` 构建成功；打包产物 `CAIRN_SMOKE=1` 复跑全链 PASS（含模板建项→预览→抓页面→停止） |
| 10 | 三位目标用户独立操作 | **未执行**（需要人） | 不可在本环境完成；试用协议与判据见 PLAN §11，可直接照做 |

## 二、本轮实跑证据

| 命令 | 结果 |
|---|---|
| `node --import tsx scripts/typecheck.ts` | 通过，0 报错 |
| `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts` | 380 文件 / 5389 测试通过（约 189s） |
| `pnpm --filter cairn-desktop test` | 22 文件 / 209 测试通过 + 边界检查绿 |
| `pnpm --filter cairn-desktop typecheck` | 通过 |
| `node --import tsx outputs/.../probes/run-probes.mts` | 2/2 PASS（static 200 / react-vite 200，12.1s 就绪） |
| `pnpm --filter cairn-desktop smoke` | PASS（2.6s）；含 v6 产品链探针与侧栏真点击 |
| `pnpm --filter cairn-desktop package` | `release/Cairn.app` + `release/Cairn-macOS.zip`（hdiutil 不可用按脚本降级 zip） |
| 打包产物 `CAIRN_SMOKE=1 …Cairn` | PASS（2.7s），product chain `created/preview ready/pageOk/stopped` 全真 |

设置缺陷的最小复现（修复后）：

```text
locale_patch={"locale":"en-US"}          # 修复前 {}
default_key_provider=glm | in_options=true | needs_key=true   # 修复前 deepseek 不在选项集
```

本轮修掉的集成缺陷：`CAIRN_SMOKE` 的侧栏探针仍用旧类名 `.sidebar`（v5 组件栈重写后根节点是
`aside.side`）且冒烟加载的是旧 `dist` ⇒ 冒烟恒红。修选择器 + 先构建再冒烟后恢复绿。

## 三、未执行 / 未验证（不许当成已完成）

- **真人试用**（三位目标用户、完成率与耗时指标）——需要人，未做。
- **干净机器安装**：本轮只在本机跑打包产物，未在无 Node/pnpm 的新机器验证。
- **真实模型跑通演示任务**（咖啡店页 → 改按钮 → 恢复 → 导出）：需要凭据与额度，未跑；
  已跑通的是模板/预览/导出/恢复的**工程链路**与 demo provider 冒烟。
- **`pnpm gates` 完整门禁**：本轮启动后被中断，未取得完整结果；`head-cert`、完整变异表未跑。
- **GUI 手工交互**：新的「新建项目」表单、连接检查、交付卡动作行只经静态渲染判卷与冒烟探针，
  未由人手在窗口中逐项点击。
- `hdiutil` 在本机不可用 ⇒ 未产出 DMG，只有 zip（脚本既定降级路径）。
