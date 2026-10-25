# 未完成事项再核对

继续目标：完成当前 Cairn 已授权的开放工作。起点 `d059c02deac8d7cd774d4aa8c6efe5f55b8566c7`；延续 `outputs/all-open-2026-10-22/PLAN.md`，保留用户 `ab.py` 和另一会话的两个 HEAD 认证证据目录，不混入改动。

## 已有成果与本轮边界

旧工作树的 renderer 拆分、文件面板、自进化修复、审计生命周期和搜索接线已经进入 `508bd2de` 等后续提交，本轮不重复重做。旧 HEAD 认证不能覆盖当前新增改动。`d059c02d` 的另一会话认证有超时失败，不能替它声称全绿；本轮不终止它的进程。

## 本轮实时进度

- [x] 真机复现并修复窗口工作区串用：从 A 弹出文件窗格，主窗切 B 后弹窗误读 B；主窗清空也影响弹窗。红面 6 项中 3 项失败；最终生产 main + preload + renderer 脚本扩展为 13/13，包括根闸、同名跨项目 KernelHost open 与命令面板正文检索/打开。先注入最近 run=B，确认清空主窗后不会回落去读 B。
- [x] 窗口归属使用可信 IPC sender 和 Node 原生 AsyncLocalStorage；WeakMap 保存各窗口选择，调用保存快照；晚到的选择和已关闭窗口不能复活旧状态。新增单元 7/7；相关 5 文件 47/47；桌面全量当时为 198 文件、1369 测试、maxWorkers=2、exit=0（后续修改需重验）。
- [x] 契约脚本实际执行 43 项，覆盖指针物理日志、父链失败、在飞状态和提交执行次数。原先只执行游标部分；此处通过不等于产品入口已经接线。
- [x] sessionSearch 真机复验：修复 unavailable 中文状态、A/B 同 id 的标题/高亮串用；针对夹具边界的真实 renderer 检查最终 23/23、0 skipped，9 文件 72 测试（maxWorkers=2）通过，构建通过。生产 main 的注册根/KernelHost/真实命令面板链路另由上述 13 项脚本覆盖。详见 search-runtime/REPORT.md。
- [x] 提交幂等接入整个真实 loop（包括 verify / hooks），修复三个适配器缺失调用 id 的跨请求碰撞；先红后绿。首次核心全量 469 文件、6475 测试（maxWorkers=2）中仅原 verify-cause 一项失败：重复环境红 verify 因不再执行新验证而撞 maxSteps。已修为只在整轮都是已记录环境红重发、没有新提交时收束，不造样本；原判卷未改。定向 83 项通过；修复后核心全量 469 文件、6477 测试（maxWorkers=2）全部通过，exit=0。详见 submission-runtime/REPORT.md。
- [ ] 指针分叉生产接入：CLI 与桌面仍用复制原语。业主已批准完整接入方向和书面设计；实施计划已获批准，执行方式为当前会话顺序实施；先验收/单独提交当前修复，再创建隔离工作树，尚未实施新的引用协议。设计与计划在 docs/superpowers 对应目录；不把 helper 和 43 项契约测试当产品已接线。
- [ ] 最终工作树 core（maxWorkers=2）/desktop/typecheck/边界/规则门、OCR delegate 后独立审查、文档对齐。

## 证据

- `workspace-red.json` / `workspace-red.log`：真实 main + 真实 preload + 构建 renderer，临时 profile 与两个临时项目，无模型请求。脚本启动最初因 appPath 不匹配被可信来源闸拒绝；修正 harness appPath 后才取得此处逻辑红面。
- `workspace-green.json` / `workspace-green.log`：同链路绿面；不靠 mock 替换文件/路径通道。
- `desktop.log`：当时桌面全量，后续 agent 改动不在该快照覆盖内。
- `core-capped.log`：首次全量失败的真实原文；`core-capped-final.log`：上述收束修复后的核心全量，469 文件、6477 测试，maxWorkers=2，exit=0。
- 可复跑入口：`apps/desktop/scripts/workspace-owner-smoke.cjs`；先构建 desktop，用 Electron 运行并传证据 JSON 路径。必须移除 `ELECTRON_RUN_AS_NODE`。

## 保持的外部边界

真实模型收益仍需凭据和明确付费授权；Radix 首屏体积与首次展开延迟的取舍、工具失败正文颜色、SEMA Phase 4 自动安装保持原裁决边界。它们不能冒充已验证收益，也不因泛化目标自动获准改变规则或花费。

未改 AGENTS.md。用户批准的四类路径展开已在起点提交链中完成，本轮不额外修改 agent 规则。
