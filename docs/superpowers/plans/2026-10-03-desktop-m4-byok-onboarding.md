# m0 桌面端 M4：BYOK 与首启 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 公开产品的凭据与上手闭环：BYOK key 经预设录入→Keychain 存储→启动注入生效（fail-closed 判卷绿）、两步首启（选工作区→配凭据）、设置页（默认权限档/默认模型/主题），并收齐 M2/M3 triage 到 M4 的承接小件。

**Architecture:** 后端面在 M3 末已被并行会话全量接通（wired 39/39：getSettings/setSettings/providerKey 三件套/getOnboarding/onboarded 字段齐备）——本计划几乎全部活在 `apps/desktop/src/renderer/` 与装配层（index.ts 的 `injectStoredProviderKey` 启动接线是唯一 main 侧新逻辑）。core 零改动；`AgentApi` 若需扩展仅类型同步（runCancel 先例）。

**Tech Stack:** 同 M1-M3。**命名实况**：并行会话已落 m0→cairn 改名（包名 `cairn-desktop`、env `CAIRN_SMOKE`）；本计划 UI 文案产品名随实况用 cairn；Global Constraints 的命令一律 `pnpm -C apps/desktop …`（对包名免疫）。

**Spec:** `docs/superpowers/specs/2026-10-02-desktop-shell-design.md`（§2#7 BYOK、§6.3、§7 首启两步、§11 M4 行）＋M2/M3 终审承接清单。

## Global Constraints

