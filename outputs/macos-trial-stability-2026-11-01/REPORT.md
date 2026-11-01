# macOS 内测稳定性修复 · 2026-11-01

对象：`/Users/ze/Downloads/Cairn/cairn` 共享工作树；基线 HEAD `be9c0be5b6545d41ebdb891fc676b1e9a912f309`。产品修复未提交，保留其他会话已有修改；本目录验证证据单独入库，以满足台账的 Git 可回查要求。不是 HEAD 认证或跨机器认证。

用户明确暂不做 Apple Developer ID / 公证。本轮复用已有 ad-hoc 封装，只提供针对 Cairn.app 的隔离处置说明，不改系统 Gatekeeper。

## 已完成的修复

- 渲染分层：共享子流判据仍保持单源，精确登记 `src/agent/subflow.ts`；获准的纯依赖也递归接受原检查，防止经账本间接带入 IO、时钟、随机或模块级可变态。新增六项临时仓行为用例先红后绿，未放宽原断言。
- 资源：恢复已有 HEAD 中的品牌图标与仍被引用的字体，字节保持原样。其他删除项未恢复。
- 设置冒烟：控件由「搜索服务」改名为「服务商」后旧选择器失效；修复定位并让缺控件错误指出选择器，真实 main/preload 下保留网络请求、认证头、密钥不落明文及重载恢复验证。
- 终端冒烟：旧脚本缩到 760px（产品最小宽度 880px），检查器按产品规则主动收起后仍被拿来量网格。现在在可见宽度下验证缩窄/变矮/放大，并额外验证最小宽度下自动收起与用户重新展开，不改终端产品行为。
- 安装验证：复制出的 ad-hoc 应用缺少已有 mock-keychain 参数会阻塞在真实钥匙串授权。安装冒烟改用共享参数与严格成功凭据，超时强制结束；卸载优先 `diskutil eject`，再回退旧系统命令，避免留下本轮挂载卷。
- 构建来源：新包记录 `sourceCommit` / `sourceDirty`，旧包信息保持兼容，关于页显示来源。独立审查发现 staging 会污染 dirty 判定，已用实际临时 Git 仓用例复现并修复：先捕获来源，再创建 staging。
- 内测指南：随 DMG/ZIP 附安装说明，涵盖架构、单应用 quarantine、密钥配置、手工升级与反馈；不新增自动更新或遥测服务。

## 验证

| 面 | 结果 |
|---|---|
| 最终 core 全套 | `pnpm exec vitest run --config tests/vitest.config.ts --maxWorkers=1`：612 文件 / 7573 条通过，333.98 秒，exit 0 |
| Desktop 全套 | `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts --maxWorkers=1`：310 文件 / 2085 条通过 |
| 来源 / 包元数据 / 旧包兼容 | 4 文件 / 28 条通过，含审查问题的 RED→GREEN |
| 根 typecheck | 0 报错 |
| docs / desktop-boundary / renderer-layer | 通过 |
| 设置真实 Electron 冒烟 | 16/16 通过 |
| 终端真实 Electron 冒烟 | 9/9 通过；截图已目验 |
| 打包态与 DMG 安装态 | 均取得严格成功凭据；复制到源码树外启动通过；`codesign --verify --deep --strict` exit 0 |
| 单应用 quarantine 演练 | 临时副本加隔离属性 → 仅对该 app 执行移除 → 属性消失 → 真窗口冒烟通过；11.97 秒 |

首轮 core 全套在审查修复过程中有两项失败（安装脚本原文凭据、来源 helper 调用时序）；修复后定向 28/28，通过后冻结产品修改，重新运行完整 core。原失败日志保留，不把定向绿代替全套。

## 真实 hy3 验收

使用用户授权的本地兼容接口，凭据只进入运行进程，不写入仓库或报告。

| 任务 | 基线 | 独立复验 | Agent 退出 | 耗时 | 测试保持不变 |
|---|---|---|---|---|---|
| 修复 `clampAdd` 下界 | exit 1 | 3/3 通过 | 0 | 30.35 秒 | 是 |
| 同一会话续跑，添加复用现有函数的 `clampSubtract` | exit 1 | 7/7 通过 | 0 | 17.36 秒 | 是 |

两轮通过真实 CLI → 产品装配 → provider → 工具 → 会话日志路径；不是 demo。自动补验按既有信任规则明确跳过仓库探测命令，模型经受控 `run_shell` 执行测试，宿主另行独立复验。费用价格未知，未折成零。两个小任务不能当作真实任务成功率基准，也不证明桌面真实模型交互或其他机器可用。

## 产物与边界

- 产物：`apps/desktop/release-trial-20261101/Cairn.dmg`、`Cairn.app`、`build-info.json`、`安装说明.md`、`SHA256SUMS`。
- 版本 `0.2.0`，macOS arm64；来源基线如上，`sourceDirty: true`。包内两处本轮运行时代码已与当前源文件逐字核对。
- 安装盘 SHA-256：`e01af0120ef1fc27a52fb61c74e6a60c1e666f4cb815e8a14c9df34138065cde`。
- 另一台 Mac、真实钥匙串首启/升级、Intel、Windows/Linux 未验。打包态冒烟使用 mock keychain，不能替代真实钥匙串验证。
- 未运行当前提交的 `head-cert-check` / `mutate-verify`，未做远端发布或合并；当前仍为共享未提交工作树。
- 对本轮文件的 whitespace 检查通过；全工作树检查中其他批次已有的三处文档空白问题保持原样。

本目录保留真实模型摘要、脱敏控制台日志、冒烟红绿记录、包校验和与相对本轮临时基线的 `scoped.patch`。不含源码备份或凭据。
