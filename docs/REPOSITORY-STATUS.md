# 仓库整理与任务清单（收口版）

初始收口日期：2026-10-26；复核补测：2026-10-27（Asia/Shanghai）。主对象：`/Users/ze/Downloads/Cairn/cairn`。
起点基线 `014ac0e33c8879ee06031f16cfd2438caf93674e`（`fix/spec-summary-double-count`）。
同级 staging 只读核对，基线 `7bd237ee53f53ec1357b0662657a77bd220dcb0d`（`integration`）。

本页是任务的唯一入口：已完成、仍阻塞、待开工与「先测后改」四栏都在这里。历史证据保留在
`PROGRESS.md` 与 `outputs/`，本页只写现态与下一步，不复述已作废的判断。

## 一、本次收口做了什么

| 面 | 结果 | 证据 |
|---|---|---|
| Git 完整性 | 25 个指向重建前 DAG 的本地分支全部处置：23 个 tip tree 已在 HEAD 对象集，内容无丢失；`codex/pointer-final-closeout` 的 70 个 HEAD 外 blob 先完整归档再删；两棵树不可读的 `evo-registry-replay` / `worker-12` 先导出可读内容并保留 tarball 副本再删。审计时的 37 个命名 ref 中，25 个坏 ref 已处置，剩余 15 个全部可遍历；`git log --all` 正常。 | `/Users/ze/Downloads/Cairn/git-quarantine-20261026/REPORT.md`、`ARCHIVE-INDEX.json`、`deleted-refs-20261026.txt`、`quarantined-broken-refs.txt` |
| 孤立工作树 | `.worktrees/orchestration-kernel` 的已跟踪差分与 26 个未跟踪文件先归档，再移除；该树是第 711 页之前那一版停在 provider 摘要空转的纵切，已被 `100fc3b` 的实现取代 | `git-quarantine-20261026/worktree-orchestration-kernel/{tracked.patch,untracked.tar.gz}` |
| 未提交批次 | 工作树按功能拆成多笔提交（15 笔批次主体 + 判卷/文档/凭证收尾，主体见下节），每笔都写明页面来源与复跑读数；共享文件整文件入库、跨批 hunk 在提交说明里点名 | `git log 014ac0e3..HEAD` |
| 编排文档 | 设计稿状态从「尚未实施」改为 P0–P4 已实施 + P3 明确未实现；交付报告的两个全量读数按快照身份分开，「未提交」改为实际提交链 | `docs/superpowers/specs/2026-10-25-multi-agent-orchestration-platform-design.md`、`outputs/orchestration-delivery-2026-10-25/FINAL.md` |
| 清理五件 | 用户确认后删除；删除补丁与反向恢复补丁均适用检查通过 | 本页「清理清单」 |
| 文档门 | `docs-check` 全绿；D-11 的 82 条旧地址随取料目录改名同步，剩余 4 条由补入两笔 `head-cert` 原文归零 | `outputs/head-cert-f8b86e4-2026-10-22-{0824,0831}/provenance.md` |

### 2026-10-27 复核补记

- 空屏首发发现真实运行键错位：`createSession` 回包带 workspace 后，`setActiveWorkspace` 要到下一拍才可见；
  旧 `run-queue` 用闭包里的 `null` 把 running 记成裸会话 id，界面却用新 workspace 算键，停止钮与插话入口都消失。
  现在起跑、收束、队列统一走 workspace ref；单测钉住首轮 running 键。
- 连续发送 smoke 7/7；插话 smoke 从 1/6 修到 **6/6**；取消后继续发送 smoke 4/4。
- 跨工作区恢复 7/7；双窗口工作区所有权 13/13；FilePane 真机 25/25；设置页真机 15/15。
- 400 轮长会话真实 renderer：启动 153.3 ms、首开 475.3 ms、流式帧 p50 26.2 / p95 31.9 / max 33.1 ms，
  DOM 39,585 节点，预算门通过。取料：`outputs/repository-status-2026-10-27/performance.json`。
- Radix 模型下拉真机命中：首开 17.3 ms，复开 p50 6.4 / p95 7.3 ms；依赖树 251,225 B（主路由闭包 45.3%）。
  暂不拆懒加载——读数不支持先付六处触发钮与首开 chunk 的改造代价。
