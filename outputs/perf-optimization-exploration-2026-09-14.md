# 桌面端全面优化探索报告（2026-09-14）

> 范围：性能提升 / 内存占用 / 启动速度 / UI 渲染效率。方法：静态代码审查（src/main、src/preload、src/renderer、构建配置）+ 构建产物实测。所有"预期效果"为基于代码结构与依赖体积的估算，落地前需按 §6 测量方案验证。

## 0. 现状速览

| 指标 | 实测值 | 判读 |
|---|---|---|
| 主进程 bundle | `out/main/index.js` 1.42 MB，**未压缩** ESM | 启动时全量解析，偏重 |
| 渲染 bundle | `out/renderer/assets/index-*.js` 1.18 MB，**未压缩** | 窗口首屏前全量解析 |
| 主进程静态重依赖 | `@modelcontextprotocol/sdk`(5.9MB)、`vscode-languageserver-protocol`、`croner` 全部顶层静态 import | 首启即加载，但首次 run 才用 |
| 已做对的事 | tree-sitter/ripgrep 懒加载；消息列表 react-virtuoso 虚拟化；delta 20ms 帧缓冲；IPC 单事件推送非全量；MCP/LSP 运行时 lazy | 底子不差 |

---

## 1. 启动速度优化

### S1【P0】开启产物压缩（minify）
- **证据**：`electron.vite.config.ts` 未配 minify；`out/main/index.js` 与 renderer JS 头部均可见换行、注释、可读标识符（未压缩特征）。
- **方案**：main/preload/renderer 三端 `build.minify: true`（rolldown 内置，零依赖）。main 端注意保留 `external: ["electron"]`。
- **预期效果**：main 1.42MB → 约 550–700KB（-50%~60%），renderer 1.18MB → 约 450–600KB；V8 解析/编译时间与磁盘读取同步下降，冷启动主进程就绪预计快 **100–300ms**，首屏快 **100ms+**。
- **风险**：低。stack trace 行号变化（sourcemap 已排除在包外，可保留本地 sourcemap 用于调试）。

### S2【P0】启用 V8 编译缓存 `module.enableCompileCache()`
- **证据**：Node ≥22.8 / Electron ≥33 提供 `module.enableCompileCache()`，Electron 44 可用；当前 `src/main/index.ts` 未调用。
- **方案**：主进程入口第一行调用（preload 亦可），编译产物缓存在 userData，二次启动跳过解析编译。
- **预期效果**：二次启动主进程 JS 编译时间降 **30%–60%**（对 1.42MB bundle 意义显著），是 Electron 官方推荐的零成本手段。
- **风险**：极低；缓存目录损坏时自动降级为正常编译。

### S3【P0】沙箱探测与建窗并行
- **证据**：`src/main/index.ts:294-295` `await initSandbox()` 阻塞 `createWindow`；`sandbox.ts:120-128` 真 spawn `sandbox-exec true`，超时 10s——沙箱异常宿主上首窗最长延迟 10s。
- **方案**：先建窗（审批门在沙箱结果就绪前对 run 类请求 fail-closed 排队/拒绝），`initSandbox()` 并行跑，结果就绪后再接线 agent-runner。
- **预期效果**：异常宿主首窗 **-数秒**；正常宿主 -50~150ms。
- **风险**：中。需保证 fail-closed 语义不破（沙箱未决期间 agent run 必须等待而非放行）——这是本项目的安全红线，改动需配 agents-check 回归。

### S4【P0】MCP / LSP / croner 改动态 import
- **证据**：`tools/lsp.ts:12-34` 静态 import `vscode-languageserver-protocol/node`（链：tools/index.ts:8 → agent-runner.ts:55 → index.ts:7）；`agent/plugins/mcp.ts:4-8` 静态 import MCP SDK（5.9MB）；`main/scheduler.ts:16` 静态 import croner。三者均首次 run / 首个定时任务才用。
- **方案**：改 `await import()` 懒加载 + 单例缓存（tree-sitter 已有同款范式 `agent/map/parse.ts:18,48`）。
- **预期效果**：主进程冷启动模块图缩小约 **6–8MB 源码等效**，bundle 同步瘦身（配合 S1）；启动快 **50–150ms**。
- **风险**：低-中。动态 import 使调用点变 async，需梳理调用链；门禁 typecheck + agents-check 可兜底。

