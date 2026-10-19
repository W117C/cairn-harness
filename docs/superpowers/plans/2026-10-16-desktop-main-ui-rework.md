# Cairn 桌面端主界面重做（侧栏 + 空屏 + Composer + 对话区/检查器）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按业主 brief（2026-10-16）把桌面端主界面整体重做：侧栏（项目管理 + 会话列表）、空屏（居中输入 + 动态建议）、Composer（无路径输入 + @模糊搜索 + 拖拽/粘贴/技能菜单）、对话区（760 列 + 工具卡 + 审批卡键盘语义）、右侧检查器（改动/计划/时间线）与 ⌘K 命令面板。

**Architecture:** 三阶段交付（P1 侧栏+项目管理+会话列表 / P2 空屏+Composer / P3 对话区+检查器+⌘K），每阶段走完整交付链后停下给业主截图。新增 7 条 IPC（协议 v10→v11，76→83 通道）：git 两闸、项目内模糊搜索、最近打开、粘贴落盘、快照还原、Finder 显示。纯函数（分组/状态/建议/匹配）全部独立成模块走 TDD；UI 组件沿用既有 tokens + Popover + lucide + Radix，新用 cmdk（⌘K）与 sonner（Toast，两库已装未用）。内核事件格式与 CLI 一字不动。

**Tech Stack:** Electron 44 + React 18 + Vite + TypeScript；vitest（desktop 用 react-dom/server SSR 判卷 + 源文哨兵；根仓 node 判卷）；cmdk ^1.1.1 + sonner ^2.0.8（已装）；lucide-react；@radix-ui/react-dropdown-menu；react-resizable-panels。

**Spec:** `docs/superpowers/plans/2026-10-16-desktop-main-ui-rework-brief.md`（业主 brief 原文副本——执行者**必须**先读它；本计划引它为依据，两者冲突时以 brief 为准。）

## Global Constraints

以下逐条来自 brief（第一至九节 + 约束与验收），每个任务的要求都隐含包含本节：

1. **用户永远不需要输入绝对路径**。路径校验仍由 main 进程完成，UI 层不暴露任何内部实现细节。
2. **界面上不出现开发者术语**：RunRequest、attachments、main、run 前校验等一律不显示。必要解释进 "?" 提示，文案用人话。
3. **少即是多**：同屏可见控件尽量少，次要操作收进 ⌘K 命令面板或右键菜单。
4. **每个图标按钮必须有 tooltip；高频操作必须有快捷键，并在 tooltip 里显示**。
5. 不改内核事件格式和 CLI；需要新增 IPC 时写最小接口（本计划第五节已列全）。
6. 没有数据支撑的功能不造假数据；隐藏或标"即将推出"。
7. 所有文案走 i18n（本仓现状无 i18n 层 → 轻量 strings catalog，见 P1-1），中文简短、不含开发者术语。
8. 动效 120–200ms，尊重 `prefers-reduced-motion`；亮/暗两种主题都要检查。
9. 分阶段提交并停下给截图：**P1** 侧栏+项目管理+会话列表 → **P2** 空屏+Composer → **P3** 对话区+检查器+⌘K。
10. 自查清单：全流程无任何一处要求输入绝对路径；界面搜不到 RunRequest / attachments / main 等字样；所有图标按钮有 tooltip；空列表有引导文案。
11. 快捷键表：⌘N 新任务｜⌘O 打开文件夹｜⌘K 命令面板｜⌘⌥B 检查器｜⌘. 停止生成｜⌘⇧[ / ] 切换会话｜⌘, 设置（统一在设置里展示，tooltip 同步）。
12. 布局：左 侧栏（240–280px）｜中 对话区（内容列 760px 居中）｜右 检查器（默认收起，⌘⌥B，320–420px）。

**本仓流程约束（与 brief 并列，不可违）**：
- **不代 commit**：brief 的"分阶段提交"按"分阶段交付"执行——每阶段以「判卷绿 + 双 tsc 绿 + 真机截图」收口，**不执行 git commit**，除非业主明示。
- 保留他会话在飞脏改动（不 reset / 不 stash）；不修改冻结判卷文件当后门。
- 交付链（每阶段末）：`apps/desktop` 全量判卷 → 双 tsc（desktop + 根仓）→ 根仓判卷 → 隔离实例 CDP 真机截图（亮暗双主题）→ 重建 dist → design-spec §9 追记 → 净归零 → 停下给业主。

## 摸底结论（执行者必读，全部已核实）

1. **协议面现状**：v10，76 通道。四处同步钉：`src/main/ipc-protocol.ts`（`IPC_PROTOCOL_VERSION`）、`apps/desktop/src/main/channels.ts`（INVOKE_CHANNELS，映射类型是完整性红线）、`apps/desktop/src/main/index.ts`（`const wired: Record<InvokeChannel, …>` 全键表，禁 Partial、禁 `if (handler)` 静默跳过）、`apps/desktop/src/preload/index.ts`（`Object.fromEntries` 程序化桥——**加通道只加 channels.ts 行 + AgentApi 方法 + wired 行，preload 零改动**）。
2. **版本钉四处**：`tests/ipc-protocol-version.test.ts:16`（`toBe(10)`）、`apps/desktop/tests/protocol-version.test.ts:41`（`toBe(10)`）、`apps/desktop/tests/channels.test.ts:39`（`toHaveLength(76)`）、同文件 mustWire 名单（第 70–164 行，⑤ 锚定 `key:` 行 + ③④ 名单并集=全键）。
3. **会话终态不落盘**：JSONL 无 agent_status 终态事件 ⇒ 状态图标只能取「本进程可见态」：running（App 全局 running set）、waiting（asks 的 sessionId 映射）、ok/failed（App 在本进程内观察 run 结束事件记账）。**重启后图标归零是诚实行为，不是缺陷**——不写假终态、不动内核。
4. **本项目无 i18n 层**（全中文字面量）⇒ P1-1 建轻量 `strings.ts` 目录，覆盖全部重做面；未重做面（设置页等）暂不迁移，P3 汇报注明。
5. **「—」圆钮真实功能 = 用量环**（上下文水位百分数 + hover 明细 tooltip，`Composer.tsx` USAGE_RING）——**有用，保留**，brief 第五节"先确认真实功能"已确认。「Tab」角标 = v9「想下一条」suggest-next 单发——**有用，保留 + tooltip 说清**。
6. **标题生成已存在但无线程通道**：`kernel-host.ts:117 autoTitleFirstMessage` → `sessions.ts:366 deriveSessionTitle(message, maxWidth=32)`（首行截取、CJK 记 2 宽）。brief 允许"用当前模型或截取首句"⇒ 走既有截取路径（同步、零新通道），maxWidth 32→40（≈汉字 20 字），P1-6 落地。
7. **项目注册表**（`src/main/project-registry.ts`）：`add()` 对同路径已有记录 = 更新（name/defaultLocation）⇒ **「重命名显示名」「项目设置」零新通道**；无 recents 概念 ⇒ 新增 `lastOpenedAt` + `touch`（P1-3）。软删除记录仍在仓库（`includeRemoved` 可列）⇒「最近打开（8 个）」= 全部记录按 lastOpenedAt 倒序取 8（含已移除的，一键重加）。
8. **可复用件**：`window.agent.pathForFile`（webUtils，preload 已在）用于拖拽/粘贴取路径；PickDirectory（dialog）/ pickFiles（多选）已在；`workspaceListDir`/`workspaceReadText`/`workspacePathAction(abs/reveal/open)` 已在；`cmdk` 与 `sonner` 已装未用；Popover 共享组件在；`relativeTime()` 在 `projections.ts`；`MODE_LABEL` 四档在 `PermissionMenu.tsx`。
9. **PaneDock 现状**：右列是 react-resizable-panels 网格（变更/方案/任务/文件/终端/浏览器/旁聊七种窗格）。brief 的"检查器"是新的三 Tab 面（改动/计划/时间线）⇒ P3-2 建 `Inspector.tsx` 作为右栏**默认面**，既有七种窗格经 Inspector 的「＋」作为附加 Tab 接入（不删能力），右栏默认收起 + ⌘⌥B。
10. **模板清单以现有为准**（`project-templates.ts`）：static-site「展示网页」/ form-widget「表单小工具」/ data-panel「数据展示页」/ react-vite「React 小工具（需联网装依赖）」。`defaultProjectsRoot` = `~/Cairn Projects`，`createProjectFromTemplate` 缺省 parentDir 时自动 mkdir（brief 的"首次自动创建"已满足）；`parentDir` 可选传入 ⇒ 弹窗「更改…」接 pickDirectory。
11. **判卷基线**：desktop `pnpm exec vitest run`（node 环境，无 jsdom：SSR `renderToStaticMarkup` + 源文哨兵 + 纯函数）；根仓 `npx vitest run --config tests/vitest.config.ts`。已有相关判卷：`sidebar-groups.test.ts`（groupByWorkspace 纯函数）、`composer-*.test.tsx`（SSR）、`project-registry.test.ts`（根仓）。
12. **"最近失败的测试"无数据源**（无测试历史记录）⇒ 快速开始建议**不做**这一条（不造假），其余数据源：package.json scripts / git status / README 存在性 / 最近会话标题。

