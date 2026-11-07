# 桌面端与内核审计收口 · 2026-11-05

接续上一段被中断的 Claude 审计会话。原始材料是 56 条 findings（`findings.json`，可读版见 `findings-readable.md`），覆盖桌面交互、渲染性能、会话日志、调度器、权限、provider 与 ACP。本轮先由三组只读核验（desktop 21 / core 14 / agent-providers 15）逐条对源码复核，再按「低风险、可判卷、高价值」落一批修复；其余进入后续批次，不一次性改完。

检查起点与交付面都是共享工作树，HEAD `fc6e3638`；本批改动**未提交**。

## 一、56 条核验总表

处置口径：

- **本批落地**：本轮直接改源码，并有定向或全量判卷覆盖。
- **已有工作树修复**：核验时共享工作树已存在对应改动，本批不重复改。
- **驳回**：核验认为 finding 描述的行为是刻意契约，不是缺陷。
- **刻意设计**：与 2026-10-31 R3 的密度裁决冲突，暂不强改。
- **延后**：真实缺陷，但涉及冻结语料、安全边界或跨层重构，另批处理。

| # | 面 | 级别 | 核验结论 | 处置 |
| --- | --- | --- | --- | --- |
| 1 | desktop | high | 切项目后旧 `activeId` 留在原工作区，下一次发送会串写 | 本批落地 |
| 2 | desktop | high | 后台会话每个非终态事件都 force 整树重渲染 | 本批落地 |
| 3 | desktop | high | 每条 delta 重跑全量转录投影 | 延后：投影增量重写 |
| 4 | core | high | 打开会话读三遍、IPC 送三份副本 | 延后：IPC 形状变更 |
| 5 | desktop | medium | 每次 run 收束整份读 JSONL 数行 | 延后：与 #21 的增量计数一起做 |
| 6 | desktop | medium | 收起 Inspector / 隐藏窗格仍跑全量投影 | 延后：渲染层性能批次 |
| 7 | desktop | medium | 运行状态两处重复、步数口径不同、aria-live 每秒播报 | 延后：状态条信息架构 |
| 8 | desktop | critical | ⌘↩ 打断时消息先插话再取消，文本被吞 | 已有工作树修复（`forceQueue`） |
| 9 | desktop | high | 全局 Escape 在二级输入框里误停本轮 | 本批落地 |
| 10 | desktop | high | 渲染层思考档白名单漏 `xhigh` | 已有工作树修复（`LEVELS` 已含 xhigh） |
| 11 | desktop | high | ChangesPane 评注跨会话残留，可发进另一会话 | 已有工作树修复（按 `sessionId` key 隔离） |
| 12 | desktop | high | ⌘K 切项目把已开会话改挂到新工作区 | 本批落地（与 #1 同一出口） |
| 13 | desktop | medium | 在插件/记忆/自动化页打开会话或新建任务不可见 | 本批落地 |
| 14 | desktop | medium | 关最后一格窗格后焦点掉到 `body` | 本批落地 |
| 15 | core | critical | journal 压缩丢每任务水位；跨进程追加可被覆盖 | 本批落地 |
| 16 | core | high | 设置写入损坏文件会覆盖默认值、丢未知键 | 驳回：核验为现有设置写入契约的刻意行为 |
| 17 | core | high | 空锁可被双拿；PID 复用后死锁永久占用 | 本批落地 |
| 18 | core | high | 完整但无换行的尾事件被下一次 append 删除 | 已有工作树修复（完整尾事件补换行） |
| 19 | core | medium | 东八区以东的自定义计划早一天触发 | 本批落地 |
| 20 | core | medium | 会话搜索把 worker 内部文本当用户对话 | 本批落地 |
| 21 | core | low | 冷读行数按 stat.size 记水位，增量重复计数 | 本批落地 |
| 22 | desktop | high | 会话行 48px、时间戳另起一行，密度只有规格一半 | 刻意设计：2026-10-31 R3 的舒适/紧凑裁决，暂不强改 |
| 23 | desktop | high | 插件审查仍是英文六格能力卡 | 本批落地 |
| 24 | desktop | medium | 插件抽屉从 48px 起，工具栏 38px 下露 10px 缝 | 本批落地 |
| 25 | desktop | medium | 模型菜单按 344px 夹取，CSS 已允许 420px | 已有工作树修复（常量对齐 420） |
| 26 | desktop | medium | 设置页重复「设置」标题；标题字阶在 24/26/28 间跳 | 部分落地：删重复标题；字阶统一留后 |
| 27 | desktop | medium | 插件页局部 outline 叠全局焦点环，出现双环 | 本批落地 |
| 28 | desktop | medium | 上下文六桶色是整色值且无暗色档 | 本批落地 |
| 29 | core | critical | worker 模型请求不接 AbortSignal，取消停不住 | 已有工作树修复（`call.signal` 已透传） |
| 30 | core | high | runAgent 失败不取消 detached worker，锁先释放 | 延后：生命周期批次 |
| 31 | core | high | worker diff 失败被吞成 null，可能清掉真实改动 | 延后：生命周期批次 |
| 32 | core | high | 孤儿 worktree 清理会对任意 `.agents/wt-*` 执行 `rm -rf` | 本批落地 |
| 33 | core | high | 自动验证信任探测不带取消信号，Stop 被 60s 卡住 | 延后：生命周期批次 |
| 34 | core | medium | 预测性压缩未传取消信号，Stop 不能中止 | 延后：生命周期批次 |
| 35 | core | medium | pipeline 的 runChain 脱离执行且吞异常，链永久 running | 本批落地 |
| 36 | core | high | no-progress 判卷与生产写盘判据不一致 | 延后：冻结语料约束（见第三节） |
| 37 | desktop | high | 229-prop 单对象让每个流事件重画整棵工作台 | 延后：渲染层架构批次 |
| 38 | desktop | high | 146 处 `window.agent.*` 在展示组件里 | 延后：渲染层架构批次 |
| 39 | core | medium | `resolveSessionRef` 无生产调用，三个解析器分叉 | 延后：会话寻址收口 |
| 40 | desktop | medium | Electron main 1,903 行、156 个 IPC handler 同模块 | 延后：主进程拆分 |
| 41 | desktop | medium | 48 名角色 token 层已死且被 CDS 覆盖 | 延后：设计 token 清理 |
| 42 | desktop | low | `locale` 是只写设置，没有 UI 读取 | 延后：要么删字段，要么做真选择器 |
| 43 | core | critical | 工作区自带 allow 规则可绕过全部审批 | 延后：安全批次 |
| 44 | core | critical | `run_shell` 非重定向写绕过 `.agent` 与冻结判卷硬闸 | 延后：安全批次 |
| 45 | core | high | shell 家族绕过敏感路径读取审批 | 延后：安全批次 |
| 46 | core | high | verify 指纹绑启动串，不绑 package.json 脚本正文 | 延后：安全批次 |
| 47 | core | high | deny 规则可被反斜杠换行与 ANSI-C 引号绕过 | 延后：安全批次 |
| 48 | core | high | action fusion 执行仓库 lint 未过 verify 信任门 | 延后：安全批次 |
| 49 | core | high | Seatbelt 读禁令漏应用配置与常见凭据目录 | 延后：安全批次 |
| 50 | core | high | 模型声明的首选思考档被校验后丢弃 | 本批落地 |
| 51 | core | high | Anthropic thinking 块从未回放，工具轮会 400 | 延后：provider 协议批次 |
| 52 | core | high | 发现的 OpenRouter 价格在 provider 草稿中丢失 | 本批落地 |
| 53 | core | high | Anthropic 截断 tool_use 先抛错，截断证据到不了 | 延后：provider 协议批次 |
| 54 | core | high | ACP stdio 按块解码 UTF-8，跨块字符损坏 | 本批落地 |
| 55 | desktop | high | 自定义 provider 读写钉在启动工作区 | 本批落地 |
| 56 | core | medium | OpenAI 非流式 200 错误体被当成功空回复 | 本批落地 |

