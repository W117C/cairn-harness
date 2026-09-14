# 代码审查 · 工作区未提交改动（分支 codex/dsh-structural-hardening）

- 对象：git diff 的 85 个文件（+1906 / −480）+ 未跟踪源码（src/routing/、src/agent/gym/、src/agent/supervisor.ts、src/providers/registry.ts、src/main/provider-key-inject.ts、scripts/{gym,routing,supervisor}-*、tests/{routing-policy,routing-events,store}.test.ts、fixtures/gym/）
- 基线实测：tsc --noEmit = 0；vitest run --config tests/vitest.config.ts --pool=threads = 59 files / 531 passed / 0 failed；electron-vite build 成功（产物 CSP 已核）。=> 以下全是门禁测不到的行为缺陷，不是回归红。
- 标注：[新] = 本轮改动引入；[存] = 前存，但本轮改动在其所在函数或扩大了触发面。
- 复核：4 个分片独立审 + 主审逐条回证；带「实测」的结论由主审本人跑脚本复现。

---

## 一、S1：会导致错误行为或权限失效（必须修）

### 1. 规则链「取最坏」方向反了：ask 规则被 allow 段击穿 [存]（本轮 CHAIN_SPLIT 就在该函数内，并提高了多段链命中率）
- src/permissions/rules.ts:192-193 —— BEHAVIOR_RANK = { deny:0, ask:1, allow:2 }，worst 用 > 取最高 rank，于是 allow 盖掉 ask。
- 实测复现（npx tsx 直调 judgeChain；rules = allow echo + ask git）：
  - "echo hi && git status" => verdict: allow
  - "echo hi; git status" / "echo hi & git status" / "git status && echo hi" => 全部 allow（与顺序无关）
  - 对照：单段 "git status" => ask（正确）；allow+deny => deny（deny 短路正确）
- 触发：permissions.json 里任意 allow 条目与更严的 ask 条目同链（npm run lint; git push 这类）。
- 影响：用户显式 ask 被串联绕过 => autonomy.ts:175-185 L3 自动放行，直接推翻 rules.ts:172 注释「取最坏（deny>ask>allow）」与「L2 ask 任何档位绕不过」。权限层 fail-open。
- 修复：比较方向取最严（hit < worst 时替换）；tests/permissions.test.ts 现在只测单段最长前缀，补一条混合链断言。

### 2. replayIncremental 并发消费同一日志 => 重复事件写进共享缓存，污染该轮模型上下文 [新]
- src/events/index.ts:471-513：增量分支 cached.events.push(e) + cached.offset += consumed 无互斥，且返回缓存数组本体。
- 实测复现（预热 5 条 => 追加 3 条 => Promise.all 两路）：返回长度 11（期望 8），内容 m1..m5,c1,c2,c3,c1,c2,c3，两返回值 === 同一数组；下一轮因 offset > size 全量重解析才自愈。
- 触发：同一 logPath 两个在飞消费方。生产形态：sidechat 的设计前提就是主会话运行中旁路提问 —— sidechat.ts:245 读 mainLogPath 与 glm-session.ts:318 每轮 assemble() 并发。
- 影响：该轮投影重复事件（历史翻倍、tool_call/result 配对错乱）+ 无谓全量重读。注释「语义与 replay 逐位一致」不成立（replay 无共享态天然可并发）。
- 修复：照抄同 diff 里 B8 的 callIdIndexChain —— per-path Promise 链串行化「读尾部+推进」，返回 cached.events.slice()。