## 新 IPC 最小接口清单（v10→v11，76→83 通道）

全部在 **P1-0** 一次落地（一次版本 bump、四处钉一次改；后续阶段只消费）。命名与语义：

| # | AgentApi 方法 | 通道名 | 实现位置 | 语义与失败面 |
|---|---|---|---|---|
| 1 | `gitStatus(path: string)` | `agent:git-status` | 核 `src/main/git-ops.ts` | 分支名 + 未提交改动数；非仓库/git 缺席分别可辨，不抛（ok:false） |
| 2 | `gitClone({url, parentDir})` | `agent:git-clone` | 核 `src/main/git-ops.ts` | URL 白名单（https/ssh/git@）；克隆到 `parentDir/<repoName>`；目标已存在即拒 |
| 3 | `workspaceSearch(workspace, query)` | `agent:workspace-search` | 核 `src/main/workspace-search.ts` | 递归模糊搜索（跳过 .git/node_modules 等），扫描 2 万条帽 + 命中 50 帽截断如实标注 |
| 4 | `touchProject(id)` + `listProjects(options?)` | `agent:projects-touch` | `src/main/project-registry.ts` | `lastOpenedAt` 落盘；`listProjects({includeRemoved?, recentFirst?})` 形状变更（同键） |
| 5 | `saveTempFile({name, bytes})` | `agent:save-temp-file` | `apps/desktop/src/main/temp-file.ts` | ⌘V 截图落 `tmp/cairn-paste/`；字节帽 20MB；文件名消毒 |
| 6 | `snapshotRestore({path, snapshotId})` | `agent:snapshot-restore` | `src/main/change-diff.ts` 旁邻 | 检查器「撤销此文件改动」；先备份当前版本再还原（可再撤销） |
| 7 | `revealInFinder(path)` | `agent:reveal-in-finder` | `apps/desktop/src/main/index.ts` | 仅限**已登记项目路径**（防任意路径面）；shell.showItemInFolder |

## 文件地图（新/改一览）

**新建**
| 文件 | 职责 |
|---|---|
| `apps/desktop/src/renderer/strings.ts` | 文案目录（i18n 轻量层）：STR 对象，重做面全部用户可见文案 |
| `apps/desktop/src/renderer/sessions-view.ts` | 纯函数：groupByWorkspace（自 Sidebar 迁移）/ timeBucket / groupByTime / sessionStatus / projectSections |
| `apps/desktop/src/renderer/quick-starts.ts` | 纯函数：buildQuickStarts（动态建议 + 通用回退） |
| `apps/desktop/src/renderer/components/NewProjectDialog.tsx` | 新建项目 Dialog（模板卡网格 + 名字实时校验 + 位置） |
| `apps/desktop/src/renderer/components/AddProjectMenu.tsx` | 「添加项目」四入口菜单（打开文件夹/新建/克隆/最近 8） |
| `apps/desktop/src/renderer/components/CommandPalette.tsx` | ⌘K 命令面板（cmdk） |
| `apps/desktop/src/renderer/components/TimelinePane.tsx` | 检查器时间线 Tab（JSONL 事件投影 + 跳转） |
| `apps/desktop/src/renderer/components/Inspector.tsx` | 右侧检查器（改动/计划/时间线三 Tab + ＋扩展既有窗格） |
| `src/main/git-ops.ts` | git 两闸（core，electron-free、无 shell） |
| `src/main/workspace-search.ts` | 项目内模糊搜索（core） |
| `apps/desktop/src/main/temp-file.ts` | 粘贴落盘（temp 文件） |
| `apps/desktop/tests/sessions-view.test.ts` `quick-starts.test.ts` `strings.test.ts` `tooltip-audit.test.tsx` `sidebar-rework.test.tsx` `new-project-dialog.test.tsx` `composer-rework.test.tsx` `command-palette.test.tsx` `timeline-pane.test.tsx` | 新增判卷（各任务内详列） |
| `tests/git-ops.test.ts` `tests/workspace-search.test.ts` | 根仓判卷（core 纯函数 + exec 行为） |

**修改**
| 文件 | 改动 |
|---|---|
| `src/main/ipc-protocol.ts` | 7 方法 + 3 载荷类型 + listProjects 选项参 + `IPC_PROTOCOL_VERSION = 11` |
| `src/main/project-registry.ts` | `lastOpenedAt` + `touch()` + list 选项 |
| `src/main/change-diff.ts` | `restoreSnapshot()`（镜像既有 resolver 的路径校验） |
| `apps/desktop/src/main/channels.ts` | +7 行 |
| `apps/desktop/src/main/index.ts` | +7 wired 行 + handler 胶水（含 revealInFinder 的项目白名单） |
| `apps/desktop/src/main/kernel-host.ts` | `autoTitleFirstMessage` 调 `deriveSessionTitle(message, 40)` |
| `apps/desktop/src/renderer/App.tsx` | 布局/空屏/拖拽分流/⌘K/检查器/快捷键/会话 outcome 记账/最近项目 touch |
| `apps/desktop/src/renderer/components/Sidebar.tsx` | 整体重写（见 P1-4/5/6） |
| `apps/desktop/src/renderer/components/Composer.tsx` | 重做（见 P2） |
| `apps/desktop/src/renderer/components/PermissionMenu.tsx` `ModelPicker.tsx` | 色点 + 说明 + 合并弹窗（P2-5） |
| `apps/desktop/src/renderer/components/Stream.tsx` | 760 列 + 进度条 + hover 操作（P3-1） |
| `apps/desktop/src/renderer/mention.ts` | 改走 workspaceSearch（P2-4） |
| `apps/desktop/src/renderer/shortcuts.ts` | +⌘O/⌘K/⌘⌥B/⌘./⌘⇧[ ] 等 + SHORTCUTS 表统一（P3-3） |
| `apps/desktop/src/renderer/styles.css` | 各阶段节追加（含 reduced-motion 与双主题） |
| `apps/desktop/tests/channels.test.ts` `protocol-version.test.ts` + 根 `tests/ipc-protocol-version.test.ts` | v11/83 三钉 + 注释追记 |
| `tests/project-registry.test.ts` | lastOpenedAt/touch/recentFirst 用例 |
| `apps/desktop/tests/sidebar-groups.test.ts` | import 改自 sessions-view（判据原样） |
| `apps/desktop/design/desktop-design-spec.md` | §9 各阶段追记 |

## 阶段交付链（每阶段末执行，缺一不算完成）

```bash
# ① 判卷（desktop 全量）
cd apps/desktop && pnpm exec vitest run
# ② 双 tsc
cd apps/desktop && npx tsc -p tsconfig.json --noEmit
cd "/Users/ze/Downloads/Cairn/deepseek harness" && npx tsx scripts/typecheck.ts
# ③ 根仓判卷
cd "/Users/ze/Downloads/Cairn/deepseek harness" && npx vitest run --config tests/vitest.config.ts
# ④ 隔离实例 CDP 截图（亮 + 暗双主题，存 /tmp/cairn-ui-p1-*.png 等）
#    起隔离实例的既有手法：隔离 userData + 9222 调试口 + 钥匙密文副本注入（明文只在 Electron 进程内）；
#    链太长时拆小步跑（60s bash 超时坑）；收尾净归零（ps 查进程 kill + 端口关）。
# ⑤ 重建 dist（业主应用加载）
cd apps/desktop && pnpm run build
# ⑥ design-spec §9 追记（本阶段范围/裁决/实测留档/未决项）
# ⑦ 停下给业主：前后对比截图 + 手验点 + 未决项清单（不代 commit）
```

### Task P1-0: IPC v11 批（7 通道全落地）

