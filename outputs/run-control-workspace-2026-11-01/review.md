# 会话运行控制：工作区隔离与启动修复

本批已验证；持续优化目标保持 active。范围是共享工作树增量，未提交或发布。HEAD 仍为 `be9c0be5`，分支 `fix/spec-summary-double-count`；全套结果包括其他会话保留在工作树中的改动，不把它们归为本批成果。

## 修复

- `runCancel` / `runSteer` 从 renderer 经 IPC 传入目标工作区；host 复用已有 controller.workspace、注册根与 canonicalWorkspacePath 核验目标，不更改 owner。
- 控制校验与动作共用一个入口；等待旧调用的归属扫描后才读取当前 controller，随后的匹配与控制不再 await，避免拿陈旧 controller 或其他项目的信箱。
- 省略 workspace 的旧调用只在会话无歧义时允许；空值、畸形参数、未注册根和目标冲突明确拒绝。已取消的运行不会再确认接收插话。
- `RunControlResponse.code` 区分目标拒绝与运行已经结束；界面在目标拒绝时显示原因，不自动出队或续发。删除前的停止也携带目标工作区。
- 协议升级到 v50，沿用版本失配闸；同步版本及参数接线断言，没有降低已有调用数量或行为要求。
- 整应用验证另复现 macOS Dock 因 `cairn.png` 缺失而抛错。保留现有资源删除，选择已有完整 PNG 或 favicon；两者都缺席时不覆盖 Dock 图标。没有恢复他人删除的文件。当前 fallback 是已有 32px 品牌 favicon，正式打包图标仍需独立核验。

## 验证

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 改前回归 | 20 项中 8 项失败 | 真实 hook / host，runner 为合成边界；复现跨项目插话与取消拒绝后的错误续发 |
| 改后定向 | 7 文件，68 项通过，maxWorkers=2 | host、hook、队列接线、删除前停止、协议与来源绑定 |
| core 全套 | 601 文件，7,532 项通过，maxWorkers=2 | `pnpm test:capped`，当前工作树 |
| desktop 全套 | 298 文件，2,003 项通过，maxWorkers=2 | 图标回退之后再次完整运行 |
| Electron 真实 IPC | 8/8 通过 | 真实 preload / IPC / host / 脚本模型与审批门，隔离工作区；错误项目不能控制，正确项目可插话并取消 |
| Electron renderer | 12/12 通过 | 真实 renderer + 合成 IPC；发送与停止传工作区，拒绝原因可见，队列保留且不自动派发 |
| 整应用 smoke | PASS | 真实入口、隔离 profile 与工作区、本地 HTTP 加载隔离构建；建会话、队列往返、demo run、侧栏定位及模型菜单 |
| 类型 / 构建 / 边界 | 通过 | 根类型、桌面类型、隔离 Vite、preload esbuild、renderer-layer-check、desktop-boundary-check |
| 文档 / 补丁空白检查 | 通过 | docs-check / git diff --check |

整应用冒烟第一次被缺失 PNG 阻断（`electron.log`）；图标回退后一次 file:// 测试覆盖被既有 IPC 来源门拒绝（`electron-after.log`）。改用受信任的本地 HTTP 开发来源后通过（`electron-http.log`），未放宽来源校验。该 HTTP 服务仅用于这次验证，随后停止。

当前代理已用 OCR delegate preview 限制候选、rule 解析选中文件规则，并人工审查 `scoped.patch`（包括图标回退）；未运行 OCR 模型 review/scan，未委派子代理。未发现本批新增的阻断问题。冻结清单未修改。UI 错误提示截图已实际查看。

## 后续与边界

同名 id 仍只允许一场 host 执行，运行控制不再用这一限制推断用户目标。本批不等于所有裸 sessionId 运行计时/错误状态和菜单操作已完成工作区隔离。

后续继续核查队列保存失败后的派发与恢复、异步创建会话期间切换窗口，以及其他行级操作的精确寻址。没有新增依赖或改变 JSONL；本批复用已有框架，无需第三方实现选型。

没有验证真实 Provider、跨机器/网络分区、Windows/NFS、签名打包或正式发布。Electron 真实 IPC 采用脚本模型；已确认可取消审批等待，不据此声称真实服务全部正常。持续目标尚未完成。