### S5【P1】Scheduler 启动减负
- **证据**：`scheduler.ts:432-441` 启动即读 automations.json + 全量 journal 入内存；`snapshot()` 每次全遍历 journal（:790-822）。
- **方案**：journal 按需加载（先索引后段读）；snapshot 增量化。
- **预期效果**：自动化任务多的用户启动 **-数十~数百 ms**，常驻内存同步下降。

---

## 2. 内存占用优化

### M1【P0】getState 全量 replay → 增量 replay
- **证据**：`agent-runner.ts:1336` `handleAgentState` 每次 `replay(lastLogPath)` 全量解析整份会话 JSONL；流式期间 renderer 每批 delta 触发一次 getState（`panels/registry.tsx:103-111`）→ **O(n²) CPU + 内存抖动**（长会话流式后期每帧重复解析数千行）。且 `events/index.ts:457-458` 已有 `replayIncremental` 增量缓存（上限 32）却未接此路径。
- **方案**：getState 走 replayIncremental；会话结束/切换时失效缓存。
- **预期效果**：流式期间主进程 CPU 占用降 **一个数量级**（长会话最明显），GC 压力与内存峰值同步下降。这是全报告**单项收益最大**的优化。
- **风险**：低。增量基建已存在且有门禁覆盖（compaction-check 等）。

### M2【P1】Scheduler 内存结构随收敛裁剪
- **证据**：`Scheduler.completions` Map 只增不删（:394,:731）；journal 文件虽有 10k/4k 收敛（:115-127），进程内 `journalKeys`/`journalByTask` 不随收敛裁剪，**单调增长至重启**。
- **方案**：compact 时同步裁剪内存索引；completions 设 LRU 上限。
- **预期效果**：长跑（数周）主进程内存增长从线性 → 有界，常驻省 **数十 MB**（重度自动化用户）。

### M3【P1】listSessions 行数统计改流式计数
- **证据**：`sessions.ts:71-72` 为统计行数把每个 .jsonl 全量读入内存。
- **方案**：流式分块计数换行符，或把行数缓存在 session 元数据里写时维护。
- **预期效果**：会话列表 IPC 内存峰值与耗时随会话数从线性降为近常数。

### M4【P2】渲染端投影全量重算的内存副作用
- 见 U1；每次 O(events) 重算产生大量短生命周期对象，长会话 GC 频繁。增量投影后短寿对象大幅减少。

---

## 3. UI 渲染效率优化

### U1【P0】`useMemo([state])` 投影改增量/分片 memo
- **证据**：`main.tsx:774-783,1173` 六个以上 O(events) 投影（`projectAgentPanel`/`projectMergeTower`/`clarifySubmittedOf` 等，`projections.ts:142-449`）依赖整个 state——**每个事件到达都全量重算**；`store.ts:86-107` 还额外扫两遍 timeline。流式高频期每 20ms 帧都触发。
- **方案**：① 按事件类型过滤——只对影响该投影的事件类型重算；② 或改 reducer 内增量维护投影（fold 时顺带算，免二次扫描）；③ 至少把 `store.ts` 两遍扫描合并为单遍。
- **预期效果**：流式期间 renderer 主线程 JS 耗时降 **50%+**，长会话不掉帧；这是 UI 侧单项收益最大的优化。
- **风险**：中。投影逻辑是 UI 正确性核心，panels-check 必须全绿。

### U2【P1】delta 批量合并为单次 dispatch
- **证据**：`main.tsx:884` 帧缓冲后对 buf 逐条 dispatch，一帧 N 条 delta = N 次 reducer + N 次 state 替换（React 19 自动批处理合并了渲染，但 reducer 仍跑 N 遍）。
- **方案**：`dispatch({ type: "events", batch: [...] })`，reducer 内循环 fold 一次返回新 state。
- **预期效果**：reducer 调用次数 -90%+（流式期），与 U1 叠加效果明显。
- **风险**：低。

### U3【P1】面板轮询 getState 改事件驱动
- **证据**：`panels/registry.tsx:107-111` Token/sidechat/plugins/schedule 面板在 eventCount 变化时拉全量快照。
- **方案**：主进程在相关事件时定向 `webContents.send` 面板增量；或与 M1 共用增量投影结果。
- **预期效果**：流式期 IPC 流量与主进程 CPU 双降（与 M1 同源，建议同一轮做）。

### U4【P2】未虚拟化面板列表
- **证据**：会话列表（`main.tsx:1245`）、diffs（`registry.tsx:434`）、sidechat（:593）、memory topics/writes（:717,:756）、agents recent（:951）、schedule history（:1222）全量 `.map`。
- **方案**：量大的两个（会话列表、diffs）先上 react-virtuoso（已在依赖里），其余限量渲染（如最近 50 条 + 展开）。
- **预期效果**：长使用周期后 DOM 节点数有界，面板打开/滚动不卡。
- **风险**：低。