- 4000 行 diff 真机挂载：191.1 ms、20 hunks、24,570 节点；仅记录帽内最坏形状，不据此拍脑袋拆组件。
- `mutate-verify` 全表在提交 `fc056d03` 上 **1621/1621 条变异全部被杀死，exit 0**，耗时
  2145.4 s；取料见 `outputs/repository-status-2026-10-27/mutate-verify.md`。
- `head-cert-check` 在 `fc056d03` 上先出现 24/25（干净认证树的桌面门 2 文件 3 条失败，
  同时检测到 1 套并发判卷），随后在两端独占时 **25/25 全绿，exit 0**。红绿两份原文都保留；
  首趟详情见第九节。`3579f49` 的 25/25 历史认证仍保留。

### 2026-10-27 统一运行时补记

- 本地 agent 生命周期已落地：逻辑 thread 与 run 分离，`send_agent`、`list_agents`、
  `resume_agent`、`close_agent` 使用同一 fenced `AgentRuntime`；重复 send/close 与 stale fence
  有定向判卷。
- 动态编排已落地：`race` 与 `gather any/quorum` 使用候选组，赢家/法定人数确定后按 task id
  取消输家；迟到结果只追加隔离收据，不改写当前任务状态。
- 远程执行已有 outbound JSON-RPC 适配器：能力、fence、契约摘要、deadline、heartbeat 和
  幂等键均在 fake worker 中判卷；连接或心跳丢失转为 `needs_you`，token 只走 Authorization
  header。该适配器当前只接收只读/无副作用任务，尚无可控远程交付与回滚。
- 恢复判卷覆盖 `running`、`verifying`、`merging` 三种崩溃现场：无活动执行器时全部转
  `needs_you`，重复恢复不追加状态；恢复后的迟到结果与重复 control 不改写终态。
- 定向套件 `remote-backend`、`orchestration-dynamic-control`、`local-agent-runtime`
  当前 **3 文件 / 29 条全绿**。完整 core/typecheck/docs 读数在本轮任务收口时追加。
- 未验证边界：真实外部 worker 部署、跨机器网络分区、远程写回/回滚、真实 provider 收益，
  以及编排控制面的真实用户交互。

### 2026-10-28 独立桌面包补记

- macOS arm64 ad-hoc 包已产出；打包态冒烟、解压到源码树外启动、签名与链接审计均通过
  （产物在 `apps/desktop/release/`，被 git 忽略）。打包态同时暴露并修复了 IPC 壳根取错：
  `app.getAppPath()` 在 runtime package 里少一层，改为从主进程入口推 `shellAppPath`。
- 仍阻塞：Developer ID / 公证、稳定签名下的真实钥匙串首启、Windows/Linux 打包、
  真实 provider 与外部用户验收。读数与红样本见 PROGRESS 第 753/756 页（取料目录待提交后补链接）。

### 2026-10-27 互操作补记

- 通用工具检索已落地：`src/agent/tool-search.ts` 的确定性 BM25 排序 + `tool_search` 只读元工具；
  目录含静态 schema 与**未激活**的 MCP 工具，检索不激活、不执行；执行仍走 `gatedMcpTool`。
- SDK v1 已落地：`src/interop/sdk.ts` 的 `AgentClientV1`、显式能力协商、公开事件联合与脱敏投影；
  工具执行表由宿主注入，缺省空表 fail-closed，不会静默回落到静态 `TOOLS`；
  ACP 适配器 `src/interop/acp.ts` 把这些事件映射为 `session/update` 通知；
  `src/interop/acp-stdio.ts` 提供有界 newline-delimited stdio 传输，请求并发分派，
  prompt 运行中可收到 `session/cancel`。
- A2A 任务桥已落地：`src/interop/a2a.ts`，task id → 逻辑 agent id、message id → 幂等键、
  内容寻址 artifact、公开生命周期映射、cancel/resume 携带协议版本与 fence；
  `src/interop/a2a-http.ts` 提供 loopback JSON-RPC HTTP、agent card、请求体上限与
  404/405/415/413 显式拒绝。