- core 零改动（git diff src/ 必须为空；AgentApi 类型同步若需，逐笔裁定并 ledger）。
- scripts/ 是并行会话在飞领地（docs-check/head-cert/mutate-verify 均在动）——**本计划不碰 scripts/**；apps/desktop 变异面扩展裁定为不做（等改名收口后 core owner 定），ledger 记录。
- BYOK 纪律（spec §2#7）：key 存 safeStorage→Keychain（providerKeySet 已 fail-closed：不可用即拒绝不落明文）；**启动注入**走 `src/main/provider-key-inject.ts` 的 `injectStoredProviderKey(PROVIDER_IDS)`（env 优先：该家 env 已在 = 零行为）；明文零落盘三处纪律（不落日志/不进事件流/不进 settings）。
- 首启允许 demo 演示模式走通（BYOK fail-closed 下 demo 是唯一免 key 路径——不强迫用户先有 key）。
- 视觉 token 只用既有变量；产品名文案用 cairn（与改名会话对齐）。
- 并行会话脏文件不碰不 add；根门形状当次实测如实记录。
- 桌面测试 `pnpm -C apps/desktop test`；冒烟 `pnpm -C apps/desktop smoke`。

---

### Task 1: 启动注入接线＋fail-closed 判卷

**Files:**
- Modify: `apps/desktop/src/main/index.ts`（装配段）
- Test: `apps/desktop/tests/provider-keys.test.ts`（新）

**Interfaces:**
- Consumes: `injectStoredProviderKey(providers?)`（src/main/provider-key-inject.ts，electron-free：只依赖 provider-keys + providers/env-keys）；`PROVIDER_IDS`（src/main/provider-keys.ts）。
- Produces: 装配时（settings host deps 初始化后、host 创建前）调用注入，结果 console 记一行（不含 key 值）；headless 判卷覆盖 fail-closed 面。
- 勘定窗口：`provider-keys.ts` 的存储实现是否 electron-free 可注入（M1 codegraph 示 ProviderKeyStore 三 caller）——若 safeStorage 依赖经 host deps 注入则 headless 直接测；若硬依赖 electron.safeStorage，则测试经 fake deps 注入缝（provider-key-inject 的 `providers` 形参就是判卷缝先例），报告落勘定结论。

- [ ] **Step 1: 写失败测试**（key 存储→注入→provider env 生效的 headless 全链；safeStorage 不可用 ⇒ set 拒绝不落明文——判据按勘定结果落）
- [ ] **Step 2: 跑红 → Step 3: 实现装配接线 → Step 4: 三绿**（test/typecheck/build）
- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/tests/provider-keys.test.ts
git commit -m "桌面端 M4-1：BYOK 启动注入接线——injectStoredProviderKey 进装配（env 优先零行为、结果无 key 值留痕）＋fail-closed headless 判卷（safeStorage 不可用拒绝不落明文）"
```

---

### Task 2: 设置面板 UI

**Files:**
- Create: `apps/desktop/src/renderer/components/SettingsPanel.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`（设置入口：侧栏底部⚙已有占位→开面板）、`styles.css`
- Test: `apps/desktop/tests/settings-panel.test.ts`（新，纯函数）

**Interfaces:**
- Consumes: getSettings/setSettings（wired）；providerKeySet/Delete/Status（wired）；getProviderInfo（M2 deferred 的刷新在此收口：settings 变更成功后重拉目录）。
- Produces:
  - 面板块：**凭据**（provider 下拉=ProviderKind 全集 demo+四家；选真实家 ⇒ key 输入行＋保存（providerKeySet）＋已存状态（providerKeyStatus 的 stored 列表＋删除）＋env 并存提示）；**默认档**（mode 下拉=PERMISSION_MODES）；**默认模型**（model 文本输入＋说明"留空=provider 缺省"；与 ModelPicker 的 per-session 覆盖关系：settings 为缺省、会话选择覆盖）；**主题**（system/light/dark——本任务只落设置面，主题应用随 M5 一并接 CSS）；**方案门缺省**（planRequiredByDefault 开关）。
  - 纯函数 `providerStatusLabel(status)`（settings-panel.test 判卷：available/stored/envActive 三态文案）。
  - 设置保存经 setSettings(Partial<AppSettings>)——patch 面白名单（provider/model/mode/theme/planRequiredByDefault）由 UI 构造，不透传任意 patch。
- [ ] Step 1 失败测试 → Step 2 跑红 → Step 3 实现 → Step 4 三绿 → **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/SettingsPanel.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css apps/desktop/tests/settings-panel.test.ts
git commit -m "桌面端 M4-2：设置面板——凭据（provider 预设/key 录入删除/env 并存提示）、默认权限档、默认模型（settings 为缺省会话覆盖）、主题设置面、方案门缺省开关；getProviderInfo 刷新接线（M2 deferred 收口）；demo 选择协议闭环（settings.provider 可改，选演示真生效）"
```

---

### Task 3: 两步首启

**Files:**
- Create: `apps/desktop/src/renderer/components/Onboarding.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`、`styles.css`
- Test: `apps/desktop/tests/onboarding.test.ts`（新，纯函数）

**Interfaces:**
- Consumes: settings.onboarded 判据（false ⇒ 首启面覆盖主区，完成后 setSettings({onboarded:true})）；addProject/listProjects（T3/M3 已有）；Task 2 的凭据块（复用 SettingsPanel 的凭据段或提炼共享组件——勘定后择一，报告记录）。
- Produces:
  - `needsOnboarding(settings): boolean` 纯函数（!onboarded）。
  - 两步流：Step1 选/添加工作区（复用添加表单＋列表点选）；Step2 凭据（选 demo 演示 或 配一家 key）⇒ 完成 setSettings({onboarded:true})。"跳过"允许（保持 demo）——**不强迫 key**。
  - 首启面期间不渲染主 composer（避免未配置就派活）。
- [ ] Step 1 失败测试（needsOnboarding；步骤推进状态机纯函数）→ Step 2 红 → Step 3 实现 → Step 4 三绿 → **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/Onboarding.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css apps/desktop/tests/onboarding.test.ts
git commit -m "桌面端 M4-3：两步首启——onboarded 判据覆盖主区（选/添加工作区→凭据或演示跳过），完成落 settings.onboarded；不强迫 key（demo 唯一免 key 路径保通）"
```

---

### Task 4: 承接小件打包（M2/M3 终审 triage 项）

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`、`components/ApprovalCard.tsx`、`apps/desktop/tests/projections.test.ts`（live ts 断言落投影测试）
- Test: 随附

**Interfaces（逐项，全部已 triage）：**
- 审批卡 decide 失败反馈（M2 T4/M3 终审 M-4）：`decide` 返回 false 或 reject ⇒ ErrorStrip 提示"审批提交失败"（三卡失败反馈就此齐）。
- lastError 会话键控（M3 T4 deferred）：`Map<sessionId, string>`，切会话各看各的。
- per-session running UI（M2 T5/M3 终审）：打断按钮与 composer disabled 按 **activeId 的运行态**键控（kernel-host 能否查询"哪些会话在跑"？host 无此查询通道——**裁定：renderer 侧以 runningSet(全量) ∪ 当前 activeId 判定**；kernel-host 加 `runningSessions(): string[]` 查询通道属 AgentApi 扩展——勘定后择一：若加，走 ipc-protocol 类型同步先例并 ledger）。
- createSession 白名单拒绝的错误条面（M3 修复波照亮）：send 的 createSession await 挪进 try 块，reject ⇒ ErrorStrip。
- live ts renderer 断言（M2 终审 I-2 的后半）：projections.test 加一例——projectStream 输入事件带 ts ⇒ 行透传（M2 已有）＋**App 消费面**：openSession 回读旧日志无 ts ⇒ 行无时间戳列（该断言若属组件行为则落 m3-e2e 手法不可行，按勘定落纯函数面或记录不做理由）。
- [ ] Step 1-4 TDD 三绿 → **Step 5: Commit**

```bash
git add apps/desktop/src/renderer apps/desktop/tests
git commit -m "桌面端 M4-4：承接小件——审批卡 decide 失败反馈（三卡齐）、lastError 会话键控、per-session running UI（打断/禁用按会话态）、createSession 拒绝进错误条（await 入 try）、live ts 消费面断言（M2/M3 终审 triage 清尾）"
```

---

### Task 5: dialog 选目录＋removeProject 缩面

**Files:**
- Modify: `apps/desktop/src/main/index.ts`、`apps/desktop/src/preload/index.ts`、`apps/desktop/src/main/channels.ts`、`src/main/ipc-protocol.ts`、`apps/desktop/src/renderer/components/Sidebar.tsx`、`apps/desktop/src/renderer/App.tsx`
- Test: channels.test 扩展

**Interfaces:**
- dialog 选目录（M3 deferred）：**AgentApi 扩展 `pickDirectory(): Promise<string | null>`**（类型同步先例，ledger 记录）——main 端 `dialog.showOpenDialog({ properties: ["openDirectory"] })`；channels 表加 `pickDirectory: "agent:pick-directory"`；preload 程序化桥自动透传；Sidebar 添加表单加"浏览…"按钮（文本输入保留为手输路径的兜底）。
- removeProject 缩面（M3 deferred）：**KernelHost 加 `removeWorkspace(ws)`**（workspaces 数组移除＋归属表清该组条目＋漂移快照清理；**在跑会话的组不可移除**——fail-visible）；index.ts 的 removeProject handler 成功后同步调用（addWorkspace 对称）。
- [ ] Step 1-4 TDD 三绿 → **Step 5: Commit**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/main/channels.ts src/main/ipc-protocol.ts apps/desktop/src/renderer/components/Sidebar.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/main/kernel-host.ts apps/desktop/tests
git commit -m "桌面端 M4-5：dialog 选目录（AgentApi 扩展 pickDirectory，类型同步先例，表单加浏览按钮保手输兜底）＋removeWorkspace 缩面（removeProject 成功后对称移除；在跑会话的组 fail-visible 拒移）"
```

---

### Task 6: BYOK fail-closed 全链路验收＋M4 全量验收

**Files:**
- Test: `apps/desktop/tests/byok-e2e.test.ts`（新）
- Modify: 无（验收不加代码）

**Interfaces:**
- M4 验收锚（spec §11）："BYOK fail-closed 路径判卷绿"：
  1. safeStorage 不可用注入（fake deps）⇒ providerKeySet 拒绝且零明文落盘（userData 全目录 grep 断言无 key 串）；
  2. key 存入→injectStoredProviderKey→对应 provider env 在场（headless 注入缝）；
  3. env 已在 ⇒ 注入零行为（env 优先语义）。
- 全量验收：desktop test 全量、smoke、typecheck、根 typecheck、gates（并行红归因）、根 vitest 形状。
- [ ] Step 1 写 e2e → Step 2 全绿 → **Step 3: Commit**

```bash
git add apps/desktop/tests/byok-e2e.test.ts
git commit -m "桌面端 M4-6：BYOK fail-closed 全链路判卷（不可用拒绝零明文/存入即注入/env 优先零行为三例）＋M4 全量验收落数"
```

---

## Self-Review（已执行）

1. **Spec 覆盖**：§2#7 BYOK→T1/T2/T6；§7 首启两步→T3；§11 M4 行（服务商预设＋Keychain、两步首启、设置页默认权限档）→T1/T2/T3；M2 承接（getProviderInfo 刷新/demo 协议闭环→T2；审批卡反馈/lastError 键控/per-session running/live ts→T4）；M3 承接（dialog→T5；removeProject 缩面→T5；createSession 拒绝面→T4）。**不做（ledger 记录）**：apps/desktop 变异面（scripts/ 在飞，改名收口后 core owner 定）；worker 子视图（继续后置）；主题 CSS 应用（M5 随打包）。**关键前提勘定**：wired 39/39 由并行会话完成（本计划消费不重建）；injectStoredProviderKey 未接（T1 补）。
2. **占位扫描**：T1 safeStorage 勘定窗口、T4 running 查询通道勘定、T3 凭据组件复用勘定——均配手段与报告要求；无 TBD。
3. **类型一致**：needsOnboarding/providerStatusLabel/groupByWorkspace 既有面不动；pickDirectory/removeWorkspace 新增签名在 T5 定义即用。