合计：本批直接改动 23 条（其中 #26 为部分完成），核验时已有工作树修复 6 条，驳回 1 条，刻意设计 1 条，延后 25 条。

## 二、本批落地明细

### 桌面（12 条；#1/#12 合并一行）

| # | 改动 | 判卷 |
| --- | --- | --- |
| 1 / 12 | `WorkbenchView.tsx` 命令面板切项目后调用 `newSession()`，旧会话不再被带进新工作区 | 桌面全量套件 |
| 2 | `session-identity.ts` 新增 `markBackgroundRunning`；`session-subscription.ts` 后台非终态事件只在 0→1 时 force | `background-running.test.ts`（新） |
| 9 | `command-gate.ts` 新增 `composerTarget`；`app-commands.ts` 的 Escape 对二级输入框让路，浮层选择器补 `.slash-menu` / `.mention-menu` | `command-gate.test.ts` |
| 13 | `workbench.ts` 的 `openSession` 先 `openDestination("chat")`；新增 `newSessionInChat` 并接管快捷键/命令面板/侧栏新任务 | 桌面全量套件 |
| 14 | `PaneDock.tsx` 关闭最后一格时焦点回退到 `[data-workbench-changes="true"]` 或 `[aria-label="工作台工具"]` | `pane-disclosure.test.tsx` / `render-structure.test.tsx` |
| 23 | 新增 `plugins/PluginCapabilities.tsx`，审查与详情共用非零能力胶囊；删除六格 grid | `plugin-review.test.tsx` |
| 24 | `.plugin-sheet` 的 `top` 从 48px 改为 38px | `plugin-review.test.tsx` |
| 26 | 删除设置导航列重复的「设置」标题及死 CSS | `settings-panel.test.ts` |
| 27 | 删除 `.plugins-workspace :focus-visible` 局部 outline | `focus-ring.test.ts` |
| 28 | `tokens.css` 六枚 `--ctx-seg-*` 改为 HSL 三元组并补暗色档；`styles.css` 改 `hsl(var(...))` | `tokens.test.ts` |
| 55 | `apps/desktop/src/main/index.ts` 的 provider 读写改用 `resolveWorkspace()`；工作区切换后重装自定义 provider | `workspace-context.test.ts` |

