# Mimosa 深度扫描分诊报告

> 扫描：`scan-2026-09-12T15-46-50.007Z-2aa22644b6e6`（seal `sha256:ed166715…1adb`，2026-09-12 深度档，覆盖 H1 收口后树）
> 原始报告：`~/.mimosa/security-scans/project-55a677be581c66afc9e40429/<scanId>/`（findings.json / report.md / coverage.json）
> 分诊日期：2026-09-13。结论先行：**266 条中 0 条需要立即修复**；1 条纵深防御建议（已完成评估，未修）、1 条仓库卫生建议；其余为外来目录噪音 / 验收工具面 by-design / 产品核心功能的既有控制面 / 假阳。

## 一、总量与分布

| 维度 | 分布 |
|---|---|
| 严重度 | high 218 / medium 40 / low 8 |
| kind | static 206 / cross-file 51 / business-logic 9 |
| 路径 | **oh-src/ 237 条**（88.7%）/ 项目代码 29 条 |

**关键事实：`oh-src/` 是外来参考资料目录**——全仓构建链（tsconfig / electron.vite / package.json）与 `src/` 运行时对它**零引用**（已 grep 验证），不进编译、不进打包、不进任何验收路径。237 条 finding 与本项目产物无关，是扫描把参考材料当成了被审对象。

## 二、项目代码 29 条逐类定性

### 1. 验收工具面 by-design（13 条 high，全部 scripts/）
`sandbox-check` 的 runInSandbox ×5（**故意执行攻击命令**验证 Seatbelt 拦截——这正是沙箱门的反向验证）、`panels-check` ×5（CDP 驱动需 spawn 系统 Electron/命令）、`agents-check` ×2 与 `security-check` ×1（判卷脚本构造攻击样例字符串）。判卷代码不进生产运行时；**不修**。

### 2. 产品核心功能，控制面已闭环（4 条 high + 大部分 medium 污点）
- `run_shell.ts:45` / `verify.ts:139` / `respawn` 链的「命令注入」：执行模型/用户写的命令**就是产品本体**；控制面 = H1 的能力域权限门（shell_rw 纳入）+ deny 短路 + Seatbelt 沙箱 + sanitizedEnv（key 不落子进程）+ spawnTracked 进程组回收。
- 判：by-design with closed control loop；**不修**（控制面回归由 autonomy-check/agents-check 判卷）。

### 3. 假阳（4 条 high，已逐条回查源码证伪）
- `remove 是 path-traversal 入口` ×2（agent-runner 626/701 行附近）：会话/自动化删除全部经 `sessionPath`，其内已有 `isValidSessionName` 白名单（`/`、`\`、控制符、前导点全禁，`../` 必然被拒）——扫描器未解析到该校验。
- `approval 是 ssrf 入口` ×2：`approval()` 仅路由审批门（approve/reject），**无任何出网**；全仓唯一 URL 出网点（更新检查）已有 https 白名单（M4b 判卷）。

### 4. 硬编码凭据 14 条（high 1 + medium 13）
全部为 M2f 起备案的**演练假 key 字面量**（`sk-abcdefghijklmnopqrstuvwxyz012345`）与扫描规则自身字面（security-check 已知模式表）。既有备案成立，**不修**；真实 key 词边界扫描持续零命中。

### 5. business-logic 9 条（inconclusive）
「敏感操作未观察到角色/权限检查」等均为 candidate 证据态：静态层无法看到运行时审批链（审批卡/fail-closed/三闸都是运行时行为）。对应面已被 schedule-check F 段（无人值守 fail-closed 真实路径）与 autonomy-check 判卷覆盖；**不立项**，留待有凭据的运行时审计。

## 三、产出动作

1. **纵深防御建议（评估后暂不修）**：`oh-src` 建议移出仓库或加入扫描排除——它不进构建，留在工作区只会持续污染任何全仓扫描的信噪比（本报告即是例证：88.7% 的 finding 来自它）。是否移动属仓库结构决定，留给维护者。
2. **本轮已顺手落地**：分诊过程中核实的 `sessionPath` 校验（假阳反证）已确认有效；未新增代码改动。
3. **无需修复**：0 条。与 H1/H2 两轮已闭环的 6 条根因对照，本扫描未发现两轮遗漏的新的可达漏洞。

## 四、口径声明

本分诊是**对扫描结果的定性**，不构成「项目安全」的宣称：未证 2 项（GLM 真连 / testdino 远程 MCP）仍需凭据闭合，运行时注入/并发面建议在有凭据环境做一次实跑审计。
