# 仓库整理与任务清单（收口版）

收口日期：2026-10-26（Asia/Shanghai）。主对象：`/Users/ze/Downloads/Cairn/cairn`。
起点基线 `014ac0e33c8879ee06031f16cfd2438caf93674e`（`fix/spec-summary-double-count`）。
同级 staging 只读核对，基线 `7bd237ee53f53ec1357b0662657a77bd220dcb0d`（`integration`）。

本页是任务的唯一入口：已完成、仍阻塞、待开工与「先测后改」四栏都在这里。历史证据保留在
`PROGRESS.md` 与 `outputs/`，本页只写现态与下一步，不复述已作废的判断。

## 一、本次收口做了什么

| 面 | 结果 | 证据 |
|---|---|---|
| Git 完整性 | 25 个指向重建前 DAG 的本地分支全部处置：23 个 tip tree 已在 HEAD 对象集，内容无丢失；`codex/pointer-final-closeout` 的 70 个 HEAD 外 blob 先完整归档再删；两棵树不可读的 `evo-registry-replay` / `worker-12` 先导出可读内容并保留 tarball 副本再删。审计时的 37 个命名 ref 中，25 个坏 ref 已处置，剩余 15 个全部可遍历；`git log --all` 正常。 | `/Users/ze/Downloads/Cairn/git-quarantine-20261026/REPORT.md`、`ARCHIVE-INDEX.json`、`deleted-refs-20261026.txt`、`quarantined-broken-refs.txt` |
| 孤立工作树 | `.worktrees/orchestration-kernel` 的已跟踪差分与 26 个未跟踪文件先归档，再移除；该树是第 711 页之前那一版停在 provider 摘要空转的纵切，已被 `100fc3b` 的实现取代 | `git-quarantine-20261026/worktree-orchestration-kernel/{tracked.patch,untracked.tar.gz}` |
| 未提交批次 | 工作树按功能拆成 15 笔提交（见下节），每笔都写明页面来源与复跑读数；共享文件整文件入库、跨批 hunk 在提交说明里点名 | `git log 014ac0e3..HEAD` |
| 编排文档 | 设计稿状态从「尚未实施」改为 P0–P4 已实施 + P3 明确未实现；交付报告的两个全量读数按快照身份分开，「未提交」改为实际提交链 | `docs/superpowers/specs/2026-10-25-multi-agent-orchestration-platform-design.md`、`outputs/orchestration-delivery-2026-10-25/FINAL.md` |
| 清理五件 | 用户确认后删除；删除补丁与反向恢复补丁均适用检查通过 | 本页「清理清单」 |
| 文档门 | `docs-check` 全绿；D-11 的 82 条旧地址随取料目录改名同步，剩余 4 条由补入两笔 `head-cert` 原文归零 | `outputs/head-cert-f8b86e4-2026-10-22-{0824,0831}/provenance.md` |

### 15 笔提交（`014ac0e3..HEAD`）

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
| `ab.py` | 未跟踪的外部 benchmark 脚本；旧记录明确保留 | 保留（仍未跟踪，来源与用途待裁） |
| `outputs/`、`PROGRESS.md`、`archive/` | 门禁与历史事实源 | 保留 |
| staging、旧 worktree、补丁、压缩包与 wip/untracked 备份 | 恢复与差量核对已完成；worktree 已归档移除，其余保留 | 保留 |

五个删除候选共 **791,683 bytes，约 773 KiB**。

## 三、原「未完成」逐项结果