- 产品宿主/服务已落地：`src/main/interop-host.ts` 把 SDK run 接到 `handleAgentRun`，
  `src/main/interop-a2a-runtime.ts` 把 A2A 任务接到同一产品会话（只读）；
  `pnpm acp-server --workspace <dir>` 提供 ACP stdio，`pnpm a2a-server --workspace <dir>`
  提供 loopback HTTP。两者默认 unattended / 只读，未加权限桥与认证/TLS。
- 外部基准适配已落地：`src/interop/benchmarks.ts` 支持 Harbor/Terminal-Bench 形态任务与
  ExternalRunRecord；`scripts/external-bench.ts` 把外部证据落成 JSONL，缺用量/无结果保持
  `null`/`unknown`，首跑失败不被重试覆盖。夹具读数：`outputs/interop-c-2026-10-27/external-bench.jsonl`。
- 定向判卷：`tool-search`、`tool-search-tool`、`interop-sdk`、`interop-acp-stdio`、
  `interop-a2a`、`interop-a2a-http`、`interop-benchmarks`、`interop-host`、
  `interop-a2a-product`、`acp-server-cli`、`a2a-server-cli` 共 11 文件 **42 条全绿**
  （工作树，`--maxWorkers=2`）。
- 全量读数（工作树）：串行 `pnpm test:capped --maxWorkers=1` **551 文件 / 7148 条全绿，
  exit 0**（291.18 s，`.tmp/c-full-product-1w2.log`）。2-worker 首趟 7146/7148，两条失败
  （`post-run-readings` / `scratch-tree-naming`）单跑 27/27；串行首趟唯一失败是 README
  invoke 通道数 108 vs 运行时 109（并发桌面批次新增通道），已按现读改为 109，复跑全绿。
  `typecheck` 0、`docs-check` 全绿、`tools-check` 36 条、`model-surface-check` 6/6、
  `prompt-surface-check` 绿。取料：`outputs/interop-c-2026-10-27/verification.md`。
- 未验证边界：真实 ACP 客户端握手与权限桥、A2A 认证/TLS/SSE、Harbor/Terminal-Bench 真实执行、
  真实远程 worker 部署与真实 provider 收益；ACP/A2A 产品服务已用 demo provider 端到端判卷，
  但外部客户端/网络面仍未认证。当前工作树未提交，未跑 `head-cert-check` / `mutate-verify`，
  以上不是 HEAD 认证。

### 批次主体 15 笔（`014ac0e3..HEAD`；另有 11 笔收尾）

| 提交 | 内容 |
|---|---|
| `99675a23` | ADR 0007 后续：重建后地址的引用与 69 个取料目录对齐 |
| `62d102f6` | 记忆 M7 + 自进化闭环 v2（PROGRESS 702/707/709） |
| `d22f538c` | DeepSeek 一等家与 V4.1 Flash 校准（710） |
| `76942fdf` | 权限 full-access 第五档与硬边界判卷 |
| `f8ab28ae` | 联网搜索设置面与跨会话用量账 |
| `51a9856f` | 元认知 pilot 运行态、沙箱与判卷 |
| `9706bf98` | 两笔 head-cert 原文 + MCP 惰性激活语料 |
| `19909d78` | 自进化判卷四条裸词断言改成生产原句（压回顶包水位） |
| `b072e2c0` | MCP 惰性激活与声明式导入（ADR 0006） |
| `4c38b08c` | 桌面 703–708 + 品牌/设置/用量/会话预览等界面 |
| `7465bd68` | CLI / 会话 / IPC v23 / 工具面 / 压缩上下文 |
| `1f462871` | 449 件在飞批次取料入库 |
| `8f68b1cb` | typecheck 归因、loop-eval/memory-check 读数、技能路由判卷 |
| `f9d20ef5` | 收口文档：本页/STATE/PROGRESS 713/ADR 附记/编排文档对齐 + 五件删除 |
| `30c86a84` | 判卷收尾：自造文案改派生、靶子运行态清理 |

## 二、清理清单（已完成）