**Files:**
- Modify: `src/main/ipc-protocol.ts`、`apps/desktop/src/main/channels.ts`、`apps/desktop/src/main/index.ts`、`src/main/project-registry.ts`、`src/main/change-diff.ts`
- Create: `src/main/git-ops.ts`、`src/main/workspace-search.ts`、`apps/desktop/src/main/temp-file.ts`
- Test: `tests/git-ops.test.ts`、`tests/workspace-search.test.ts`、扩展 `tests/project-registry.test.ts`；更新四处版本钉

**Interfaces:**
- Consumes: 既有 `projectRegistry`（index.ts 288 行附近已注入）、`changeDiff` 的路径校验手法（`src/main/change-diff.ts` 内 resolver，实施第一步先读）、`app.getPath("temp")`、`shell.showItemInFolder`
- Produces: 下表全部类型与方法（P1-4/P2/P3 直接消费）

- [ ] **Step 1: 写失败测试——git-ops 纯函数（根仓）**

```ts
// tests/git-ops.test.ts
import { describe, expect, it } from "vitest";
import { isCloneableUrl, repoNameFromUrl } from "../src/main/git-ops";

describe("git-ops（v11 主界面批）", () => {
  it("URL 白名单：https/ssh/git@ 过，file:// 与本地路径拒", () => {
    expect(isCloneableUrl("https://github.com/foo/bar.git")).toBe(true);
    expect(isCloneableUrl("ssh://git@github.com/foo/bar.git")).toBe(true);
    expect(isCloneableUrl("git@github.com:foo/bar.git")).toBe(true);
    expect(isCloneableUrl("file:///Users/ze/x")).toBe(false);
    expect(isCloneableUrl("/Users/ze/x")).toBe(false);
    expect(isCloneableUrl("https://host/a b")).toBe(false);
  });
  it("仓库名：剥尾斜杠与 .git；认不出 = null", () => {
    expect(repoNameFromUrl("https://github.com/foo/bar.git")).toBe("bar");
    expect(repoNameFromUrl("git@github.com:foo/bar")).toBe("bar");
    expect(repoNameFromUrl("https://github.com/foo/bar/")).toBe("bar");
    expect(repoNameFromUrl("https://github.com/foo/")).toBe(null);
  });
});
```

- [ ] **Step 2: 跑测试确认红**——`npx vitest run --config tests/vitest.config.ts git-ops`（FAIL：模块不存在）

- [ ] **Step 3: 实现 `src/main/git-ops.ts`**

```ts
// v11 主界面批：git 两闸（git status 读在场面 / git clone 拉远端）。
// core 层，electron-free；execFile 无 shell（URL 已白名单，参数不经 shell 解释）。
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const pexec = promisify(execFile);

/** 远端 URL 最小白名单：https:// / ssh:// / git@host:path。file:// 与本地路径拒（克隆源必须是远端）。 */
export function isCloneableUrl(url: string): boolean {
  if (/\s/.test(url)) return false;
  return /^https:\/\/[^\s]+$/.test(url) || /^ssh:\/\/[^\s]+$/.test(url) || /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[^\s]+$/.test(url);
}

/** URL → 仓库目录名：剥尾斜杠与 .git。认不出合法名 = null（调用方 fail-visible）。 */
export function repoNameFromUrl(url: string): string | null {
  const tail = url.replace(/\/+$/, "").split(/[/:]/).pop() ?? "";
  if (tail === "") return null;
  const name = tail.endsWith(".git") ? tail.slice(0, -4) : tail;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ? name : null;
}

export type GitStatusResult = { ok: true; branch: string | null; dirtyFiles: number } | { ok: false; error: string };

/** 读工作区 git 在场信息（分支 + 未提交条目数）。非仓库/git 缺席分别可辨；一切失败进 ok:false。 */
export async function gitStatus(workspace: string): Promise<GitStatusResult> {
  try {
    const head = (await pexec("git", ["-C", workspace, "rev-parse", "--abbrev-ref", "HEAD"], { timeout: 5000 })).stdout.trim();
    const porcelain = (await pexec("git", ["-C", workspace, "status", "--porcelain"], { timeout: 10000 })).stdout;
    const dirtyFiles = porcelain.split("\n").filter((l) => l.trim() !== "").length;
    // detached HEAD 时 rev-parse 回 "HEAD" 字面量——如实报 null，不拿 "HEAD" 冒充分支名。
    return { ok: true, branch: head === "" || head === "HEAD" ? null : head, dirtyFiles };
  } catch (err) {
    const e = err as { code?: string | number; stderr?: string; message?: string };
    if (e.code === "ENOENT") return { ok: false, error: "未找到 git（检查 PATH）" };
    const stderr = String(e.stderr ?? e.message ?? "").trim();
    if (stderr.includes("not a git repository")) return { ok: false, error: "不是 git 仓库" };
    return { ok: false, error: stderr.split("\n")[0] || "git 命令失败" };
  }
}

export type GitCloneResultT = { ok: true; path: string } | { ok: false; error: string };

/** 克隆到 parentDir/<repoName>（全量）；目标已存在即拒（不合并不覆盖）。 */
export async function gitClone(url: string, parentDir: string): Promise<GitCloneResultT> {
  if (!isCloneableUrl(url)) return { ok: false, error: "只支持 https / ssh / git@ 形式的仓库地址" };
  const name = repoNameFromUrl(url);
  if (name === null) return { ok: false, error: "从地址里认不出仓库名" };
  const dest = join(parentDir, name);
  if (existsSync(dest)) return { ok: false, error: `目标已存在：${dest}——换个位置或先移除它` };
  try {
    await pexec("git", ["clone", url, dest], { timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, path: dest };
  } catch (err) {
    const e = err as { code?: string | number; stderr?: string; message?: string };
    if (e.code === "ENOENT") return { ok: false, error: "未找到 git（检查 PATH）" };
    const stderr = String(e.stderr ?? e.message ?? "").trim();
    return { ok: false, error: stderr.split("\n").slice(-3).join("；") || "克隆失败" };
  }
}
```

- [ ] **Step 4: 绿 + 实现 workspace-search（同 TDD 节奏）**

```ts
// tests/workspace-search.test.ts —— 纯匹配器先红后绿
import { describe, expect, it } from "vitest";
import { fuzzyMatch, rankHits } from "../src/main/workspace-search";

describe("workspace-search 匹配器", () => {
  it("子序列命中：大小写不敏感，缺字不中", () => {
    expect(fuzzyMatch("cmp", "src/renderer/components/Composer.tsx")).not.toBeNull();
    expect(fuzzyMatch("zzz", "src/main/index.ts")).toBeNull();
  });
  it("词首/连续命中给更高分；排序把高分（更贴的）放前", () => {
    const hits = rankHits("index", ["src/index.ts", "docs/referential-index.md", "src/main/index.ts"]);
    expect(hits[0]!.path).toBe("src/index.ts"); // 词首 + 连续
  });
  it("空查询 = 空结果（不做全量倾倒）", () => {
    expect(rankHits("", ["a.ts"])).toEqual([]);
  });
});
```

`src/main/workspace-search.ts` 实现：`fuzzyMatch(query, target): number | null`（按序命中、连续 +2、词首 +3，见 P1 代码）、`rankHits(query, paths): {path, score}[]`（score 降序、长度升序、字典序；空查询 []）、`searchWorkspace(workspace, query)`（fs 递归：`SKIP_DIRS = {node_modules, .git, dist, dist-electron, build, .next, out, release}`，每层目录数帽 `MAX_SCAN_ENTRIES = 20000`、命中帽 `MAX_RESULTS = 50`、深度帽 12；命中集含目录与文件；截断时 `truncated: true`；workspace 不存在 = `{ok:false}`）。

- [ ] **Step 5: 注册表 lastOpenedAt/touch/recentFirst（TDD，扩展根仓 `tests/project-registry.test.ts`）**

用例先红：① `add` 后记录无 `lastOpenedAt`；`touch(id)` 后字段落在场且是 ISO 时刻；② `list({recentFirst:true})` 按 `lastOpenedAt ?? updatedAt` 倒序；③ 旧文件（无 lastOpenedAt 键）读取不炸、validate 放行可选字段。实现：
- `ProjectRecord` 加 `lastOpenedAt?: string`；`validateProject` 对在场字段用既有 `isTimestamp` 校验；`cloneProject` 原样。
- `touch(id)` 与 `remove` 同式（enqueue + isSafeId + 不存在抛 + `updatedAt/lastOpenedAt = now` + persist）。
- `list(options: { includeRemoved?: boolean; recentFirst?: boolean } = {})`：recentFirst 时排序键 `(p.lastOpenedAt ?? p.updatedAt)` 倒序，其余排序键不变。

