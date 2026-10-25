# 提交幂等生产接入

基线提交：f8b86e4。证据覆盖当前工作树，不是 HEAD 认证。

## 修改

- `src/agent/loop.ts` 默认构造一个 run 实例内的 `SubmissionLedger`，按 agent 域与 tool-call id 推导 requestId。登记覆盖整个提交处理：日志、工具表/技能/权限拒绝、前后 hooks、普通工具与手动 verify。首次失败也保持原提交。
- 重发 id 不再追加另一条 tool_call；下一次模型请求仍读取第一次完整调用/回执。参数或工具名改变不会使同一 id 变成新调用，避免重复副作用及悬空调用。
- verify 的前置 hook 等待后复查取消，已取消时只落取消回执，不启动验证；验证期间取消也不启动后置 hook。
- `src/providers/openai.ts`、`anthropic.ts`、`gemini.ts` 的缺失调用 id 回落加逻辑请求域 UUID。每次真正新请求换前缀；同请求分片/安全重试保持前缀；已有原生 id 原样保留。OpenAI 非流式省略 index 时使用数组位置，避免同请求两笔都变成 call-undefined。

## 红绿证据

- 最初 loop 5 条回归：4 红、1 绿。真实临时文件显示 firstsecond、written 两次、verify 两次，以及先拒绝后执行。首次修复后 7 条全部通过，含跨 provider 轮次、独立 run 与取消；后续追加的环境重放收束回归见下。
- provider 调用身份 8 条：缺失 id 的四个分支全部红（两次请求仅 2 个不同 id，非流式甚至仅 1 个）；真实 id 的四支保持通过。修复后全部通过；另补 Gemini 原生响应 → adapter → loop → 临时文件贯通，断言 first/second 两次写入与第三次请求携带真实回执。
- `targeted-tests.log`：环境重放收束小修前的检查点，14 个测试文件、253 项通过，maxWorkers=2，exitCode=0。
- `typecheck.log`：tsc --noEmit 0 报错，exitCode=0。
- `boundary.log`：core 无反向 desktop/UI 依赖。
- 已用 OCR delegate preview（exclude 限定）选文件、delegate rule 解析规则，由当前代理独立审查；未运行 ocr review/scan。git diff --check 通过。

## 全量发现的环境验证重放收束回归

主任务的核心全量（maxWorkers=2）发现旧 `tests/verify-cause.test.ts` 固定重发 c1 的场景：幂等后只真跑一次环境验证，但每次重复都被当成新工具进展，最终 maxSteps 抛错。原判卷没有改。

新增回归先复现 maxSteps=3 抛错；最小修复让账本记住内部的 environment-red 控制态。仅当整轮提交全是已记录的环境验证失败重发，且没有新提交时，在流结束后正常收束，不重复执行、不制造第二条 verify_result、不增加 attempt/环境拍数。重发后同一流还有新工具或新 verify id，继续处理；普通重复工具不套这个收束规则。

`environment-replay-tests.log`：最新定向 6 文件、83 项通过（maxWorkers=2），包含原 verify-cause 的 19 条、验证归因出口、普通跨轮重复以及同轮修复/新验证。`environment-replay-typecheck.log` 记录本次小修后的类型检查。全量仍由主任务统一重跑，旧全量唯一失败不能直接算本次全量通过。

## 边界

账本在单个 run（包括 worker）内有效；run/进程重启后不承诺 exactly-once。没有无界全局缓存，没有持久化去重，没有新增依赖或付费模型请求。provider 若在同一 run 重用真实 id 表示另一笔新调用，会回用第一笔；这是 ADR 已记载的碰撞边界。缺失原生 id 的新请求只能使用新合成身份，不能凭相同参数猜测其是重发。

未代替主任务的核心全量、桌面全量、完整门或 HEAD 认证。未提交，仅修改本报告列出的 4 个生产文件并新增两个测试文件；保留共享树其他修改。
