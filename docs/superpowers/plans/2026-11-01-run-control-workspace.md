# 会话运行控制的工作区归属

持续优化目标下的下一批修复，目标保持 active。

事实：host 的 controller/steering 按裸 sessionId 存储；同时只允许同名 id 的一场 run。当前 cancel/steer 未核对 workspace，另一项目的同名会话可控制该 run。

方案：复用现有 controller 的 workspace、canonicalWorkspacePath 与注册根。控制请求传入 workspace；host 校验后只操作匹配的当前 controller/信箱。旧调用未传 workspace 时，仅允许无歧义的会话。失败返回结构化 code，renderer 不把目标冲突当作陈旧运行旗来自动出队。协议升级，旧 host/新 renderer 失配时继续使用现有版本闸。

- [x] 新增真实 host + 合成 runner 测试及真实 hook 测试，记录改前错误控制证据。
- [x] 修复协议、主进程接线、host 目标校验、renderer 插话/取消与删除前停止调用。
- [x] 验证正确/错误工作区、未注册与畸形参数、旧调用歧义、软链规范化和拒绝后队列保持。
- [x] 类型、定向/完整桌面、Electron IPC、边界、文档检查；当前代理按 OCR delegate 审查。

不新增依赖；不改 JSONL、冻结判卷或规则文件；保留共享工作树其他修改。队列持久化事务另行核查，不声称本批提供崩溃去重保证。

验证额外发现 macOS Dock 因缺失 cairn.png 在启动时抛错：保留现有资源删除，优先完整图标、其次 favicon，均缺失时不调用 Dock 图标覆盖。改前整应用 smoke 因图标失败，改后通过。详见 `outputs/run-control-workspace-2026-11-01/review.md`。