### U5【P2】renderer 移除主进程域模块
- **证据**：`main.tsx:45-46` 运行时 import `../agent/compaction` 与 `../agent/security/scan`，仅为取两个 payload 构造函数，把 agent 域代码链打进 renderer bundle。
- **方案**：纯构造函数抽到 `src/renderer/` 本地或共享 types 模块。
- **预期效果**：renderer bundle 瘦身（配合 S1 累计 -10%~15%），边界也更干净。
- **风险**：低。

### U6【P2】字体与微渲染
- **证据**：`styles.css:4` 全量导入 geist variable CSS，未声明 `font-display: swap`；diff 渲染同步逐行 `<div>`（`cards/registry.tsx:84-106`）。
- **方案**：font-display: swap；超大 patch（>500 行）折叠渲染。
- **预期效果**：首屏字体不阻塞；极端大 diff 不卡帧。风险：极低。

---

## 4. 打包体积（间接影响启动与内存）

### P1【P2】tree-sitter-wasms 发行裁剪
- **证据**：49MB 依赖；`electron-builder.yml` 已只 asarUnpack 四个用到的 grammar（ts/tsx/js/python），但**其余 ~45MB wasm 仍打进 asar**，是 dmg 120MB 的主因之一。
- **方案**：files 里 `!node_modules/tree-sitter-wasms/out/**` + 白名单放行四个 wasm；或 afterPack 钩子裁剪。
- **预期效果**：dmg **-40MB 量级**，下载/安装/首次启动磁盘读全受益。
- **风险**：低-中。需 map-check 覆盖四种语言验收防漏。

### P2【P3】依赖卫生
- `lucide-react` 39MB 源码包——确认 tree-shaking 生效（配合 S1 后看 bundle 是否含未用图标）；`@shadcn/react` 同理。

---

## 5. 优先级总表

| 级别 | 项 | 预期效果（估算） | 实施成本 | 风险 |
|---|---|---|---|---|
| **P0** | M1 getState 增量 replay | 流式期主进程 CPU -90%，内存峰值大降 | 小（基建已有） | 低 |
| **P0** | S1 minify | 冷启动 -200ms 级，双 bundle 减半 | 极小 | 低 |
| **P0** | S2 compile cache | 二次启动编译 -30~60% | 极小（两行） | 极低 |
| **P0** | S4 重依赖动态 import | 冷启动 -50~150ms，bundle 瘦身 | 中（调用链 async 化） | 低-中 |
| **P0** | U1 投影增量 memo | 流式期渲染线程 JS -50%+ | 中 | 中 |
| **P0** | S3 沙箱探测并行 | 异常宿主首窗 -数秒 | 小 | 中（安全语义） |
| **P1** | U2/U3 delta 合批 + 面板事件驱动 | 与 M1/U1 叠加，流式期全面减负 | 小-中 | 低 |
| **P1** | M2/M3/S5 scheduler 三件套 | 长跑内存有界，启动减负 | 中 | 低 |
| **P2** | U4/U5/U6/P1 | 长尾体验 + 包体 -40MB | 小 | 低 |

**建议节奏**：第一轮做 S1+S2+M1（一天内、纯收益、门禁全覆盖）；第二轮 S4+S3+U1+U2/U3；第三轮 scheduler 三件套与 P2 长尾。

## 6. 测量方案（先基线后优化）

当前仓库**没有任何性能基线门禁**——优化前必须先立测量，否则无法证明收益：

1. **启动基线**：主进程 `process.uptime()` + `performance.mark` 记录 whenReady→window shown；渲染端 `performance.mark("first-paint")`。写入 `outputs/perf-baseline-2026-09-14.md`。
2. **流式压测**：用 fixtures/mock 长剧本（现有 e2e 基础设施）驱动 500+ 事件会话，`process.memoryUsage()` 采样 + renderer `performance.measure` 帧耗时，前后对比。
3. **门禁纪律**：每轮优化跑 `pnpm gates`；新增性能断言应进 `scripts/gate-manifest.ts`（清单即事实源），而非口头宣称。

## 7. 明确不做的

- 不改 `sandbox:false`（已备案取舍，CJS preload 改造属独立议题）。
- 不动判卷冻结文件（fixtures/todo-app/tests、fixtures/mock）。
- 不引入新运行时依赖（全部优化用现有依赖/Electron 内建能力完成）。
