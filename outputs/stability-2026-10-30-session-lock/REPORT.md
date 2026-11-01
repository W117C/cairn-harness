# 本地会话稳定性补齐（2026-10-30）

对象：`/Users/ze/Downloads/Cairn/cairn` 当前工作树；起始 HEAD `be9c0be5`。本批未提交，保留共享工作区原有改动。

## 已复现并修正

1. **崩溃锁并发回收允许多个写者。** 12 个获取调用并发回收同一把死 PID 锁，原实现 30 轮有 27 轮出现多个成功持有者，最多 4 个。先读后删的内容比较不是原子互斥。运行锁获取/回收现在与改名、删除共用根级短临界区，整轮执行仍只持有本会话的运行锁。
2. **坏锁记录与读取失败处理不一致。** `null` 会触发空值异常；PID 0/负数可能被当成进程组检查；非 ENOENT 的读取错误原先被当成没有锁。现在共用正 PID 校验与记录解析，只有 ENOENT 表示文件不存在，其余 IO 错误保留。
3. **非默认工作区保存偏好失败。** 保存模型/思考档原先只在默认会话根查找。现在复用 `resolveSessionRoot`；解析失败不回落到默认根。
4. **IPC 返回拒绝被界面吞掉。** Promise 正常 resolve 的 `{ ok: false, error }` 没有进入错误提示。模型与思考档现在共用 `saveSessionPrefs` 检查响应，沿既有错误提示路径显示拒因。

## 重构与回归

- 根互斥从 `session-repository.ts` 提取到 `session-mutation-lock.ts`，旧导出路径保留，避免运行锁经 repository/sessions 引入依赖环。
- 共享工作区另一处并发修改给根互斥加入了约 2 秒的有界等待。本批移除了重复的外层重试；中间的等待叠加超时保留在 `duplicate-wait-failure.log`。
- 真实四子进程回归分别检查：同一日志只有 1 个写者、四条不同日志均可启动、持有者 PID 对得上、退出释放后没有残留运行锁。
- 新增 15 条回归：运行锁 12 条、会话根解析 2 条、IPC 拒绝提示 1 条；保留原有测试断言，思考档接线哨兵随共享保存函数更新。
- 运行锁释放共用同一 Promise，重复释放不会产生第二次删除。
- 未加依赖。已核对 [proper-lockfile 的原生方案](https://github.com/moxystudio/node-proper-lockfile)；本批复用既有根互斥，不引入另一套 heartbeat/stale-timeout 规则。

## 最终验证

最终验证期间本批 10 个源/测试文件的 SHA-256 均未变化。

- core：`pnpm test:capped`（`--maxWorkers=2`），580 文件 / 7415 条通过，exit 0；原文 `core.log`。

- desktop：`pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts --maxWorkers=2`，271 文件 / 1821 条通过，exit 0；边界检查单独通过，原文 `desktop.log` / `boundary.log`。

- 根类型检查、桌面构建、core/desktop 边界、渲染层规则检查通过，原文见同目录日志。
- 定向回归 6 文件 / 30 条通过（`--maxWorkers=2`）；偏好 UI 定向回归 2 文件 / 8 条通过（`--maxWorkers=1`）。
- 全树 `git diff --check` 报其他文件的 3 处空白问题：`PROGRESS.md:29340`、`docs/superpowers/specs/2026-10-27-context-memory-quality-design.md:243`、`docs/superpowers/specs/2026-10-27-interop-ecosystem-design.md:129`。本批范围的差分空白检查通过，未替其他并发批次改写这些文档。
- 审查由当前 agent 完成；OCR 只执行 `delegate preview --exclude ...` 与 `delegate rule <paths>` 来选择范围和解析规则，没有运行模型驱动的 OCR review/scan。

## 证据边界与后续优先项

- 以上是当前工作树验证，未提交、未发布；没有运行针对提交的 `head-cert-check` 或 `mutate-verify`。
- 本批没有调用真实模型、做 Windows/跨机器/NFS 验证、签名/公证或外部 ACP/A2A 认证。这些仍按现有任务记录补真实证据。
- 跨工作区同名会话的**偏好/元数据隔离**仍需独立实测：当前内存偏好表与元数据仍以裸 sessionId 为键；本批修复的是会话根寻址与失败反馈，不把它宣称为完整的同名隔离认证。
- `STATE.md` / 历史计划的状态有漂移，不以旧复选框认定功能未实现；本批没有重写共享状态文档或代理规则。
- 没有新增 Electron 交互截图；偏好失败反馈由真实保存函数的行为测试、生产接线断言与桌面套件验证。

`task.patch` 是针对本批修改前工作树的增量，排除了已有业务改动；它依赖那些原有未提交实现，不是可直接套到起始 HEAD 的独立补丁。`scope-sha256.json` 用于核对本批 10 个源/测试文件在最终验证期间的稳定性。
