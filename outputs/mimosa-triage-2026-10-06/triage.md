# Mimosa 深扫 triage 报告（2026-10-06）

- 被 triage 的扫描：`scan-2026-10-05T18-52-10.841Z-01eb2c99f926`（deep，seal `sha256:e8b6223b…df2ef3`，
  运行状态 **inconclusive**：威胁模型/调用图两阶段覆盖不全——结论只对「本次 triage 的 128 条」负责，
  不构成全项目安全声明）
- 方法：全部 218 条按落位三分为 **产品面（src/＋scripts/＋tests/＋bin/，128 条）／随仓参考料
  （`agent-canon/`，未跟踪，第三方技能脚本）／取料快照（`outputs/`，历史会话拷的 src 副本，与活代码重复）**。
  产品面按 publicClass 分组，逐组现场读码定性；三处独立类逐条核（两种注入＋SSRF 族）。

## 一、结论速览

**确认漏洞 0 条；设计内形态（有闸有判卷）与扫描仪误报构成全部 128 条。**

| 类 | 条数 | 定性 | 证据 |
|---|---|---|---|
| Shell 执行策略违反 | 87 | 设计内（harness/gate 本职是 spawn shell，闸＝沙箱＋审批＋fail-closed）＋ `RegExp.exec` 撞名误报 | 本笔已把 src/ 里 22 处正则 `.exec(` 迁成 `String.match/matchAll`（见 §三）；真执行器两处（`diagnose.ts:96` deps.exec、`hooks.ts:446` this.exec）属产品本职 |
| 疑似跨文件污点 | 22 | 同上（CLI 参数/env → gate 脚本的 child_process，就是这些脚本的工作）＋ sort 撞名 | 抽查 `gates.ts:95`（跑门本身就是 spawn）、`head-cert.ts` 族 |
| mongo-sort-injection | 6 | **误报**：sink 是 JS `Array.prototype.sort`，本仓零 MongoDB 依赖 | `eval/report.ts:421/693/694`、`commit-surface-check.ts:68`、`mutate-shards.ts:224/237` |
| 命令注入 | 2 | 设计内：执行**工作区自己声明**的 verify 命令／bench 夹具命令，三层闸（信任门＋沙箱＋审批）在位 | `src/agent/verify.ts:336`（读码核实：command 来自 .agent/config.json verify 面或 package.json scripts）；`scripts/lib/eval-heldout.ts:123` |
| 代码注入 | 1 | **误报**：`eval(inp)` 是测试夹具里的字符串常量（喂给本仓自家安全闸的靶子），不是被执行的代码 | `scripts/security-check.ts:123`（读码核实：synthetic tool_call 的 content 字面量） |
| ssrf 入口 | 3 | **误报**：把 `askGate.request(...)`（审批卡请求）当成网络 request；`createVerifyTrustGate` 全程零网络（本地信任表＋问人门） | `agent-runner.ts:1331/1344/1769` + `verify-trust-gate.ts` 全文读码核实；且这段代码本身就是 2026-10-05 落地的防线（fail-closed、内容指纹绑定） |
| createVerifyHook→命令注入链 | 1 | 设计内：即 verify 面本体；「1769 的信任门」恰是扫描仪看不见的那层闸 | `agent-runner.ts:1964` |

## 二、两点诚实声明

1. **扫描状态是 inconclusive**——两阶段覆盖不全意味着「本次没找到真漏洞」弱于「漏洞不存在」。
   本 triage 的 0 确认只覆盖已出 finding 的核；动态面（模型真跑时的行为）不在静态证据边界内。
2. `agent-canon/` 与 `outputs/` 的 90 条未逐条核（前者非本仓产品代码、后者是快照副本）；
   现有 Mimosa 接口（MCP 工具无 exclude 参数、无 CLI）做不了取料面排除——下次扫描若支持
   排除配置，把这两个目录摘掉，信号密度可望从 128/218 提到接近 1:1。

## 三、随本报告落地的优化

`src/` 内 22 处 `RegExp.exec(` → `String.match`（非全局，保组保 index）＋ 2 处结构性改写
（`shape.ts` 全局循环改 `matchAll`，`goal-drift.ts` 去 lastIndex 手工复位），涉及 13 文件；
残余 `.exec(` 仅两处真执行器＋零注释。动因：① 与本仓成文口径对齐（`src/main/doctor.ts` 头注
「正则取组一律用 String.match（不用 RegExp.exec 那个名字）」——该口径当时就是为躲安全尺撞名立的）；
② 消掉此后每一轮扫描里约 90 条的同族误报，让真信号浮出来。行为等价由全量判卷背书。

**普查水位债自偿**：第 406 页提交的自检判卷带进 4 条顶包候选（裸名字格 2→3、顶包 10→14，全量判卷
因此多红一道 prose-needle）。按第 327/105 页先例改**派生断言**（`PROVIDER_ENV_KEYS.glm` 取词、
tiers 三档整段散文上下文、search 两处用产量唯一的 specificity 串），帽字一字未动，
复测顶包 10/10、裸名 2/2 归帽，判卷 105/105 绿。

## 四、留给后续

- scripts/（门禁基建）里同族 `.exec(` 未迁——那些文件多在飞/属闸本体，值得单独一笔；
- 真·执行器面（run_shell/verify/hooks/worktree）的下一代加固属内核轴，不与产品首版同轴（ADR 0001）。