- [ ] **Step 6: 协议面四处同步（含三钉）**
- `src/main/ipc-protocol.ts`：`IPC_PROTOCOL_VERSION = 11`（doc 注释追记"v11 = 主界面重做批（git 两闸/项目内搜索/最近打开/粘贴落盘/快照还原/Finder 显示）"）；`AgentApi` 新增 7 方法；`listProjects` 改 `(options?: { includeRemoved?: boolean; recentFirst?: boolean }) => Promise<ProjectRecord[]>`；新增并导出 `GitStatusPayload`、`WorkspaceSearchPayload`、`GitCloneResult` 三类型（形状见下表接口块）。
- `apps/desktop/src/main/channels.ts`：+7 行（`gitStatus: "agent:git-status"` … `revealInFinder: "agent:reveal-in-finder"`，组注释"v11 主界面重做批"）。
- `apps/desktop/src/main/index.ts`：wired 表 +7 行（`gitStatus: (workspace) => gitStatus(String(workspace))` 等；`touchProject: (id) => projectRegistry.touch(String(id))`；`listProjects` 行传参；`revealInFinder` 内联白名单：`const p = String(path); if (!(await projectRegistry.list({ includeRemoved: true })).some((r) => r.path === p)) return { ok: false, error: "只能对已登记的项目执行" }; shell.showItemInFolder(p); return { ok: true };`）。
- 钉更新：`apps/desktop/tests/channels.test.ts`（86→ `toHaveLength(83)` + mustWire 名单 +7 + 注释行"v11：＋（七条）⇒ 83"）、`apps/desktop/tests/protocol-version.test.ts`（`toBe(11)` + 追记）、`tests/ipc-protocol-version.test.ts`（`toBe(11)` + 追记）。

- [ ] **Step 7: temp-file 与 snapshotRestore**
- `apps/desktop/src/main/temp-file.ts`：`sanitizePasteName(name): string`（纯函数：剥路径分隔符与控制字符、限长 80、空则 "paste.bin"；先红后绿，desktop 判卷）+ `saveTempFile(name, bytes: unknown)`（Uint8Array/ArrayBuffer → Buffer；空/超 20MB/非法类型 = ok:false；落 `join(app.getPath("temp"), "cairn-paste")`，文件名 `${Date.now()}-${sanitized}`）。
- `src/main/change-diff.ts`：**先读该文件**的 snapshot 读取与路径校验实现（changeDiff 通道的 resolver——越界即拒的口径），镜像同口径加 `restoreSnapshot(path, snapshotId): Promise<{ok: boolean; error?: string}>`：读快照字节 → 校验目标路径合法 → **先写备份快照**（`writeFileAtomic` 或该文件既有快照写手法）→ 覆盖目标；快照缺失/目标缺失 = ok:false。判卷并入 `tests/change-diff*` 既有文件（无则新建 `tests/snapshot-restore.test.ts`）。

- [ ] **Step 8: 全量判卷 + 双 tsc 绿**（本任务不截图——纯后端，随 P1 阶段末统一真机）

### Task P1-1: 文案目录 + 会话视图纯函数

**Files:**
- Create: `apps/desktop/src/renderer/strings.ts`、`apps/desktop/src/renderer/sessions-view.ts`
- Test: `apps/desktop/tests/sessions-view.test.ts`、`apps/desktop/tests/strings.test.ts`
- Modify: `apps/desktop/tests/sidebar-groups.test.ts`（import 源改 sessions-view）

**Interfaces:**
- Consumes: `SessionInfoPayload`（ipc-protocol）、既有 `groupByWorkspace` 逻辑（Sidebar.tsx 现行实现整体迁入）
- Produces: `groupByWorkspace` / `OTHER_WORKSPACE`（再导出面不变）、`timeBucket(ms, nowMs): TimeBucket`、`groupByTime(list, nowMs)`、`sessionStatus({running, waiting, lastOutcome}): SessionStatus`、`projectSections(list, nowMs): Section[]`、`STR`（P1-4 起全部组件消费）

- [ ] **Step 1: 写失败测试（sessions-view）**

```ts
// apps/desktop/tests/sessions-view.test.ts
import { describe, expect, it } from "vitest";
import { groupByTime, projectSections, sessionStatus, timeBucket } from "../src/renderer/sessions-view";

const at = (iso: string): number => Date.parse(iso);
const now = at("2026-10-16T12:00:00");

describe("timeBucket（时间分组）", () => {
  it("同天=今天；前一天=昨天；7 天内=过去7天；更早=更早", () => {
    expect(timeBucket(at("2026-10-16T08:00:00"), now)).toBe("today");
    expect(timeBucket(at("2026-10-15T23:59:00"), now)).toBe("yesterday");
    expect(timeBucket(at("2026-10-11T10:00:00"), now)).toBe("past7");
    expect(timeBucket(at("2026-09-30T10:00:00"), now)).toBe("earlier");
  });
  it("groupByTime：空桶不列；桶序固定 今天→昨天→过去7天→更早", () => {
    const s = (id: string, iso: string) => ({ id, at: at(iso) });
    const groups = groupByTime([s("a", "2026-10-16T09:00:00"), s("c", "2026-10-11T09:00:00"), s("b", "2026-10-15T09:00:00")], now);
    expect(groups.map((g) => g.bucket)).toEqual(["today", "yesterday", "past7"]);
  });
});

describe("sessionStatus（诚实状态合成）", () => {
  it("活跃态压过历史态：running > waiting > failed > done > none", () => {
    expect(sessionStatus({ running: true, waiting: true, lastOutcome: "failed" })).toBe("running");
    expect(sessionStatus({ running: false, waiting: true, lastOutcome: "ok" })).toBe("waiting");
    expect(sessionStatus({ running: false, waiting: false, lastOutcome: "failed" })).toBe("failed");
    expect(sessionStatus({ running: false, waiting: false, lastOutcome: "ok" })).toBe("done");
    expect(sessionStatus({ running: false, waiting: false, lastOutcome: undefined })).toBe("none");
  });
});

describe("projectSections（置顶恒前 + 其余按时间）", () => {
  it("置顶段不与时间桶混排；非置顶进时间桶", () => {
    const mk = (id: string, iso: string, pinned = false) => ({ id, pinned, at: at(iso) });
    const secs = projectSections([mk("p1", "2026-09-01T00:00:00", true), mk("n1", "2026-10-16T01:00:00")], now);
    expect(secs[0]).toMatchObject({ kind: "pinned" });
    expect(secs[0]!.sessions.map((s) => s.id)).toEqual(["p1"]);
    expect(secs[1]).toMatchObject({ kind: "time", bucket: "today" });
  });
});
```

- [ ] **Step 2: 跑测试确认红**（模块不存在）

- [ ] **Step 3: 实现 sessions-view.ts**
把 Sidebar.tsx 的 `WorkspaceSession`/`WorkspaceGroup`/`OTHER_WORKSPACE`/`groupByWorkspace`/`workspaceLabel` **整体迁入**（判据一字不改，含 `pinnedFirst` 与去重保护），再增：

```ts
export type TimeBucket = "today" | "yesterday" | "past7" | "earlier";
const dayStart = (ms: number): number => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
export function timeBucket(updatedMs: number, nowMs: number): TimeBucket {
  const today = dayStart(nowMs);
  if (updatedMs >= today) return "today";
  if (updatedMs >= dayStart(today - 86_400_000)) return "yesterday";
  if (updatedMs >= dayStart(today - 7 * 86_400_000)) return "past7";
  return "earlier";
}
export type SessionStatus = "running" | "waiting" | "failed" | "done" | "none";
export function sessionStatus(input: { running: boolean; waiting: boolean; lastOutcome: "ok" | "failed" | undefined }): SessionStatus {
  if (input.running) return "running";
  if (input.waiting) return "waiting";
  if (input.lastOutcome === "failed") return "failed";
  if (input.lastOutcome === "ok") return "done";
  return "none";
}
export type SessionSection = { kind: "pinned"; sessions: WorkspaceSession[] } | { kind: "time"; bucket: TimeBucket; sessions: WorkspaceSession[] };
const TIME_ORDER: readonly TimeBucket[] = ["today", "yesterday", "past7", "earlier"];
export function groupByTime(list: readonly WorkspaceSession[], nowMs: number): { bucket: TimeBucket; sessions: WorkspaceSession[] }[];
export function projectSections(list: readonly WorkspaceSession[], nowMs: number): SessionSection[];
```