| 对象 | 判断与证据 | 处置 |
|---|---|---|
| `gen_legs.py` | 固定自行车坐标的单次 IK 生成器，无执行消费者；测试只在注释中提及旧算法 | 已删除（用户确认） |
| `pel_verify.py` | 硬编码两组动画数据的旧验证脚本；已由读取实际产物的 `scripts/anim-geometry-check.ts` 替代 | 已删除（用户确认） |
| `pelican-bike.html` | 单次演示页；桌面投影测试的同名是事件字符串，不读取文件 | 已删除（用户确认） |
| `de.md` | 外站 DeepEval README 副本，无当前执行或文档入口依赖 | 已删除（用户确认） |
| `jev.html` | 外站整页 HTML 快照，无当前执行消费者 | 已删除（用户确认） |
| `pelican-bicycle.html` | 几何测试直接读取的正确标本；render-image 和 HTML 检查也引用 | **保留**；未来可迁入 fixture |
| `anim-geometry-check.ts`、`anim-js-geometry-check.ts`、`svg-figure-check.ts` | 支持传入文件，有独立测试 | 保留开发检查 |
| `src/agent/system-prompt.ts` | 只有通用视觉自检与落盘交付要求 | 无需再删 |
| `ab.py` | Aider polyglot 基准跑分脚本副本（`import aider`、`polyglot-benchmark`、`.aider.results.json`）；从未提交、仓内无代码引用，本机缺依赖跑不起来 | **已移入仓外归档**：`/Users/ze/Downloads/Cairn/archive-external-2026-10-26/`（SHA-256 `ba350b7b…de9c30`，业主 2026-10-26 确认） |
| `outputs/`、`PROGRESS.md`、`archive/` | 门禁与历史事实源 | 保留 |
| staging、旧 worktree、补丁、压缩包与 wip/untracked 备份 | 恢复与差量核对已完成；worktree 已归档移除，其余保留 | 保留 |

五个删除候选共 **791,683 bytes，约 773 KiB**。

## 三、原「未完成」逐项结果

| 优先级 | 事项 | 结果 |
|---|---|---|
| P0 | Git 完整性与恢复副本核对 | **已收口（有边界）**：25 个坏 ref 全部归档后处置，所有命名 ref 与 `HEAD` 遍历通过；`git fsck` 仍有 37 条 broken link / missing，全部属于**不可达**的重建前对象（ADR 0007 已判永久不可恢复），不构成任何 ref 的缺口。未运行 `gc/prune`，避免把仓外归档之外的旧对象一并删掉。 |
| P0 | 未提交功能批次集成 | **已收口**：工作树拆成多笔提交；`ab.py` 已移入仓外归档，`git status` 干净。每个批次在提交说明里列了页面来源、共享文件与复跑读数。 |
| P1 | 编排原设计缺口 | **本地运行时已补齐，远程只到适配器边界**：P0–P4 本地纵切已实现；动态 `race` / `gather any/quorum`、确定性取消与迟到结果隔离已判卷；远程 JSON-RPC 适配器覆盖能力、fence、摘要、deadline、heartbeat、幂等与断线 `needs_you`。当前只支持只读/无副作用远程任务，真实外部部署与受控写回仍未验证。 |
| P1 | 编排文档与证据收口 | **已收口**：设计稿不再写「尚未实施」；FINAL 的两次全量读数按「提交树 `5dcb67b`」与「共享主树」分开标注；「未提交」改为实际提交链。 |
| P1 | 指针会话集成状态 | **代码面已核**：CLI `src/cli.ts:1375` 调用 `createProductFork`；桌面 Stream 的 `EventRef` 在 `apps/desktop/src/renderer/components/Stream.tsx:269/393/405/488` 有渲染与 `data-event-ref` 落点。真实交互见下一行。 |
| P1 | 活跃会话连续发送与插话 | **端到端已实测**：连续发送 7/7；插话 6/6（运行中回车真的调用 `runSteer`、回执与队列互斥、主进程拒绝时回落入队）；取消后继续发送 4/4；组件级判卷仍在桌面套件内。 |
| P1 | 记忆、自进化新接线验收 | **已收口到判卷层**：27 个 memory/evolution 判卷文件 332 条全绿；`post-run-readings.ts` 的反思/蒸馏/毕业/Assess/canary 调用点在场。**收益**（真实配对读数）仍未取，不能由判卷绿替代。 |
| P1 | DeepSeek 真连与契约核验 | **登记为外部依赖（业主 2026-10-26 决定本轮不验真连）**：官方端点无 key 返回 401、本机无 `DEEPSEEK_API_KEY`；wire/定价/续聊/缓存判卷 11 文件 170 条全绿，但这是 stub，不是真实厂商可用性。本项不再算本轮未完成；将来拿到 key 后按 `src/providers/deepseek.ts` 与 `scripts/native-reasoning-probe.ts` 已备的入口补真实读数。 |
| P1 | 当前完整验证和交付 | **主体完成**：根 typecheck 0；core 518 文件 6971 条全绿（`--maxWorkers=2`，exit 0）；桌面 223 文件 1484 条 + boundary 绿；桌面 build 绿；docs-check 绿；编排 154、记忆/进化 332、provider 170、权限 112、搜索/用量 64、插件 58、元认知 26。`pnpm gates` 的 9 道相关门在 `3579f49` 上全绿（子集，40 道未作为一条命令全跑）；`head-cert-check` 在 `fc056d03` 上最终 **25/25 道认证门全绿**（exit 0，首趟并发红样本保留）；`mutate-verify` 全表在该提交上 **1621/1621 全杀死**，exit 0。 |