### 内核（11 条）

| # | 改动 | 判卷 |
| --- | --- | --- |
| 15 | `scheduler.ts` 新增 `automations-journal.lock` 跨进程写锁；压缩在锁内重读并保留每个任务最后一条 | `schedule.test.ts`（悉尼 everyDays、锁阻塞/释放、稀疏任务压缩） |
| 17 | `session-lock.ts` 记录进程启动时间，PID 复用不再永久占用；空/半写锁按 busy 处理 | `session-lock.test.ts` |
| 19 | `scheduler.ts` custom 锚点改用墙钟纪元 `anchorWall = Date.UTC(...)`，去掉重复减时区偏移 | `schedule.test.ts`（悉尼 everyDays=2/7） |
| 20 | `session-search.ts` 的 `VisibleCorpus.push` 在 type 分支前跳过任何非空 `agent_id` | `session-search.test.ts` |
| 21 | `sessions.ts` 导出 `countSessionLines`；冷读水位改用 `Buffer.byteLength(raw, "utf8")` | `sessions.test.ts` |
| 32 | `worktree.ts` 的 rm 兜底先 `isWorktreeRoot(wtPath)`，未登记目录拒绝物理删除 | `worktree-branch-reuse.test.ts` |
| 35 | `orchestrator-approvals.ts` detached `runChain` 的 catch 改为 `failChain("sequencer 异常：…")` | `cascade-wiring.test.ts`（第二环 emit 抛错 ⇒ 整链 failed） |
| 50 | `agent-runner.ts` 捕获 `effectiveThinking = validateThinkingEffort(...)` 并传给 `runAgent` 的 `thinking` | `main-run-routing.test.ts`（默认 high / 显式 low / off） |
| 52 | `provider-draft.ts` 目录无价时用发现价构造 `price`，并把价格计入 `anyDiscovery`；`anyCatalog` 只看目录自身字段 | `provider-draft.test.ts` |
| 54 | `acp-stdio.ts` 跨 chunk 使用 `TextDecoder("utf-8")` + `{stream:true}`，EOF 时 flush | `interop-acp-stdio.test.ts`（多字节字符跨块） |
| 56 | `openai.ts` 非流式分支检查 `data.error` 并抛 `StreamFailure`，且要求 `choices[0].message` 存在 | `provider-stream-lifecycle.test.ts` |
| — | 以上改动均未触碰冻结判卷文件或 fixtures | — |

## 三、冻结语料边界（#36）

`#36` 要求把 `no-progress` 判卷的私有 `WRITE_TOOLS` 换成生产判据 `mayHaveWrittenDisk(name, args)`。核验确认这是真实分歧，但现有正样本 `real-red-verify-stagnation` 的唯一写盘动作是 `run_shell` 重定向（`printf ... > .npmrc`）：

- 改用 `mayHaveWrittenDisk` 后，该样本会从 **fire** 变成 **silent**，与 `tests/no-progress.test.ts` 现有的 escalate 断言冲突。
- `fixtures/no-progress/*` 与 `scripts/frozen-sha256.json` 是冻结判卷面，本轮不改 fixture、不削弱断言。
- 新增一个「只有 `run_shell` 重定向写盘」的正样本需要人工登记冻结表，超出本批授权。

因此 #36 降级为报告项：先把生产判据的语义写清，等冻结表维护窗口再连同正样本一起切换。

## 四、验证读数（工作树，未提交）

| 面 | 读数 |
| --- | --- |
| 桌面套件 | **327 文件 / 2267 条全绿**（`pnpm --filter cairn-desktop test`，含 desktop-boundary） |
| core 全量 | **641 文件 / 7805 条全绿**（`pnpm test:capped` = `--maxWorkers=2`，墙钟 190.48s） |
| 定向 core | 15 文件 / 238 条全绿（schedule、session-search、sessions、worktree-branch-reuse、cascade-wiring、interop-acp-stdio、provider-stream-lifecycle、provider-draft、main-run-routing、session-lock 等） |
| 根 typecheck | `node --import tsx scripts/typecheck.ts` ⇒ 0 条报错 |
| docs-check | 受检项全绿；下一个未占用页号 1030 |
| desktop-boundary-check | 绿（src 无反向依赖、无 UI import） |
| renderer-layer-check | 绿（210 个渲染层源文件；I1–I4 全过） |
| evidence-typecheck-check | 绿（危险码 12/12；在飞未入库 0 条 / 0 个文件） |

## 五、边界

- 未提交。共享工作树还含着其他会话的在飞改动（设置面、模型菜单、插件市场、浏览器标签等），本批只做定点替换，没有 reset/stash，也不替它们背书。
- 未跑 `pnpm gates` / `head-cert-check` / `mutate-verify`：后两者量 HEAD，本批改动未提交；本页读数只覆盖工作树。
- #43–#49 是权限/沙箱安全项，风险高，需独立设计与对抗性判卷，不在本批贸然改。
- #22 的会话行密度是 2026-10-31 R3 的刻意裁决；本轮只记录，不按 finding 强改。