时间取 `Date.parse(s.updatedAt) || s.mtimeMs`（与现 SessionRow 同式）。`sessions-view.ts` 不引 React。

- [ ] **Step 4: strings.ts（目录 + 判卷）**

```ts
// apps/desktop/src/renderer/strings.ts —— 轻量文案目录（重做面唯一出口）。
// 约定：组件不写裸中文；新增文案先在此登记。未重做面（设置页等）暂不迁移（P3 汇报注明）。
export const STR = {
  app: { brand: "Cairn", newTask: "新任务", searchHint: "搜索会话…" },
  sidebar: { tempChats: "临时对话", empty: "还没有任务，按 ⌘N 开始", addProject: "添加项目", … },
  …（实施时按 brief 各节文案逐条登记；判卷钉"值非空、无占位、无禁词"）
} as const;
export type StrCatalog = typeof STR;
```

`strings.test.ts`：递归收集全部字符串值 → 断言 ① 全部非空且无 `TODO/待定`；② 无禁词表 `["RunRequest", "attachments", "IPC", "JSONL", "sidecar", "worktree", "canonical", "realpath", "绝对路径"]` 命中（**这就是自查清单第 2/3 条的机器判卷**）；③ 判卷同时扫描重做面组件源文（Sidebar/Composer/NewProjectDialog/AddProjectMenu/CommandPalette/Inspector/TimelinePane）——只允许从 `STR` 取用户可见文案：源文里裸中文仅允许出现在注释中（以 `//` 行剥离后再扫，字符串字面量（`"…"`/`'…'`/模板串）里出现 CJK 即红，白名单仅 `aria-label` 也不许——一律 STR）。

- [ ] **Step 5: 迁移侧栏判卷 import**——`sidebar-groups.test.ts` 改从 `../src/renderer/sessions-view` 导入（用例体一字不动）；Sidebar.tsx 暂时 re-export 保 App 引用（P1-4 移除）。
- [ ] **Step 6: 判卷绿 → 本任务收口**（不 commit）

### Task P1-2: 侧栏重写（结构 + 项目区 + 会话区）

**Files:**
- Modify: `apps/desktop/src/renderer/components/Sidebar.tsx`（整体重写）、`apps/desktop/src/renderer/styles.css`（节追加）
- Create: `apps/desktop/src/renderer/components/AddProjectMenu.tsx`
- Test: `apps/desktop/tests/sidebar-rework.test.tsx`（SSR）

**Interfaces:**
- Consumes: P1-1 纯函数 + STR；`listProjects`（新选项参）、`pickDirectory`、`gitClone`、`touchProject`、`addProject`、`removeProject`、既有 `renameSession/pin/archive/fork/delete` 回调面
- Produces: `Sidebar` 新 props（下表）+ `AddProjectMenu` 组件（P1-3 消费）

```ts
export function Sidebar(props: {
  projects: ProjectRecord[];                 // 活动项目（App 从 listProjects 拉）
  sessions: WorkspaceSession[];              // 带 workspace 归属
  activeId: string | null;
  activeWorkspace: string | null;
  running: ReadonlySet<string>;
  waitingIds: ReadonlySet<string>;           // asks sessionId 映射（App 维护）
  outcomes: ReadonlyMap<string, "ok" | "failed">; // 本进程观察到的轮末结果（App 记账）
  onOpen: (id: string) => void;
  onNewTask: () => void;                     // ＋新任务（⌘N）
  onOpenPalette: () => void;                 // 搜索钮 → ⌘K 面板（P3 前暂为占位回调）
  onPickDirectory: () => Promise<string | null>;
  onAddProject: (path: string) => Promise<void>;      // 打开文件夹/拖拽/最近打开共用
  onCloneProject: (url: string, parentDir: string) => Promise<{ ok: boolean; error?: string; path?: string }>;
  onOpenNewProjectDialog: () => void;        // 新建项目…（P1-3 的 Dialog）
  onOpenProjectSettings: (p: ProjectRecord) => void;
  onRemoveProject: (p: ProjectRecord) => Promise<void>;
  onRevealProject: (p: ProjectRecord) => Promise<void>;
  onRenameProject: (p: ProjectRecord, name: string) => Promise<void>;  // = addProject 同路径 upsert
  onSwitchWorkspace: (p: ProjectRecord) => void;
  onRenameSession?: (id: string, name: string) => Promise<void>;
  onPinSession?: (id: string, pinned: boolean) => Promise<void>;
  onArchiveSession?: (s: WorkspaceSession, archived: boolean) => void;
  onDeleteSession?: (s: WorkspaceSession) => void;
  onForkSession?: (s: WorkspaceSession) => void;
  onOpenSettings: () => void;
  onOpenAbout?: () => void;
  providerOk: boolean;                       // footer 状态点（绿=可用）——App 从 providerInfo/providerKeyStatus 判
  notice?: string | null;
}): React.JSX.Element;
```

- [ ] **Step 1: SSR 判卷先红**（`sidebar-rework.test.tsx`）——钉用户可见事实：
  - 顶部：`＋ 新任务` 主按钮（title 含 ⌘N）+ 搜索钮（title 含 ⌘K）；**无**「新建工作区/工作区路径」等行内表单入口；源文不含 `ws-add-row`、`/绝对/路径`。
  - 项目区：项目名 = `ProjectRecord.name`（不是路径）；`title` 属性 = 完整路径；折叠开关按钮；底部「添加项目」入口。
  - 「临时对话」组名在场；空列表文案在场；会话行 title 属性 = 完整标题；`<time>`/相对时间在场。
  - 每个 `<button` 有 `title=` 或 `aria-label=`（与 P1-6 的 tooltip-audit 同一断言，先行于此）。
- [ ] **Step 2: 实现重写**（结构见下，全部文案取 STR）：

```
<aside class="side">
  <div class="side-head">          // 48px
    <button class="btn-primary" title="新任务（⌘N）">＋ {STR.sidebar.newTask}</button>
    <button class="iconbtn" aria-label={STR.sidebar.searchHint} title="搜索（⌘K）"><Search/></button>
  </div>
  <nav class="sidenav">            // 项目区
    {projects.map(p => <ProjectGroup/>)}   // 折叠态存 local state；组头：chevron + 文件夹名 + 运行中圆点
    <AddProjectMenu …/>            // 列表底部
  </nav>
  <nav class="sidenav">            // 临时对话组（无项目归属的会话；哨兵 OTHER_WORKSPACE）
  </nav>
  <div class="side-foot">          // 48px
    <button>⚙ 设置</button> <button class="avatar"/> <span class="provider-dot" data-ok={providerOk}/>
  </div>
</aside>
```

会话行（组内）：`状态图标（P1-6）· 标题（省略号，hover title 全称）· 相对时间`；双击标题进重命名 inline input（Enter 提交/Esc 取消/失焦提交——沿用现行 renaming 状态机）。行右键菜单 = Radix ContextMenu？**不新增依赖**——用现有 DropdownMenu 的 Trigger 包一层 `onContextMenu`（Radix DropdownMenu 支持受控 open；实现时若键盘语义不达，回退"行尾 ⋯ hover 钮"并在此汇报）。菜单五项：置顶/重命名/分叉/归档/删除（判据沿用第十四遍：五项顺序不变）。
- [ ] **Step 3: 样式节追加**（styles.css「P1 侧栏」节）：240–280px 弹性、组头 26px、行 26px、hover 出 ⋯、`prefers-reduced-motion` 守卫。
- [ ] **Step 4: 判卷绿 → 收口**

### Task P1-3: 添加项目四入口 + 项目菜单 + 新建 Dialog

**Files:**
- Create: `apps/desktop/src/renderer/components/NewProjectDialog.tsx`
- Test: `apps/desktop/tests/new-project-dialog.test.tsx`

**Interfaces:**
- Consumes: `projectTemplates`/`projectCreateFromTemplate`（既有）、`pickDirectory`、`gitClone`、`listProjects({includeRemoved:true, recentFirst:true})`、STR
- Produces: `AddProjectMenu`（四入口下拉）与 `NewProjectDialog`（模板→名字→位置三步）