## 四、待开工（条件未变，不启动）

| 事项 | 状态 / 启动条件 | 来源 |
|---|---|---|
| 真实远程 worker 部署与更高并发 | 本地动态 Flow 与只读远程适配器已实现；真实外部 worker、网络分区、远程写回/回滚和 100+ 实机并发仍待验证 | 编排设计 §7.8/§14、`remote-backend.ts`、`remote-protocol.ts` |
| 编排 P5 真实评测 | 独立验证者、完整失败回执、明确费用预算；scripted DAG 不证明真实收益 | 编排设计 P5、交付报告 |
| 元认知扩大确认试验 | 有界 pilot 已完成，默认不开新策略；更多未见任务、固定预算、重复配对是采用条件 | `docs/research/metacognition-pilot-2026-10-25.md` |
| SDK/API、A2A 与其他领域包 | 传输中立 SDK/ACP/A2A 桥、ACP stdio/A2A loopback HTTP 产品服务与外部基准适配已实现（2026-10-27）；A2A 产品运行时只读；**真实 ACP 客户端握手/权限桥、A2A 认证/TLS/SSE、真实 Harbor/Terminal-Bench 执行仍未认证** | 编排设计 §16、互操作设计 §Implementation Status |
| 对外分发与 Windows | **macOS ad-hoc 包已产出并核验**（PROGRESS 753/756）；Developer ID/公证、稳定签名下的真实钥匙串首启、Windows/Linux 与外部用户验收仍待做 | `b2-checklist.md`、ADR 0001/0002 |
| 官网、遥测、多租户、计费、市场 | 目前未纳入实现；有明确产品需求后单独立项 | B2、编排 Non-goals |
| 取料归档治理 | 先查 PROGRESS/docs-check/冻结判据对工件的依赖，给出可恢复迁移，再裁决 | `scripts/repo-hygiene-check.ts`、取料盘点 |

## 五、需要优化（先测后改；本轮新增读数）

> 2026-11-01 复核：本节里标「现读」的数字已按**当前工作树**重量（脚本与读数见 `outputs/status-doc-refresh-2026-11-01/`）。延迟类读数（首开/复开 ms、流式帧）本轮**没有**重量，所以依赖它们的结论一条没动。

