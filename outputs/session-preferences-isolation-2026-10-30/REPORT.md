# 会话偏好隔离（2026-10-30）

对象：`/Users/ze/Downloads/Cairn/cairn` 当前工作树。沿用上一轮本地稳定性改动，保留其他并发修改；本批未提交或发布。

## 复现与修复

- 同名会话 A/B 的旧偏好写入同一个 metadata id：实测保存 B 后，A/B 的磁盘投影都变成 B；内存 hydration 则只保留第一个相同 id 的选择。
- 模型、思考档的 hydration、选择、显示、运行请求和新会话初值统一使用已有的 workspace/session 键。
- 桌面保存由 host 确认登记工作区与唯一归属，写入 `<session>.jsonl.prefs.json`；原子写和根 mutation 锁复用既有实现。坏文件显式报错，拒绝覆盖。
- 旧 metadata 不改写。没有新 sidecar 且 id 只有一个登记归属时沿用旧选择；同名且归属不明时不猜。明确清空的 `{version:1}` 文件继续遮蔽旧选择，即使另一个同名会话后来消失。
- 队列与偏好 sidecar 共用会话改名/删除事务，目标冲突不覆盖，metadata 步骤失败时恢复日志与 sidecar。
- 发现实际 run 请求没有带目标 workspace，host 也未采用显式 workspace；现已补齐，后台同名会话请求使用目标工作区的模型、思考档和地址。首页预选思考档在创建会话时保存，保存失败仍提示并继续按用户选择执行。

## 验证

- core 全量：583 文件 / 7428 条通过，`pnpm exec vitest run --config tests/vitest.config.ts --maxWorkers=1`，exit 0，631.69 秒。本轮在其他 core 全量结束后单独运行，显式使用单 worker。

- 桌面全量：276 文件 / 1837 条通过，`pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts --maxWorkers=2`，exit 0。
- core 定向：5 文件 / 58 条通过（`--maxWorkers=2`）；桌面定向：7 文件 / 34 条通过（`--maxWorkers=2`）。
- 本批新增 20 条回归，覆盖同名独立保存、新 host 实例读回、旧偏好歧义、明确清空、非法工作区、坏 sidecar、并发补丁、改名/删除/回滚，以及真正发往 IPC 边界的 run 参数；另扩展首页思考档保存断言。
- 根类型检查、桌面构建、core/desktop 边界、渲染层检查通过；证据同目录日志。
- 文档检查通过；计划与交付报告已同步。
- 旧 running 接线哨兵同步增强为工作区归属检查，并由实际 host 行为回归验证；文件不在冻结表。当前 agent 按 OCR delegate 解析的规则审查，没有运行 OCR 模型审查命令；作用域增量见 `task.patch`。未改冻结判据、事件类型、全局设置或 IPC 协议签名。

- 同名会话在另一工作区仍有活动执行时明确拒绝第二场启动，不回落为向第一场插话；活动执行归属与界面当前归属分别记录。拒绝的后台执行不再回报“已启动”。
- 首轮 core 全量曾因并发批次将协议升到 43、旧断言暂留 42 而失败（7427 通过 / 1 失败）；该批次已同步断言，保留红样本。第二轮在另一套 core 全量并发时，`mutate-shards` 的真实工作树前置检查超过原有 15 秒预算（7427 通过 / 1 超时）；原文 `intermediate-core-parallel-failure.log`。未改超时或断言，等待并发结束后以单 worker 完成上述全量绿测；两次并发运行的失败仍保留，不视为通过。

## 取舍与边界

- 采用已有身份键、原子写及 sidecar 生命周期，无新增依赖。工作区状态与全局状态分开保存的成熟做法也见 [VS Code 官方存储说明](https://code.visualstudio.com/api/extension-capabilities/common-capabilities#data-storage)。
- 旧 metadata 继续保留，避免为了偏好隔离重写所有组织/审计字段。CLI/headless 的旧 handler 调用形态仍兼容；桌面产品入口使用新作用域保存路径。
- 持久化读回由真实文件和新 host 实例验证；没有新增完整 Electron 进程重启、跨机器、Windows/NFS 或真实模型调用认证。
- 标题/置顶/归档等其他 metadata、错误条、运行代际及计时并非本批的完整隔离改造。源码中仍有部分裸 sessionId 状态键，后续应单独复现和处理同名并发状态；本报告不把偏好隔离当成全会话隔离认证。
- 未运行针对提交的 `head-cert-check` / `mutate-verify`。所有读数属于当前工作树。

`task.patch` 基于本批修改前的工作树，依赖已有未提交实现，不是可直接应用到 HEAD 的独立交付提交。`scope-sha256.json` 覆盖本批 18 个源/测试文件的验证起点。验证期间主入口出现并发的对话/记忆导出重构，本批偏好接线未变，见 `entrypoint-routing.json`；合并入口已补类型/构建检查。最终 18 文件快照包含后续运行寻址与接线哨兵修正，单 worker 全量前后哈希一致。汇总见 `VALIDATION.json`，完整 core 日志见 `core.log`。