- [ ] **Step 1: SSR 判卷先红**——钉：① 四入口文案在场（打开文件夹…/新建项目…/从 Git 仓库克隆…/最近打开）；② 克隆表单只有 URL 输入框 + 「选择位置」按钮 + 预览"将克隆到：<位置>/<仓库名>"（**无路径手输框**）；③ Dialog：模板卡数为现有 4（名称以 `templateCatalog()` 为准）、名字输入实时错误行、位置行默认文案含 `~/Cairn Projects`（home 短写，非绝对路径串）、"将创建在：…"预览；④ 全部按钮有 tooltip。
- [ ] **Step 2: 实现 AddProjectMenu**——DropdownMenu；「打开文件夹…」→ `onPickDirectory()` → `onAddProject(path)`；「新建项目…」→ `onOpenNewProjectDialog()`；「从 Git 仓库克隆…」→ 菜单内展开内联表单（URL + 「选择位置…」按钮（pickDirectory）→ 保存后调 `onCloneProject(url, parentDir)`，成功 toast "已克隆并添加"（sonner）；失败行内 fail-visible 显示 ok:false 的 error）；「最近打开」子菜单 → `listProjects({includeRemoved:true, recentFirst:true})` 取前 8 → 点击 = `onAddProject(r.path)`（已在场的条目点击 = 切过去，disabled 灰显并在旁标"已添加"）。
- [ ] **Step 3: 实现 NewProjectDialog**（居中 Dialog，非侧栏行内表单）——三步同屏：模板卡网格（`templateCatalog()` 四张，lucide 图标 + description 一句）→ 项目名（实时校验：空/`/`/`\`/控制字符 → 行内错误；查重：`projects.some(p=>p.name===name)` → "已有同名项目"）→ 位置（默认 `~/Cairn Projects` 文案 + 「更改…」pickDirectory；显示"将创建在：<parent>/<name>"——parent 为 home 时以 `~/Cairn Projects` 短写展示）。创建 → `projectCreateFromTemplate({name, templateId, parentDir?})` → 成功：关窗 + `onAddProject` 语义的刷新（App 重拉 listProjects）+ toast"已创建 <name>"；失败：Dialog 内错误行（含失败分类 message，原文上屏——main 已给人话文案）。
- [ ] **Step 4: 判卷绿 → 收口**

### Task P1-4: 拖拽添加项目 + Toast + App 接线

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`（窗口级 drop + projects 状态 + callbacks）、`apps/desktop/src/renderer/main.tsx`（sonner `<Toaster/>` 挂载点）
- Test: 并入 `sidebar-rework.test.tsx`（源文哨兵：App.tsx 含 window drop 处理与 `webkitGetAsEntry` 分流）

**Interfaces:**
- Consumes: `pathForFile`（webUtils）、`addProject`、sonner `toast`
- Produces: App 级 `onDropFolder(path): Promise<void>`（给侧栏与空屏复用）

- [ ] **Step 1: 源文哨兵先红**——App.tsx 断言含：`webkitGetAsEntry`（目录判定）、`pathForFile`（取路径）、`toast.success`（"已添加 %s"）、以及 **drop 分流纯函数**单一出口。
- [ ] **Step 2: 实现**——拖拽分流纯函数放 `sessions-view.ts` 旁（新建 `drag-drop.ts`）：`classifyDrop(files: {path: string; isDirectory: boolean}[], projectPaths: readonly string[]): { projects: string[]; inProject: string[]; outside: string[] }`（**TDD：先红**，用例覆盖：目录恒进 projects；项目内文件进 inProject；项目外文件进 outside；路径前缀判定按 `path === p || path.startsWith(p + "/")`）。App 的 window 级 `dragover/drop`：`webkitGetAsEntry().isDirectory` 判目录（拿不到 entry 时按扩展名？**不猜**——entry 不可用即归文件流）；目录 → `addProject({path})` → 成功 `toast.success(STR.toast.projectAdded(name))`，失败 `toast.error(err.message)`（失败面已有人话）；文件：drop 落点 in Composer 走既有附件流（P2-4 细化），落点在其他处 = 不处理（不劫持）。
- [ ] **Step 3: App 接线**——`projects` 状态（挂载 + add/remove/create/clone 后重拉 `listProjects()`）；`waitingIds` 由 asks 映射（既有 ask 状态里取 sessionId 集合）；`outcomes`：App 在 run 结束（agent 事件流 run 终态 / run promise 收束）时记 `{sessionId → "ok"|"failed"}`（failed = 错误事件或 run 异常；**只记本进程**）；打开/新建会话时 `touchProject(项目.id)`（有归属时，void 吞错——副作用失败不影响主路径但 console.warn 留痕）。
- [ ] **Step 4: 判卷绿 → 收口**

### Task P1-5: 侧栏 footer + provider 状态点 + 空文案 + 标题收口

**Files:**
- Modify: `apps/desktop/src/renderer/components/Sidebar.tsx`、`apps/desktop/src/main/kernel-host.ts`（title 宽度）、`apps/desktop/src/renderer/App.tsx`
- Test: `sidebar-rework.test.tsx` 追加 + 根仓 `tests/sessions.test.ts`（deriveSessionTitle 用例追加）

- [ ] **Step 1: 标题宽度 32→40（≈汉字 20 字）**——`kernel-host.ts autoTitleFirstMessage` 里 `deriveSessionTitle(message, 40)`；根仓判卷加用例：19 个汉字 → 38 宽不截断；21 个汉字 → 截断 + "…"。先红后绿。
- [ ] **Step 2: footer**——设置钮（齿轮 + 文字"设置"，title 含 ⌘,）+ 头像钮 + provider 状态点：`providerOk` = providerInfo 里至少一条模型所在 provider 有可用 key（`providerKeyStatus().stored` 含之或 envProviders 含之；实施时以两通道实况为准，拿不到 = 灰点 + tooltip "未检测"——不假绿）；点 = `onOpenSettings`；tooltip 写清判据。
- [ ] **Step 3: 空文案与自查**——「还没有任务，按 ⌘N 开始」在场；搜索无结果文案；筛选功能收进 ⌘K（本阶段暂保 `filterSessions` 纯函数在场未接线，P3-3 接）。
- [ ] **Step 4: tooltip-audit 落钉**——`tests/tooltip-audit.test.tsx`：SSR 渲染 Sidebar/Composer(最小 props)/NewProjectDialog/AddProjectMenu → 正则扫 `<button` 开头标签，凡无 `title=` 且无 `aria-label=` 即失败（收编为常驻判卷，防回归）。
- [ ] **Step 5: 阶段交付链**（P1 全链：判卷 + 双 tsc + 根判卷 + 隔离实例 CDP 截图亮暗双主题：侧栏/项目菜单/新建 Dialog/拖拽 toast + dist + §9 追记 + 净归零）→ **停下给业主**。

## P2 阶段（空屏 + Composer）

### Task P2-1: 空屏（居中输入 + 下沉 + 项目 chip + 动态建议）

**Files:**
- Create: `apps/desktop/src/renderer/quick-starts.ts`、`apps/desktop/src/renderer/components/QuickStarts.tsx`（小块，或并入 App 空屏段）
- Modify: `apps/desktop/src/renderer/App.tsx`（hero 区 1152–1167 重做）、`styles.css`
- Test: `apps/desktop/tests/quick-starts.test.ts` + SSR 哨兵

**Interfaces:**
- Consumes: `gitStatus`（新）、`workspaceListDir("")`（README/package.json 在场性）、`workspaceReadText("package.json")`（scripts 键；解析失败=无 scripts）、sessions 最近标题、STR
- Produces: `buildQuickStarts(input): string[]`（≤4 条，回退通用 3 条**无任何具体文件名**）

- [ ] **Step 1: 纯函数先红后绿**