### 3. MCP transport.onclose 被覆盖 => server 崩溃时在途 tools/call 永久挂起 [新]（E5 引入的回归）
- src/agent/plugins/mcp.ts:142-147：在 client.connect(transport) 之后赋值 transport.onclose = ...。
- 证据（SDK 1.30.0 dist/esm/shared/protocol.js:220-224,248-268）：connect 内部把 transport.onclose 包成 () => { _onclose?.(); this._onclose(); }，而 _onclose() 才负责把 ConnectionClosed 结算给全部 responseHandlers；stdio.js:85 在进程 close 时调对象当前的 this.onclose => 我们的赋值确实生效，SDK 的 pending 结算链被摘掉。
- 触发：连接成功后 callTool 在途时 server 进程死掉（mcp.ts:170-188 的 callTool 没有 withTimeout，只包了 connect / listTools）。
- 影响：await conn.client.callTool() 永不 settle => agent loop 卡死在该工具调用，run 不收束。旧行为是 SDK reject => catch => fail-visible 返回。
- 修复：链式而非覆盖（const prev = transport.onclose; transport.onclose = () => { prev?.(); markFailed(); }）；顺手给 callTool 套 withTimeout。

### 4. replay 逐行容错打破「事件 id = 1-based 行号」契约 => 血缘/分支/promote 静默错位 [新]
- src/events/index.ts:424-450：坏行 badLines++; continue 不占位，但 events.slice(0, n)（untilEventId）与 sidechat.ts:398,406 的 events[id-1] 都按下标消费；:422 函数头仍写「id = 1-based 行号（append-only 保证永不漂移）」，而 advanceCallIdIndex 注释明确「坏行照常占行号」=> 同一 diff 内两套 id 空间。
- 触发：会话 JSONL 存在 >=1 条被跳过的行（崩溃半写，正是 A1 要容的场景）。
- 影响：promote 按 source_event_ids 重建正文会取到错误的源消息并写进主会话；forkSession/untilEventId 落错事件点；parent_event_id 血缘指错 spawn；尾部坏行时对合法 id 误抛「无效 untilEventId」。旧实现坏行直接 throw（显性失败），改后变静默错数据。
- 修复：坏行照常占位（推进行号），untilEventId 的校验与切分按行数而非 events.length；events[id-1] 类消费方改走「按行号取事件」辅助函数。

### 5. F1 会话过滤吞掉定时触发/完成事件，并让 schedule 面板失去唯一刷新信号 [新]
- src/renderer/main.tsx:999-1000 的守卫 if (sid !== undefined && sid !== currentSessionIdRef.current) return; 在 dispatch 之前。
- 证据三链均已核对：scheduler.ts:588-597 的 automation_triggered 自带 session_id（刚新建的定时会话，按定义 != 当前会话）；agent-runner.ts:597-601 的 emitTimeline 既把它 append 进当前会话 JSONL、又 hooks.onEvent?.(e) 推给 renderer；automation_completed（events/index.ts:327）必带 session_id。
- 影响：「⏰ 定时触发」行与完成 report 卡在活流里永不出现（main.tsx:316-357 分支成死代码），reload/重放后又出现 => live 与 replay 不一致；事件不进 state.events => panelPayload.eventCount 不动 => SchedulePanel 唯一 reload 触发失效，「运行中 N / 上限 / 排队」与运行历史整段卡死。
- 修复：调度三事件在守卫前放行继续 dispatch（refreshSessions 已被上移到守卫前，说明作者知道这类事件跨会话，只漏了 dispatch）。