| 优先级 | 事项 | 事实与下一步 |
|---|---|---|
| P1 | 状态文档漂移 | 本页重写为唯一入口；历史计划页不再逐勾重开。多份旧报告仍保留，引用时必须带日期与快照身份。 |
| P1 | 证据占比与检索噪声 | 现读跟踪面约 **4278 / 6291 = 68.0%** 在 `outputs/`（2026-11-01 复核）。体量门绿不代表材料无用；已建本页第九节的页面/批次短索引，不删证据。 |
| P1 | 真实交互覆盖 | 连续发送 7/7；插话 6/6；取消/恢复 4/4；跨工作区 7/7；双窗口工作区 13/13。剩余空白是编排控制面的真实交互。 |
| P2 | Radix 下拉依赖 | 构建产物（2026-11-01 复核）：`index` 175.11 kB（gzip 60.40）、`App` **305.89 kB（gzip 95.52）**、`xterm` 321.59 kB（gzip 80.79）——`App` 自 10-27 的 268.40 kB / 83.82 涨了 **+37.5 kB / gzip +11.7 kB**；依赖树 251,225 B / 49 模块（10-27 读数，未重量），主路由闭包 -45.3% 的理论收益。真机首开 **17.3 ms**、复开 p50 **6.4 ms** / p95 **7.3 ms**；暂不懒加载。 |
| P2 | 长会话/长列表/大 diff | 真实 renderer（**2026-11-01 复核，五跑**，取料 `outputs/perf-recheck-2026-11-01/`）：400 轮会话启动 **187.7–311.8 ms（中位 270.1，离散度 1.66×）**、首开 503.0–656.9（中位 551.9）；流式帧 p50 28.9–34.8、p95 36.1–44.8、max 36.2–47.8 ms；DOM **42,807** 节点（五跑一致）。对照 10-27 的单点读数（启动 153.3、首开 475.3、p95 31.9、39,585 节点）：**DOM +8.1% 是确定性的**；时间类只高不低，但五跑离散度已接近 2×，单点对比不足以判定「翻倍」之类的趋势结论（第 955 页曾据两跑写成「启动约 2×」，第 956 页用五跑修正）。三档预算（p95 200 / max 500 / 启动 1500）五跑全过。FilePane 500 项目录 smoke 通过；4000 行 diff 挂载 191.1 ms（10-27 读数，未重量）。长尾仍只覆盖一个本机样本。 |
| P2 | FilePane 与设置可发现性 | FilePane 真机 25/25（键盘、失败恢复、窄窗、长路径、只读态、路径菜单）；设置页 15/15（独立用量页、窄窗、测试连接、密钥不落明文、重载恢复）。 |
| P2 | 用量与成本 | usage analytics 5 文件 64 条绿；缺 usage、部分返回、取消/恢复与跨模型价格仍保留 unknown（不折 0）。真实账单口径未验。 |
| P2 | LSP 并发/取消 | 7 个 lsp 判卷文件在 core 终跑中通过；历史「首次失败、单跑通过」本轮未复现，不据此改代码。 |
| P2 | 大入口冲突成本 | 行数现读（2026-11-01 复核）：`src/main/agent-runner.ts` **2023**、`src/cli.ts` **1869**、`apps/desktop/src/main/index.ts` **2104**——较 10-27 分别 +155 / +200 / **+670**（涨幅来自工作树里未提交的批次，不是已发布基线）。仍无明确冲突/热路径证据，不拆。 |

## 六、事实面

- 代码/工作区：`verified-current`（本轮提交均可复跑）。
- 文档：`changed-and-verified`（本页、STATE、PROGRESS 第 715 页、ADR 0007 后续）。
- 规则：`verified-current`（读取未改）。
- 运行/发布：`out-of-scope`（未打包、未部署）。
- 真实模型：`out-of-scope`（业主决定本轮不验真连，登记为外部依赖）；真实外部用户：`pending`（没有外部用户样本，不以离屏 smoke 代替）。

## 七、证据与最终验证

复核现场：`outputs/repository-status-2026-10-27/`（本轮补测原始 JSON 与命令）、
`/Users/ze/Downloads/Cairn/git-quarantine-20261026/`（Git 归档与报告）。
历史失败样本仍保留在 `/tmp/cairn-steer-evidence-20261026c/`；本轮日志在 `.tmp/goal-20261026/`。