```ts
export interface QuickStartInput {
  git: { ok: boolean; branch?: string | null; dirtyFiles?: number } | null;
  hasPackageJson: boolean;
  scripts: readonly string[];
  readmeExists: boolean;
  lastSessionTitle: string | null;
}
export const QUICK_START_FALLBACK: readonly string[] = [
  "解释这个项目的结构", "帮我把当前项目跑起来看看", "列一个今天可以推进的小计划",
];
export function buildQuickStarts(input: QuickStartInput): string[];
```
排序即本表：继续上次（有标题）→ 未提交改动计数（git ok 且 >0）→ 运行测试（有 test script）→ 解释结构（有 README）；不足 3 条时以 FALLBACK 补到 3 条去重；上限 4。判卷用例逐一钉 + "回退项不含 `/` 与文件扩展名" 断言。
- [ ] **Step 2: 空屏布局**——hero 改为：品牌字标（克制一行）→ 问候语（`STR.empty.greeting`，按时段：早上好/下午好/晚上好 + "今天想做点什么？"）→ 项目 chip 行 → **Composer 居中枢位**（`data-empty="true"` 时输入卡在视觉中心偏上：flex 居中 + `margin-bottom` 偏置，非钉底）→ 快速开始建议行 → 副标题仅首启（`getSettings().onboarded !== true` 时显示）。发送第一条（activeId 出现且事件 >0）→ 容器加 `data-sunken`：200ms transform/opacity 过渡下沉到底部；`@media (prefers-reduced-motion: reduce)` 直接落位无动画。
- [ ] **Step 3: 项目 chip 行**——`📁 <项目名> · <分支>`（分支来自 `gitStatus(activeWorkspace)`，失败只显项目名）；点击 Popover：搜索框 + 项目列表（含最近）+ 「添加项目…」（复用 AddProjectMenu）＋空态"选择项目"文案 + "也可以直接拖入文件夹"提示。无项目时 chip 显 `STR.empty.pickProject`。
- [ ] **Step 4: 建议行**——数据装配在 App（切项目/挂载时拉一次，缓存 key=项目路径）；点击 = `injectedText` 注入 Composer（**填入不发送**，C-24 既有语义）。
- [ ] **Step 5: 换文案**——删 "⌘N 任何时候回到这个页面"；placeholder = `描述任务，/ 调用技能，@ 引用文件`（Composer 改，P2-2 同批）。
- [ ] **Step 6: 判卷绿 → 收口**（阶段链留到 P2 末）

### Task P2-2: Composer 控件行（＋菜单 / 权限 chip / 模型+思考弹窗）

**Files:**
- Modify: `apps/desktop/src/renderer/components/Composer.tsx`、`PermissionMenu.tsx`、`ModelPicker.tsx`、`styles.css`
- Test: `apps/desktop/tests/composer-rework.test.tsx`

- [ ] **Step 1: SSR 判卷先红**——钉：① ＋ 菜单四项文案（上传文件…/添加文件夹…/粘贴截图（⌘V）/引用最近文件）；② **源文不再含** `pathDraft`、"手输路径"入口、`/绝对/路径` 占位；③ 权限 chip 渲染档位名 + 色点 `data-mode`；弹层内 4 档每档一句说明；④ 模型 chip 文案形态 `模型名 · 思考 X`；弹层含搜索框 + 思考强度 segmented（关/低/中/强 + 每档一句说明 + 能力禁用）；⑤ 发送钮 title 含 ⏎、停止钮 title 含 ⌘.。
- [ ] **Step 2: ＋ 菜单四项**——「上传文件…」= `pickFiles()`（多选）→ 逐条附件 chip；「添加文件夹…」= `pickDirectory()` → kind:"directory" 附件；「粘贴截图（⌘V）」= 读系统剪贴板（`navigator.clipboard.read()` 的 image → blob → `saveTempFile`）失败 = toast "剪贴板里没有可粘贴的内容"；「引用最近文件 ▸」= 本会话已引用文件历史（App 维护 `recentRefs`，内存级）子菜单，空 = 该项 disabled + tooltip "本会话还没有引用过文件"。**全菜单零路径输入**。
- [ ] **Step 3: 权限 chip 色点**——`MODE_LABEL` 旁加 `MODE_DOT: Record<PermissionMode, string>`（只读=灰绿 `#6b8f7a` 类 token、默认=蓝灰、引导=黄、自动=红——落 tokens.css 新增 4 个语义变量，双主题各给值）；弹层每档 `MODE_DESC` 一句人话。
- [ ] **Step 4: 模型+思考合并弹窗**——ModelPicker 弹层重构：搜索框 + 模型行（名称 + 上下文长度 `128k` + 思考/图片能力图标）+ 选中态；下半区思考强度 segmented（四键 + 每档一句说明；`capability.thinking.supported !== true` 时整区禁用且注 "当前模型不支持思考强度"）。chip 文案维持 `名 · 思考 X`。**保持**「—」用量环（ring + tooltip 分口径）与「Tab」角标（tooltip "想下一条：按 Tab 让 Cairn 提一个下一步建议"）——两者职能已核实（摸底结论 5）。
- [ ] **Step 5: 发送/停止快捷键**——发送钮 title "发送（⏎）"；停止钮 title "停止（⌘.）"；⌘. 绑定在 P3-3 统一表落，本任务先在 Composer keydown 通道挂通（`onCancel`）。
- [ ] **Step 6: 判卷绿 → 收口**

### Task P2-3: 附件 chips 升级 + ⌘V 粘贴

**Files:**
- Modify: `Composer.tsx`、`App.tsx`（send 前过滤已删）、`styles.css`
- Test: `composer-rework.test.tsx` 追加 + `composer-attach.test.tsx` 同步

- [ ] **Step 1: chip 形态**——`图标（文件/文件夹/图片）+ 文件名 + 大小（拿不到不显）+ 项目外时小盾牌图标（tooltip："这个文件在项目外，发送前需要你批准一次")`；点击 = `workspacePathAction(rel,"open")`（项目内）/ 项目外 = `revealInFinder`（打开可能危险，只显示位置）；删除钮保留。**路径只进 tooltip**（title=完整路径）。
- [ ] **Step 2: ⌘V 粘贴**——composer textarea `onPaste`：`clipboardData.files` 非空时 `preventDefault()`（不把二进制塞进文本区）：每文件 `pathForFile(f)` 有值（Finder 复制）→ 直接附件（内外项目分流按 P2-4）；空值（截图 blob）→ `f.arrayBuffer()` → `saveTempFile({name: f.name || "paste.png", bytes})` → 返回路径 → 附件。失败 fail-visible 提示行。文本粘贴不劫持（无 files 直接 return）。
- [ ] **Step 3: 大小显示**——文件大小：Finder 复制文件拿不到 size（File.size 有！blob 路径 File.size 也在）→ chip 存 size 字段（渲染层 state 扩展 `size?: number`，发送前剥离——RunAttachmentReference 形状不动）。
- [ ] **Step 4: 判卷绿 → 收口**

### Task P2-4: @ 模糊搜索 + 拖拽分流

**Files:**
- Modify: `apps/desktop/src/renderer/mention.ts`（改薄：删除逐层列举，走新通道）、`Composer.tsx`、`App.tsx`（drop 落点分流）
- Test: `mention.test.ts` 重写 + `composer-rework.test.tsx` 追加

- [ ] **Step 1: mention.ts 纯函数先红后绿**——`parseMentionQuery`（保留）+ 新 `replaceMentionToken(text, start, caret, replacement)`（即既有 applyMention，改名保语义）。删 `mentionTarget`/`mentionCompletion` 的目录下钻语义（工作区根查询一次）。
- [ ] **Step 2: Composer 接线**——`@` 触发 → debounce 120ms → `workspaceSearch(activeWorkspace, query)` → 扁平列表（相对路径带 breadcrumb 灰字 + 文件/目录图标；↑↓/⏎/Tab/Esc 语义保留）；选中文件 = `replaceMentionToken(text, …, "")` 清 token + 附件 chip（`explicit:true`）+ 记入 recentRefs；选中目录 = 以该目录为范围再搜（query 变 `目录/`）。搜索失败 = 菜单内提示行（fail-visible）。
- [ ] **Step 3: 拖拽分流**——复用 P1-4 `classifyDrop`：项目内文件 → 附件（chip 无盾牌——项目内，发送免批）；项目外文件 → 附件 + 盾牌；目录 → 若在项目内 = 目录附件、项目外 = 提示"拖入文件夹可添加为项目"（不自动加，避免误触）。同一路径去重（既有）。
- [ ] **Step 4: 判卷绿 → P2 阶段链**（判卷 + 双 tsc + 根判卷 + CDP 截图亮暗：空屏/下沉动画帧/＋菜单/权限弹窗/模型弹窗/粘贴/拖拽/@搜索 + dist + §9 追记 + 净归零）→ **停下给业主**。

### Task P2-5: 空屏建议数据装配收口（App 侧）

**Files:**
- Modify: `App.tsx`
- Test: SSR 哨兵（建议行在场、点击注入不发送）

- [ ] **Step 1:** 切项目/挂载时装配 `QuickStartInput`（并发三查：gitStatus/listDir/readText package.json + 会话表最近标题），失败项按 null 处理（建议自动少几条→回退补齐）；结果缓存 Map（项目路径 → 建议）。
- [ ] **Step 2:** 建议行渲染 + 点击注入（既有 injectedText 机制，seq 递增）；空项目（无任何数据）时显示 3 条通用建议。
- [ ] **Step 3:** 判卷绿（并入 P2 阶段链）。

