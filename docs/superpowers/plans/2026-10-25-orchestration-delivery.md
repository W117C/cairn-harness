# 编排平台落地与复核

目标：实现新平台 P0–P4 可执行纵切，所有完成主张绑定可复跑证据。旧设计作为需求来源，不作为已实现事实。

## 实施裁决

- 当前仓库为 `/Users/ze/Downloads/Cairn/cairn`，共享工作树存在其他会话改动。本笔不混合提交，不改规则/全局配置。
- 复用既有事件种类、JSONL 存储、worker 与合并安全闸。编排信息放可选命名空间，旧日志缺字段即旧语义。
- IPC 按当前工作树版本递增，不能使用旧稿写死的 v21。尽量复用既有 cardAction 控制路径。
- worktree 不等于沙箱。后端必须逐项声明可强制能力；不支持的任务 fail-closed，不伪造执行能力。
- 计划、版本、任务、运行必须联合寻址；跨计划同名任务和旧运行迟到结果不得污染新运行。
- 生产者回执只触发 verifying；独立验证成功且版本相符、交付成功才 done。
- lease 过期只代表需要取消/确认旧执行器已停止，不足以直接派发第二个写者。
- 动态 Flow 不用 eval；支持范围必须由执行测试界定，未支持节点显式拒绝。
- 已研究 LangGraph / Temporal 的官方代码库和持久化文档：两者 MIT 且仍维护；本次复用项目 JSONL/worker，避免增加第二持久化运行时与 Temporal Service 运维依赖。

## 任务与验收

1. 领域模型/解析/Flow：拒绝环、坏版本、NaN/Infinity 预算、逃逸写域与无界动态派生；任务展开不超过 256。
2. 事件投影/调度：确定性、多计划命名空间、预算预留、保守租约、失败依赖、过期结果拒绝、独立验收。
3. 持久化执行：先写启动事件后调用后端；提交/控制幂等；暂停/取消/崩溃恢复；快照损坏回放 JSONL。
4. 本地后端/契约/工件：受限能力、读写执行、机器检查 + 独立 verifier、内容寻址、串行交付、失败不假绿。
5. 控制面：计划/任务/预算/异常与控制命令，桌面实际接线；headless API 可直接复跑。
6. 集成与收尾：100+ scripted DAG、重复提交、重启、取消、stale、预算/冲突反例；类型/边界/core/desktop/build；OCR delegate 审查；逐项记录未测边界。

测试顺序：每个运行分支先红测后最小实现；新测试独立文件，不改冻结判卷与旧 fixture。原地保留其他会话工作树；本笔文件清单与基线散列写入 outputs/orchestration-delivery-2026-10-25/。

## 当前进度（2026-10-25 独立提交树）

- **状态**：P0–P4 的本地可执行纵切已在独立树 `feat/orchestration-platform` 单笔落地；P5 真实收益与 P6 开放面不冒充完成。
- **编排内核**：9 个测试文件 / **143 条全绿**（`tests/orchestration-*.test.ts`，`--maxWorkers=2`）。
- **事件兼容与门**：events / event-type-coverage / stream-redaction / projection-invariant / readme 通道数 / src 执行路径 / IPC 版本，共 7 文件 / 71 条全绿。
- **桌面控制面**：3 个测试文件 / **8 条全绿**（编排 pane/host、协议版本）；桌面 `tsc` 0 报错，esbuild + vite build 绿。
- **静态检查**：根 `typecheck` 0 报错；`desktop-boundary-check` 绿；`renderer-layer-check` 绿；`arch-cycle-check` 登记债 1、新圈 0。
- **协议同步**：IPC v20（编排 view/submit/control 三通道）；README invoke 通道数 104 = 101 + 3。
- **未测边界**：provider wire gateway 的深测依赖尚未提交的 DeepSeek provider 批，留在工作树；本树只保留 fail-closed 覆盖。真实模型凭据未实测；桌面只有组件/主机测试与 build，未做真指针冒烟；本地后端 `max_concurrency: 1`（串行）；P3 的 race/动态控制与远程 worker 未实现，静态展开不支持的节点 fail-closed。
- **独立审查后的加固**：needs_you 可重试、done 不可 cancel/重复交付、异常不再全局停机、取消不再把预留记成花费、后端数据目录按会话隔离、预算/交付锁可回收死进程、交付 journal 可崩溃恢复、凭证路径不进入 overlay。