| 检查 | 本轮结果 |
|---|---|
| 根 typecheck | 0 条错误 |
| docs-check | 全绿（D-11 的 82 条旧地址已随目录改名同步） |
| 桌面套件 + boundary | 223 文件 1484 条全绿；boundary 绿 |
| 桌面 build | tsc 0；vite build 绿 |
| 编排判卷 | 10 文件 154 条全绿 |
| 记忆/进化判卷 | 27 文件 332 条全绿 |
| provider 判卷 | 11 文件 170 条全绿（stub wire） |
| 权限判卷 | 4 文件 112 条全绿 |
| 搜索/用量判卷 | 5 文件 64 条全绿 |
| 插件判卷 | 5 文件 58 条全绿 |
| 元认知判卷 | 5 文件 26 条全绿 |
| 连续发送 smoke | 7/7 PASS（真 Electron，当前构建） |
| 插话 smoke | 6/6 PASS（运行中插话、回执、队列互斥、拒绝回落） |
| 取消/恢复 smoke | 4/4 PASS（运行中入队、停止后接上同一会话、收束清空） |
| 跨工作区 / 双窗口 | 7/7、13/13 PASS |
| FilePane 真机 | 25/25 PASS |
| 设置页真机 | 15/15 PASS |
| 400 轮长会话性能 | PASS：启动 153.3 ms、首开 475.3 ms、帧 p50 26.2 / p95 31.9 / max 33.1 ms |
| Radix 下拉延迟 | 首开 17.3 ms；复开 p50 6.4 / p95 7.3 ms |
| 4000 行 diff | 191.1 ms，20 hunks / 24,570 节点 |
| core 终跑 | **518 文件 6971 条全绿，exit 0**（`pnpm test:capped` = `--maxWorkers=2`）｜日志 `.tmp/goal-20261026/core-final-5.log` |
| `pnpm gates` | 9 道相关门（子集）在 `3579f49` 上全绿；40 道未作为一条 `pnpm gates` 全跑，不能写成全量 gate 认证 |
| `head-cert-check` | **`fc056d03` 上 25/25 道认证门全绿，exit 0**：core 518/6971、desktop 1484、e2e、docs-check、web-fetch、mutate-needles 等；红、绿原文见 `outputs/head-cert-fc056d0-2026-10-26-1651/provenance.md` 与 `outputs/head-cert-fc056d0-2026-10-26-1656/provenance.md`。`3579f49` 的历史 25/25 原文也保留 |
| `mutate-verify` | **`fc056d03` 全表 1621/1621 条被杀死，exit 0，2145.4 s**；专用 worktree、未设预算、3242 次判卷 spawn；取料 `outputs/repository-status-2026-10-27/mutate-verify.md` |

## 八、未做的边界

- 没有运行 `git gc` / `git prune`：37 条不可达的缺失对象仍在对象库里；删除它们会丢失重建前旧 DAG 的最后可寻址痕迹，仓外归档才是保留面。
- 没有真实模型请求（缺 DeepSeek key）；没有真实外部用户；没有打包分发。
- 插话/取消/恢复与 FilePane/设置已完成真机 smoke；编排控制面仍是组件/服务面判卷，未宣称真实用户全流程。
- Radix 依赖树仍随主路由进入首屏；当前延迟读数不支持先做六处懒加载改造。
- `fc056d03` 首趟 `head-cert-check` 的桌面红发生在检测到并发判卷时；完整失败日志随认证树回收，
  3 条失败名未补回，因此只把它当不可归因的并发污染样本，不用它推断产品回归，也不删这份红样本。
- 本页的读数是本轮实测；`PROGRESS.md` 历史页里的旧读数不随之改写。

## 九、取料短索引（按页面 / 批次）

| 批次 | 入口 | 用途 |
|---|---|---|
| 2026-10-27 复核 | `outputs/repository-status-2026-10-27/` | 本轮插话、取消/恢复、跨窗口、FilePane、设置、性能与 Radix 原始读数 |
| 2026-10-27 变异 | `outputs/repository-status-2026-10-27/mutate-verify.md` | `fc056d03` 的 1621/1621 全表变异原文摘要与运行边界 |
| 2026-10-26 收口 | `PROGRESS.md` 第 713 页；`outputs/orchestration-delivery-2026-10-25/` | Git 收口、编排纵切与交付读数 |
| 2026-10-25 元认知 | `outputs/metacognition-v2-acceptance-2026-10-25/` | 有界 pilot 验收与未决边界 |
| 2026-10-27 认证 | `outputs/head-cert-fc056d0-2026-10-26-1651/`、`outputs/head-cert-fc056d0-2026-10-26-1656/` | `fc056d03` 首趟 24/25 并发红与复跑 25/25 绿的两份原文 |
| 2026-10-27 历史认证 | `outputs/head-cert-3579f49-2026-10-26-1611/` | `3579f49` 的 25/25 认证原文 |
| 2026-10-25 认证 | `outputs/head-cert-f79077e-2026-10-25-1839/` | 上一笔 `f79077e2` 的历史认证原文 |
| 2026-10-20 桌面基线 | `outputs/desktop-performance-2026-10-20/` | 旧版首屏、流式与 bundle 预算基线 |
| 2026-10-25 工作区清理 | `outputs/workspace-cleanup-2026-10-25/` | worktree、备份与残留处置凭证 |