| 优先级 | 事项 | 结果 |
|---|---|---|
| P0 | Git 完整性与恢复副本核对 | **已收口（有边界）**：25 个坏 ref 全部归档后处置，所有命名 ref 与 `HEAD` 遍历通过；`git fsck` 仍有 37 条 broken link / missing，全部属于**不可达**的重建前对象（ADR 0007 已判永久不可恢复），不构成任何 ref 的缺口。未运行 `gc/prune`，避免把仓外归档之外的旧对象一并删掉。 |
| P0 | 未提交功能批次集成 | **已收口**：工作树拆成 15 笔提交；`git status` 只剩 `ab.py`。每个批次在提交说明里列了页面来源、共享文件与复跑读数。 |
| P1 | 编排原设计缺口 | **已按允许的「正式缩范围」收口**：P0–P4 本地纵切已实现（154 条编排判卷全绿）；P3 的 `race`、`gather any/quorum`、动态控制与远程 worker 未实现，`flow.ts` 对它们显式 fail-closed；本地后端对 network/shell/git 能力拒收。设计稿新增「实施状态」表写明理由。 |
| P1 | 编排文档与证据收口 | **已收口**：设计稿不再写「尚未实施」；FINAL 的两次全量读数按「提交树 `5dcb67b`」与「共享主树」分开标注；「未提交」改为实际提交链。 |
| P1 | 指针会话集成状态 | **代码面已核**：CLI `src/cli.ts:1375` 调用 `createProductFork`；桌面 Stream 的 `EventRef` 在 `apps/desktop/src/renderer/components/Stream.tsx:269/393/405/488` 有渲染与 `data-event-ref` 落点。真实交互见下一行。 |
| P1 | 活跃会话连续发送与插话 | **连续发送已实测**：`session-continuity-smoke.cjs` 7/7 PASS（三次发送只建一个日志、重启恢复、续发追加、新建任务分叉、无控制台错误）。**插话 e2e 仍不可跑**：`steer-smoke.cjs` 1/6，根因是 gallery 桩无法把活动会话的 `running` 置起来（脚本头注已写明）；组件级插话判卷 `composer-steer` / `stream-steering-round` 在桌面 1483 条里全绿。未宣称端到端已证。 |
| P1 | 记忆、自进化新接线验收 | **已收口到判卷层**：27 个 memory/evolution 判卷文件 332 条全绿；`post-run-readings.ts` 的反思/蒸馏/毕业/Assess/canary 调用点在场。**收益**（真实配对读数）仍未取，不能由判卷绿替代。 |
| P1 | DeepSeek 真连与契约核验 | **阻塞**：`https://api.deepseek.com/chat/completions` 无 key 返回 401；本机未找到 `DEEPSEEK_API_KEY`。wire/定价/续聊/缓存判卷 11 文件 170 条全绿，但这是 stub，不是真实厂商可用性。需要一把 key 才能完成本项。 |
| P1 | 当前完整验证和交付 | **主体完成**：根 typecheck 0；core 518 文件 6971 条全绿（`--maxWorkers=2`，exit 0）；桌面 223 文件 1483 条 + boundary 绿；桌面 build 绿；docs-check 绿；编排 154、记忆/进化 332、provider 170、权限 112、搜索/用量 64、插件 58、元认知 26。`pnpm gates` 的 27 道非 HEAD 门全绿；`head-cert-check` 见第七节；`mutate-verify` 锚点全表本轮未跑完，不宣称。 |

## 四、待开工（条件未变，不启动）

| 事项 | 状态 / 启动条件 | 来源 |
|---|---|---|
| 远程 worker、动态 Flow、更高并发 | 原设计有要求，当前未实现；先定可强制权限、取消和断线恢复 | 编排设计 §14、`flow.ts`、`local-backend.ts` |
| 编排 P5 真实评测 | 独立验证者、完整失败回执、明确费用预算；scripted DAG 不证明真实收益 | 编排设计 P5、交付报告 |
| 元认知扩大确认试验 | 有界 pilot 已完成，默认不开新策略；更多未见任务、固定预算、重复配对是采用条件 | `docs/research/metacognition-pilot-2026-10-25.md` |
| SDK/API、A2A 与其他领域包 | P6 留门，接口占位不算已支持 | 编排设计 §16 |
| 对外分发与 Windows | B2 首个真实外部用户触发；先更新过期范围，再立安装/打包/矩阵验收 | `b2-checklist.md`、ADR 0001/0002 |
| 官网、遥测、多租户、计费、市场 | 目前未纳入实现；有明确产品需求后单独立项 | B2、编排 Non-goals |
| 取料归档治理 | 先查 PROGRESS/docs-check/冻结判据对工件的依赖，给出可恢复迁移，再裁决 | `scripts/repo-hygiene-check.ts`、取料盘点 |

## 五、需要优化（先测后改；本轮新增读数）