## P3 阶段（对话区 + 检查器 + ⌘K）

### Task P3-1: 对话区收口

**Files:**
- Modify: `apps/desktop/src/renderer/components/Stream.tsx`、`styles.css`、`App.tsx`（hover 操作接线）
- Test: `apps/desktop/tests/stream-rework.test.tsx`（SSR）

- [ ] **Step 1: 判卷先红**——钉：① 阅读列 `--reading-col: 760px`（源文/SSR class 断言）；② user 消息右对齐气泡 / agent 无气泡左对齐（class 断言，第十五遍语义保持）；③ 工具卡折叠行含：图标 + 摘要 + 耗时（有 then 显示）+ 状态符；④ 生成中顶栏细进度条元素（`.gen-bar[data-running]`）；⑤ hover 操作含 复制 / 分叉 / 回放（分叉与回放 tooltip 说明"从该轮起新建会话，原会话不动"）；⑥ 回底钮在场逻辑（既有）+ 滚动记忆 key = sessionId。
- [ ] **Step 2: 工具卡**——现状（阶段 2/3 的胶囊 + 单卡折叠）收口：展开区含命令/参数/输出，写文件类调 `changeDiff` 渲染行内 diff（既有 DiffView 复用）；耗时 = 事件时间戳差（拿不到不显）。
- [ ] **Step 3: 审批卡键盘**——ApprovalCard 挂 keydown：⏎ = 允许一次（焦点在卡内时），Esc = 拒绝；按钮文案三枚（允许一次/本会话允许/拒绝）不新增。**先确认现行按钮集合一致**再落键盘。
- [ ] **Step 4: hover 操作**——user 消息：复制 + 从此处分叉；agent 消息：复制 + 回放（= `forkSession(round)` + 切到新会话 + 把该轮用户输入注入新会话输入框，**不自动发送**——汇报注明取舍）。分叉/回放都要轮号：自 `events` 投影轮界（判卷纯函数 `roundOfEvent(events, eventId)` 先红后绿，放 `projections.ts`）。
- [ ] **Step 5: 滚动记忆**——Map(sessionId → scrollTop) 存 App 内存，切会话回来恢复（回底钮逻辑不动）。
- [ ] **Step 6: 判卷绿 → 收口**

### Task P3-2: 右侧检查器（三 Tab + 默认收起 + ⌘⌥B）

**Files:**
- Create: `apps/desktop/src/renderer/components/Inspector.tsx`、`TimelinePane.tsx`
- Modify: `App.tsx`（右 Panel 换 Inspector + 默认 collapsed + ⌘⌥B）、`styles.css`
- Test: `apps/desktop/tests/timeline-pane.test.tsx` + SSR（Inspector 三 Tab 在场、无数据 Tab 隐藏）

- [ ] **Step 1: 时间线投影纯函数先红后绿**——`timelineItems(events): { eventId, kind: "user"|"tool"|"assistant"|"usage", label, at? }[]`（放 `projections.ts`；只取在场字段，不编时间）。SSR/纯函数双钉。
- [ ] **Step 2: TimelinePane**——列表渲染 + 点击 = `onJump(eventId)` → Stream 对应消息 `scrollIntoView`（消息容器补 `data-event-id` 锚，Stream 同批加）。
- [ ] **Step 3: 改动 Tab**——复用 PaneDock 既有变更投影（`panes.ts changedFileCount` + `changeDiff`）；行：文件名 + `+n −m`（拿不到不显）；点击 = 打开 diff（既有 DiffView）；行尾「撤销此文件改动」——**有快照才显示**（`changeDiff` ok 时行可撤销），点击 → `snapshotRestore` → 成功 toast + 刷新；失败 fail-visible 原文上屏。
- [ ] **Step 4: 计划 Tab**——内核有该数据（plan/tasks pane 既有投影）⇒ 渲染 `projectPlans()` 只读列表；无数据 = 整 Tab 隐藏。
- [ ] **Step 5: Inspector 容器 + 默认收起**——三 Tab（无数据 Tab 隐藏）+ 「＋」菜单接入既有七种窗格（文件/终端/浏览器/旁聊等，保持既有组件与数据面）；右 Panel（react-resizable-panels）`collapsible` + `collapsedSize=0` + 初始 collapsed；⌘⌥B 开合（含 collapsed 时展开至 360px）。宽 320–420（defaultSize 360、min 320、max 420）。
- [ ] **Step 6: 判卷绿 → 收口**

### Task P3-3: ⌘K 命令面板 + 快捷键统一

**Files:**
- Create: `apps/desktop/src/renderer/components/CommandPalette.tsx`
- Modify: `shortcuts.ts`（SHORTCUTS 单一事实源表）、`App.tsx`（挂载 + 动作接线）、`settings-sections.tsx`（设置页"快捷键"表渲染自 SHORTCUTS）、`Sidebar.tsx`（tooltip 读表）
- Test: `apps/desktop/tests/command-palette.test.tsx` + `shortcuts.test.ts` 追加

- [ ] **Step 1: SHORTCUTS 表先红后绿**——`shortcuts.ts` 导出 `SHORTCUTS: readonly { id: string; keys: string; label: string }[]`（⌘N 新任务/⌘O 打开文件夹/⌘K 命令面板/⌘⌥B 检查器/⌘. 停止生成/⌘⇧[ ⌘⇧] 切换会话/⌘, 设置/⏎ 发送/⇧⏎ 换行）；判卷：表含全 9 项、keys 唯一；组件 tooltip 含对应 keys（SSR 抽查 3 处）。
- [ ] **Step 2: CommandPalette（cmdk）**——分组：会话（标题/相对时间）、项目（切/添加）、设置页、技能（数据源 = 内置命令 + 插件快照在场时并入；缺则仅内置——汇报注明）、操作（新任务/打开文件夹/添加项目/切换主题/切换权限档/开合检查器）。键盘优先（↑↓/⏎/Esc 默认）；打开 = ⌘K 或侧栏搜索钮。
- [ ] **Step 3: 绑定落地**——App keydown 统一分发：⌘O（pickDirectory→add）、⌘K、⌘⌥B、⌘.（cancel，无会话也安全 no-op）、⌘⇧[ ]（会话表上一条/下一条、跳过归档）、⌘N（既有）、⌘,（既有）；避免与既有 ⌘W/⌘;/Ctrl+Tab 冲突（`shortcuts.ts` 现状先读再合并）。
- [ ] **Step 4: 设置页快捷键表**——settings 一区（渲染 SHORTCUTS）；tooltip 与表同源（防漂移）。
- [ ] **Step 5: P3 全链**（判卷 + 双 tsc + 根判卷 + CDP 截图亮暗：对话区/检查器三 Tab/⌘K 面板/快捷键表 + dist + §9 追记 + 净归零）→ **停下给业主 + 自查清单逐条过一遍（无绝对路径输入/无禁词/tooltip-audit 绿/空列表文案在场）**。

## Self-Review 记录（写计划后对照 brief 自查）

- **Spec coverage**：brief 一至九节逐节映射——一（P1-2/P1-5 侧栏宽度 + P3-2 检查器 + 布局三栏）；二（P1-2/P1-3/P1-5）；三（P2-1）；四（P1-3）；五（P2-2/P2-3/P2-4）；六（P3-1）；七（P3-2）；八（P3-3）；九（P3-3 + tooltip 同源）。约束与验收逐条进 Global Constraints。**「最近失败的测试」建议项无数据源 → 明确不做（不造假）**；「技能列表」数据源待实施时核实，缺则仅内置命令并汇报。
- **Placeholder scan**：无 TBD/TODO；唯一"实施时以实况为准"处（providerOk 判据、ApprovalCard 按钮集合、mention 现文件名、change-diff 快照布局）均给了先读步骤 + 明确判据方向 + fail-visible 兜底，不是留白。
- **Type consistency**：`WorkspaceSession`/`Group` 迁 sessions-view 后 re-export 名不变；`STR` 键名在 P1-2…P3-3 间引用一致；新通道名七条在 ipc-protocol/channels/wired/钉四处同名单一来源；`classifyDrop`/`buildQuickStarts`/`sessionStatus`/`timeBucket`/`fuzzyMatch`/`roundOfEvent`/`timelineItems` 命名跨任务一致。
- **版本账目**：76 + 7 = 83；v10 → v11；四处钉一次改全（P1-0 Step 6）。