### 6. C7 逐行容错把 SSE「帧损坏」降级成「静默少字」[新]
- openai.ts:187-192、anthropic.ts:238-243、gemini.ts:187-192：try { JSON.parse(payload) } catch { continue; }，无计数无上抛。
- 触发：data: 载荷是 { 开头的真帧但 parse 失败（反代/网关半帧截断、body 被掐）。
- 影响：分片被丢后循环继续；流随即正常收尾 => 本轮以「截断文本 + 缺 tool_call + 缺 usage」成功收束，loop 当成完整输出。旧行为抛出协议错。同文件 parseArgs（openai.ts:57-65 注释「协议级异常，fail loud，不静默吞掉」）与本轮口径自相矛盾。
- 修复：只跳非 JSON 载荷（if (!payload.startsWith("{")) continue;），真帧 parse 失败改 throw。

### 7. 插件信任 bounded 只判不用：批准成 no-op、信任卡死循环、user/loose 免信任面被覆盖 [新]
- discover.ts:47-48,60 的 bounded ? "pending" : trustOf(...) 在查信任之前短路；plugins/index.ts:147 的 decide 用的是丢掉 bounded 位的 pluginFingerprint => 存的 abs@fp 永不被查回；trust.ts:129-131 的 hit() 只在 trustOf 路径内。
- 触发：插件目录含任一软链（hooks -> ../shared-hooks 这类开发布局常见）、或 >500 文件、或任一文件 >512KB。
- 影响：信任卡每次启动重弹、插件 hooks/MCP/skills 永久不生效；declined 决议同样被覆盖。注释宣称的「user/loose 两处 trustOf 恒 trusted」也被 bounded 短路一并打掉。
- 修复：decide 同用 pluginFingerprintEx 并把 bounded 编进条目（abs@fp+b）；trustOf(abs, fp, bounded) 命中该条目即照记信任/拒绝（内容变了自然不命中 => 重新出卡）；user/loose scope 不被 bounded 覆盖。

### 8. E2 软链闸留缺口：manifest 显式声明的 hooks 路径 + 指纹 skip 目录，组合下仍能绕过绑定 [新]
- manifest.ts:151-168：existsRegular 只替换了缺省 hooks/hooks.json 与 .mcp.json 两处；"hooks": "<path>" 的 kind:"path" 分支与 discover.ts:147-150 的 readFile(hooksRef.path) 都不判 lstat。
- 组合放大：trust.ts 的 FP_SKIP_DIRS = {node_modules,.git,dist,out} 整目录不遍历 => bounded=false，正常出卡获信任。
- 触发：恶意插件声明 "hooks": "dist/hooks.json" 并把该路径做成软链 -> /tmp/evil.json；信任之后改 evil 目标内容。
- 影响：插件 hooks = 任意 shell 执行面，且指纹逐字不变 => 正是本轮 E2 想封的「信任后软链绕过」仍然成立。
- 修复：kind:"path" / 显式 mcp 路径统一过 existsRegular（读前再 lstat）；指纹 walk 进 skip 目录时至少对 isSymbolicLink 置 bounded。

### 9. D7 journal 收敛与 append 未串行：窗口内的账被旧快照覆盖 => 重启后同一次触发可双跑 [新]
- scheduler.ts:113-122（read -> tmp -> rename）+ :631-641（void compactJournalIfLarge(...) fire-and-forget）；写账点 :574、:617 走另一条 appendFile。
- 触发：journal 破 10000 行后每 1000 条增量收敛一次，正好撞在两次账写之间（配合 S2-10 的 500 条 burst，窗口命中概率显著上升）。
- 影响：丢的正是 triggered 账 => 重启后 journalKeys 不含该 occurrence_key => 「spawn 前写账 = 崩溃窗口不双跑」(:573 注释) 失效，同一定时任务再跑一遍；lastDecidedAt 水位回退。运行期内存态完整，只在重启后暴露。
- 修复：把 compaction 串进已有 chain/tickMutex 序列化链并让 append 走同一条链（或只在 start() 收敛，去掉运行期触发）。

---

## 二、S2：明确缺陷，影响面较小或需组合触发

10. [新] scheduler.ts:490-498（D6）：合盖睡眠唤醒后首个非 startup tick，occurrencesBetween 上限 500（:43）=> 一次 tick 内 <=499 次串行 appendFile + emitTimeline（每次又是一次会话 JSONL append + IPC 推流），60s tick 被拖长、当前会话被灌数百条「⏰ 跳过」（该事件无 session_id，F1 挡不住），并放大 #9 竞态窗口。修：运行期补记账设小上限（最近 20 条，其余折成一条聚合 skipped 账）；顺带修语义 —— 中间量并非「超出 7 天回看窗口」却报 too-old。
11. [新] memory/store.ts:315-326（deleteTopic）：面板删 topic 与 remember 的 writeTopic 同 dir 并发 —— deleteTopic 未进本轮 E9 的 serializeOn(dir) 锁且 writeFile 非原子直写 => 用旧全文覆盖新索引（topic 文件在、MEMORY.md 行丢 = 注入器/面板失明），或写出半截索引。修：主体包 serializeOn(dir, ...)，索引写改 tmp+rename（与 writeTopic:253-268 同口径）。
12. [新] orchestrator.ts:1097-1102 catch：emit 失败（本轮新加 routing_decision 落流，抛点 2->3）时只回收 worktree —— handle 已在 workers/mergeOwners/agentOwners 且 root 监听已挂，runWorker 永不调用 => activeCount()（:683 判 !finished || !closed）永久 +1，四次后本会话再也 spawn 不出 worker；write worker 还永久占写租约（leaseConflicts 只看 w.finished）。主审与分片各自 git show HEAD 核对同序 = 前存缺陷，本轮扩大了抛点。修：catch 内补 workers.delete / agentOwners.delete / mergeOwners.delete / controller.abort() / releaseWorkerMemory(handle)（后者已幂等）。
13. [新] orchestrator.ts:795-852 spawnRace：(a) spawn() 返回体 :1113 本就含 agent_id，却全量 replay 找「第一个未见 id」=> 并发 spawn 时误认领无关键，早停 cancelAgent(other) 误杀无辜、真候选失控；replay 抛错走 .catch(()=>[]) 时 fresh 取到最早的历史 agent，agentIds 全无效 => winners.length >= agentIds.length（0>=0）立即 break，刚派发的候选继续跑并计费；(b) 120s 窗 while 每 25ms 全量 replay(整份 JSONL)（<=4800 次），且不检查 root.signal.aborted => 用户取消后仍打满。修：解析 JSON.parse(r.output).agent_id 登记候选（删掉两处 replay）；取不到即 return {ok:false}；循环加 !this.root.signal.aborted；轮询换既有 waitForTerminal(:1480)；超时出口逐个 cancelAgent。当前面窄（仅 scripts/supervisor-check.ts 调用，无模型可见入口）—— 接线前必修。
14. [新] memory/store.ts:186-205（E9）：appendRootFile 的「末字节决定是否补换行」是 read->append 两步且未进本轮 serializeOn —— 两路并发 remember 同一根文件且内容不以换行结尾时都判「无需补」=> 两条记忆粘成一行，"## " 分块解析被破坏。修：包进 serializeOn(path, ...)（helper 就在同文件）。
15. [新] providers-check.ts:205-224 ⑤：旧判据 src.includes("openai.ts") 能命中 await import("./openai.ts")；新 AST 只遍历 sf.statements 的 isImportDeclaration/isExportDeclaration => 动态 import 一律不可见（架构隔离门对该形态失效，绿但约束破了）。修：importSpecifiers 内补 ts.forEachChild 找 CallExpression 且 expression 为 import keyword，收首参字符串字面量并入 specs。
16. [新] gym-check.ts:44-60,88-108：全门只有「negative 判 0」+「两次跑逐字段一致」，没有任何 positive 判 1 的断言。一旦 runVerifyOutcome（verify.ts:28 bash -c + sanitizedEnv + 60s）在验收环境系统性 ok:false，正负解全 0 => A2 绿、B1「一致」绿 => M5 结果信号恒 0 而门禁全绿（fixtures/gym/baseline.json 的 successRate=1 存在但本门不消费）。修：B1 循环加 check(r1.verifyOk === true && r1.score === 1, "B0 positive 判 1（尺子读得出正确解）")。
17. [新] routing-check.ts:178-180 B3d：staticD 与 offD 两次 routeFor 入参逐字相同且都不传 bandit => 断言即 f(x)===f(x) 恒真。bandit 开关接线怎么坏都永远绿，且恒真式体检（label-first / EMPTY_ASSERT）抓不到这种形态。修：offD 传 bandit 做两态对比，或直接断 staticD.reason === "tier-default" 并断带 bandit 时 reason 变 bandit。
18. [新] gates.ts:88-92：超时 child.kill("SIGKILL") 只杀 pnpm 父进程，真正的 node scripts/x-check.ts 孙进程存活 => finish(124) 后下一道门立刻开跑，与孤儿并发互踩（固定 CDP 端口、全局 tmpdir 快照名、fixtures/todo-app 双进程 resetTarget 交错写）=> 超时事件后连锁假红/假绿。修：spawn(..., { detached: true }) + 超时/关闭路径 process.kill(-child.pid, "SIGKILL") 杀进程组。


---

## 三、S3：小缺陷 / 修复空转（顺手可清）

1. [新] lsp.ts:266-270 + index.ts:303-307：C5 把 LSP 子进程改 detached: true（独立进程组），但它们不走 spawnTracked => 不在 liveTracked；closeAllLspClients 实测只被 scripts/tools-check.ts:210 调过 => D8 的 will-quit 组杀覆盖不到 LSP，退出留整组孤儿 tsserver。修：will-quit 加 void closeAllLspClients();（或 LSP 入同组杀表）。
2. [新] run_shell.ts:52-66：C12 只 addEventListener("abort", onAbort, {once:true})，finish 不摘 => 同一 run 内 >10 次 shell 即 MaxListenersExceededWarning，未触发的闭包（含 <=32KB out 缓冲）被 signal 拖到 run 结束。修：handle.child.once("close", () => ctx.signal?.removeEventListener("abort", onAbort))（与本轮 B7 同口径）。
3. [新] ask-gate.ts:58,92-98（D12）：新增 ctx.signal 收束 pending 的能力六处调用点全未传（实测 agent-runner.ts:272/279/330/543/668/1028 的 ctx 只有 reason/risk/riskReasons）=> 注释承诺的「run 中止时 pending 立即拒绝」不成立，仍等 60s 超时（行为与改前一致，修复空转）。修：Session 挂 opts.signal，gatedTool/gatedMcpTool 透传。
4. [新] main.tsx:396-407：routing_decision 无 EventView 分支，但 store.ts:49 仍为每个非 delta 事件追加 timeline 项、conversation.tsx 无条件包 px-4 py-1.5 => 路由启用后每次派生留一条空白行，审计面不可见。与本轮 G8 给 diff_comment 补分支的动机同一类，漏了这个新类型。修：补一行 ToolRow（picked / tier / reason / stage）。
5. [新] updater.ts:62-68,109-128：readBodyCapped 从不调 guard.bump() => 「静默窗口」实际变成总时长上限，body 慢于 60s 或超 1MB 都被报成「不是合法 JSON」；fetch 失败路径也不 dispose guard。修：按 err.message 分流文案 + 循环内 bump + catch 补 dispose。
6. [新] plugins/index.ts:159-163 + discover.ts:305-307：E3 让项目级 loose skill 走信任门，但 pendingPlugins 只过滤 plugins、trustDecide 只查 manifest 插件 => pending 的散装 skill 既不出信任卡也无 plugin:decide 出口（永久静默失效），而面板快照 looseSkills 仍导出其攻击者可控 description 且无 trust 字段可标灰。修：pendingPlugins/trustDecide 键域并入 looseSkills，snapshot 带 trust。
7. [新] frozen.ts:16-18：onDisk = [...extraFiles] 不做存在性检查 => fixtures/gym/index.json 被删且不在表里时，frozenCoverageDrift 报出一个「盘上并不存在的新判卷文件」，gate-check:258 红且误导排查。修：逐个 stat 成功才入集合。
8. [新] assertion-health.ts:76-92：为消 3 条假阳改为「扫前两个实参 + 闭包不下潜」。label-first 确是修假阳，但 cond-first 形态 assert(arr.some(x => !precond || ok)) 从「报」变「不报」= 弱析取进网外。修：不下潜时留字符串级兜底（闭包体含 !x || 或 || true 仍报 hit）。
9. [新] gate-check.ts:281 G12：includes("@shadcn-modified") 子串任意位置（含注释/模板串）即放行，比 AGENTS.md 约定的「文件头」宽。修：按前 3 行 ^\s*(//|/*)\s*@shadcn-modified 判。
10. [新] gym-run.ts:23-26：pick() 把「flag 在但值缺失」当「未传」=> --out 漏值时基线静默不写出且退 0，--compare 从此永远比旧基线。修：flag 命中缺值即 console.error + exit 1（与本轮 H6 --only 空集判红同口径）。
11. [新] orchestrator.ts:946-960：routing 开启时 model = toWorkerModel(...) 恒为真值 => if (!model && !process.env.M0_API_KEY) 快拒失效，无 key 照造必败 worker（白扣一次 spawn 审批 + 多一条失败审计）。生产未接线（agent-runner.ts:200/870 均未传 routing），接之前把闸补上。

---

## 四、待确认（不当成确定缺陷；缺什么证据已写明）

- openai.ts:108 无条件发 stream_options.include_usage：只有 mock fetch 覆盖。缺 provider-check 联网段对 open.bigmodel.cn 与自建网关的实测 —— 不认该字段的兼容端点会 400，导致每一次流式都失败。
- sandbox 可用路径下取消不即时收杀（agent-runner.ts:310-314：sandbox available 时 run_shell 直连 runInSandbox()，绕过 original.run => C12 的 killGroup 不生效）。缺：sandbox.ts 的 runInSandbox 是否走 spawnTracked / 有无信号面。
- worktree.ts:52-76：gitRun 32MB 帽 SIGKILL 若落在 git add -N . 写 index 中途，残留 .git/index.lock => 该 worktree 后续 diff/merge 粘滞失败。缺：worktreeDiff 是否经 gitRun 跑 add + 大 diff 实测。
- fh.read 忽略 bytesRead（events/index.ts 增量分支、orchestrator.ts advanceCallIdIndex 同型）：短读时 allocUnsafe 尾部未初始化字节可解析出鬼影行且 consumed 多计。缺：Node 常规文件 pread 的可触发短读证据（概率极低）。
- providers/index.ts:43-59 streamFromNextSource 的 exhausted 闭包：同一 stream 函数第二次调用直接空轮。缺：是否存在重试包装点复用它。
- main.tsx:988-991 ref 镜像滞后：切会话时新会话在 openSession 响应之后、effect 提交之前到达的 delta 会被守卫丢弃。缺：可稳定复现的交错（受 running 守卫保护，概率未测）。
- journal 从不落 session_id（scheduler.ts:565-580 在建会话之前写账）=> 重启后历史一律 failed/interrupted 且无会话跳转。不在本 diff 内，是否计入本轮请裁决。
- map-check.ts:30-32 cp filter 用裸子串（!includes("/out") 等）：现网实测不误伤（28 条 hash 全 match），但 /outputs、.github 类命名会静默缩小被扫集合且无反向断言。属潜在而非现行。
- ROOT = process.cwd()（agents/gym/routing/supervisor/plugins-check）：gates 通道 cwd 恒为 ROOT，现行无恙；若验收承诺「非根直跑也正确」则需与本轮 map-check 的取法统一。缺：任务书是否做此承诺。
- 只读白名单残余面（非现行缺陷）：实测本机 git 2.54 下 git -c core.fsmonitor=<脚本> status 确会执行外部命令（PoC 生成 marker 文件），当前被「第二词子命令白名单」拦下。建议把「拒绝裸 -c / --config」写进 flagViolation，把结论钉在代码里而不是依赖 git 只接受子命令前 -c 这一语义。

---

## 五、已核对无问题（不必改，供放心）

- 只读 bash 面（P0-6 / B-1）：--output（空格式）/--pre/--format= 式赋值实测均 REJECTED；换行与单 & 归一切段有效；引号内分隔符只会过度拒绝（安全方向）。
- CHAIN_SPLIT 扩 &/换行本身方向保守：allow 需 allHit（每段都被命中），拆得越碎 allow 越难成立；deny 任一段命中即短路（rules.ts:189-191）。问题只在 #1 的 ask/allow 比较方向。
- assertNotAgentAreaReal（C3）祖先链 realpath + .agent 段复查，对 foo -> .agent 这类词法不可见逃逸成立；sanitizedEnv 白名单不含 M0_API_KEY，glob/ripgrep 本轮补齐；secrets.ts 审计行只含键名与路径不含值。
- AskGate D12 自身实现：finish 幂等（settled 门）统一摘 timer 与监听、timeout/decide/abort 先到先算、notify 载荷解构剥离 signal（避免 IPC 结构化克隆失败）—— 只是没人传 signal（S3-3）。
- permissions/index.ts C9：删私有 isSideEffectTool 副本、统一从 autonomy 导入，语义为严格超集（+shell_rw），对主会话与 worker 现有档位零行为变化；risk.ts 把 shell_ro 排除在威胁表外以免 deny 降级 ask，理由成立。
- releaseWorkerMemory（B7）幂等且只在 finishInner 终态调用（此时 runLoop 已收束）；评审重启靠 mergeOwners 保住 w.events，与裁剪条件自洽；重启后 root 监听摘除不构成取消旁路（cancelAll 先循环 cancelAgent + injectComment 有 aborted 前置闸 :2030）。
- B3/B4/B10：spawnReserve 的 check->++ 无 await 间隙、finally 回滚、deferred 早退不占位；注册后复查补 abort 窗口；mergeWorker 入口摘除 + 失败回滚无交叉窗口。
- 渲染层 F-4 delta 批量：flushDeltaBuf 只碰 ref + dispatch（首渲染闭包安全），create/switch/delete/卸载四路都在 reset 前 flush => 无跨会话尾巴、无丢尾帧、非 delta 先冲缓冲保序；F1 用 ref 镜像（effect 只挂一次）；F2/F6 三处 running/seq 守卫一致、allSettled 后逐路 fulfilled 判定；F5 memo 不重挂载（resolvePanel 取模块级 REGISTRY、onActionImplRef 每渲染重赋、panelPayload deps 覆盖其读取的每个字段）。
- compaction.ts：A2 消 Math.max(-1, ...arr) 的 RangeError 正确（长会话恰在需要压缩时炸）；A4 的 atomicUnits 指针推进与 keepFirstSet 二分 —— spans.sort 后单调不重叠前提成立，与旧实现逐位等价；A9 删掉的兜底分支可证恒不可达（keepFirst 含全部 user_message id，overflow 路径仍显式护 lastUserMsgId）。
- provider 三家：SSE 跨 TCP 分片缓冲、[DONE] 双层收束无死循环、pending tool_call 按 index 排序统一吐出、usage 末置；anthropic/gemini 累计值覆盖不累加；AbortSignal.any([guard, call]) 在 Node 22 / Electron 44 可用，三条早退路径均 dispose guard、finally reader.cancel()。
- main/index.ts 入参面：agent:run 的 message 非空/<=100KB、mode 白名单、sessionId 过 isValidSessionName（禁 . / \ 控制符）；settings-set null 拒；D2 单实例锁 app.quit() 之后所有注册都在 if (gotSingleInstanceLock) 内，验收通道靠 M1E_SESSIONS_DIR 豁免不会假红；D11 删的死通道实测无 preload/renderer 桥接。
- frozen-sha256.json 无作弊：纯新增冻结，3 条旧判卷哈希逐字未动且与盘上一致（todo.test.ts 9179db…、todo-bug.ts 3edc93…、todo-fix.jsonl e253aa…）；25 条 gym 新条目与 fixtures/gym/** 28 条全 match、零漂移零缺失。
- 门禁总体收紧：gate-manifest 补三门且 package.json script 齐备（ACCEPTANCE_SHAPE 改 /check/i 是孤儿护栏收紧）；gates.ts --only 空集判红、scanAll 扩扩展名与递归；agents-check CANARY 哨兵替换旧恒真串（旧目标串实测全仓不存在）、D2 先 wait 后快照 + checkFatal、I8b 由恒真串改 HEAD+porcelain 真断言；各暗卷跳过路径 UNVERIFIED 上浮口径与 countUnverified 一致；tests/* 改动逐条核过全为收紧或时序修复（无「期望值改成实际输出」）；tsconfig include 未缩小；.gitignore 新增模式与已跟踪文件零冲突（git ls-files 实测无命中）。