| 优先级 | 事项 | 事实与下一步 |
|---|---|---|
| P1 | 状态文档漂移 | 本页重写为唯一入口；历史计划页不再逐勾重开。多份旧报告仍保留，引用时必须带日期与快照身份。 |
| P1 | 证据占比与检索噪声 | 现读 **4041 / 6176 = 65.4%** 的跟踪文件在 `outputs/`。体量门绿不代表材料无用；下一步是短索引（按页面/批次），不是删证据。 |
| P1 | 真实交互覆盖 | 连续发送 7/7；插话 e2e 1/6（gallery 桩的 running 立不住）；取消/恢复、跨窗口仍只有组件级判卷。 |
| P2 | Radix 下拉依赖 | 构建产物现读：`index` 176.11 kB（gzip 60.71）、`App` 268.32 kB（gzip 83.75）、`xterm` 329.31 kB（gzip 83.04）。**首开延迟未测**（需要真 Electron 命中测试）；先量再决定是否懒加载。 |
| P2 | 长会话/长列表/大 diff | 29 MB unified diff：`clipDiff` 到 200k 字符后 `parseUnifiedPatch` 0.4 ms；10k 事件 `projectStream` 1.7 ms。**渲染耗时与长尾未测**（只量了纯函数）。 |
| P2 | FilePane 与设置可发现性 | 组件与 a11y 判卷在桌面 1483 条内；围绕文件选择、失败恢复、键盘与可访问名称的**真机验收未做**。 |
| P2 | 用量与成本 | usage analytics 5 文件 64 条绿；缺 usage、部分返回、取消/恢复与跨模型价格仍保留 unknown（不折 0）。真实账单口径未验。 |
| P2 | LSP 并发/取消 | 7 个 lsp 判卷文件在 core 终跑中通过；历史「首次失败、单跑通过」本轮未复现，不据此改代码。 |
| P2 | 大入口冲突成本 | 行数现读：`src/main/agent-runner.ts` 1868、`src/cli.ts` 1669、`apps/desktop/src/main/index.ts` 1434。无明确冲突/热路径证据前不拆。 |

## 六、事实面

- 代码/工作区：`verified-current`（本轮 15 笔提交均可复跑）。
- 文档：`changed-and-verified`（本页、STATE、PROGRESS 第 713 页、ADR 0007 后续）。
- 规则：`verified-current`（读取未改）。
- 运行/发布：`out-of-scope`（未打包、未部署）。
- 真实模型/真实外部用户：`pending`（DeepSeek 缺 key；steer e2e 受 gallery 桩限制）。

## 七、证据与最终验证

复核现场（仓外）：`/Users/ze/Downloads/Cairn/git-quarantine-20261026/`（Git 归档与报告）、
`/tmp/cairn-continuity-evidence-20261026c/`（连续发送 7/7 截图与 checks）、
`/tmp/cairn-steer-evidence-20261026c/`（插话 1/6 与失败明细）。
本轮日志在 `.tmp/goal-20261026/`（core / desktop / build）。

| 检查 | 本轮结果 |
|---|---|
| 根 typecheck | 0 条错误 |
| docs-check | 全绿（D-11 的 82 条旧地址已随目录改名同步） |
| 桌面套件 + boundary | 223 文件 1483 条全绿；boundary 绿 |
| 桌面 build | tsc 0；vite build 绿 |
| 编排判卷 | 10 文件 154 条全绿 |
| 记忆/进化判卷 | 27 文件 332 条全绿 |
| provider 判卷 | 11 文件 170 条全绿（stub wire） |
| 权限判卷 | 4 文件 112 条全绿 |
| 搜索/用量判卷 | 5 文件 64 条全绿 |
| 插件判卷 | 5 文件 58 条全绿 |
| 元认知判卷 | 5 文件 26 条全绿 |
| 连续发送 smoke | 7/7 PASS（真 Electron，当前构建） |
| 插话 smoke | 1/6（gallery 桩的 running 立不住；组件级判卷全绿） |
| core 终跑 | **518 文件 6971 条全绿，exit 0**（`pnpm test:capped` = `--maxWorkers=2`）｜日志 `.tmp/goal-20261026/core-final-5.log` |
| `pnpm gates` | 30 道门：27 道非 HEAD 门全绿；`test` 的 2 条既有债已在本轮修掉（core 转全绿）；`web-fetch-check` 的五档缺口已修并复跑 7/7；`head-cert-check` 见下；`mutate-verify` 未跑完 |
| `head-cert-check` / `mutate-verify` | `head-cert-check` 在 `f2ccc6ce` 上复跑（日志 `.tmp/goal-20261026/head-cert-final.log`）；`mutate-verify` 锚点全表本轮未跑完，不把部分读数当认证 |

## 八、未做的边界

- 没有运行 `git gc` / `git prune`：37 条不可达的缺失对象仍在对象库里；删除它们会丢失重建前旧 DAG 的最后可寻址痕迹，仓外归档才是保留面。
- 没有真实模型请求（缺 DeepSeek key）；没有真实外部用户；没有打包分发。
- 插话 e2e 的根因已记录，但没有为让判据变绿去改产品代码。
- 本页的读数是本轮实测；`PROGRESS.md` 历史页里的旧读数不随之改写。
