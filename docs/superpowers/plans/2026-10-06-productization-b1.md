# Cairn v1 产品化（B1 内测先行）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「克隆 → 十分钟可用」做成产品路径：ADR 0002 落账、`--doctor`/`--version`、install.sh、身份面、README 增量。

**Architecture:** doctor 走「纯函数核 + 薄 IO 壳」——判据全部可注入、判卷不碰真 env；CLI 只做旗标分派与渲染。版本号与 engines 同读 `package.json`（单一事实源）。安装脚本是判据的 shell 壳（安装期 tsx 未装，不能 import）。

**Tech Stack:** TypeScript（tsx 通道，无构建）、vitest、bash。

**Spec:** `docs/superpowers/specs/2026-10-06-productization-b1-design.md`（本计划逐条落实其 §1 表格与 §2 检查项；冲突处以 spec 为准）

## Global Constraints

- Node engines 区间：`">=20.11.0 <25"`（`package.json` 为唯一事实源；README 的「20.3+」以它为准改写）。
- **不发布 npm、不碰桌面端（apps/）、不新增 GATES 条目**、不引 semver 依赖（比较器手写）。
- **env 值永不进 doctor 报告**（只报在位与否；判卷钉脱敏）。
- 交笔自检：`node --import tsx scripts/typecheck.ts` ＋ 全量判卷（`node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts`）＋ `pnpm docs-check`。
- 本计划只动 spec §1 列出的文件＋本计划自身；**别人的在飞改动不背锅、也不替别人修**（spec §3 原文）。
- **仓规偏差（业主记账纪律，优先于本技能模板；2026-10-06 验收笔修订，见文末「执行记录」）**：
  `tag v0.1.0` 由业主亲手打（spec §1#6「全部门绿之后才打 tag」）；commit 步骤由验收笔代行
  （业主明示「开工」，spec §6 的 journal 成笔节奏），tag 不代打。
- 判卷前置事实（2026-10-06 实测）：树上有他人会话在飞的 4 条既有红（归因见 `/tmp/dsh-suite.log`），typecheck 绿。新判卷必须自身绿，全量判卷红时先分面定位是否本笔所致。

---

### Task 1: ADR 0002 ＋ B2 留门清单（裁决落账先行）

**Files:**
- Create: `docs/adr/0002-v1-audience-b1-internal-beta.md`
- Create: `docs/b2-checklist.md`

**Interfaces:**
- Consumes: ADR 0001 的「裁决记录」段与其推翻条件 #2（npm 源码包＋tsx 进 dependencies）。
- Produces: 后续所有任务的受众依据（B1、交付面=CLI）；`docs/b2-checklist.md` 被 LICENSE 尾行与 README 增量引用。

- [x] **Step 1: 写 ADR 0002**（对齐 ADR 0001 的字段风格：状态/日期/决策者/依据材料/背景/裁决记录/推翻条件）

```markdown
# ADR 0002：v1 受众与交付面

- 状态：**已接受（范围裁决）**——2026-10-06 业主拍板，见文末「裁决记录」
- 日期：2026-10-06
- 决策者：仓库所有者
- 依据材料：docs/adr/0001-core-only-vs-desktop.md（其 D2 被明确留成未决）、
  docs/superpowers/specs/2026-10-06-productization-b1-design.md

## 裁决记录

1. **D2（v1 受众）落案 B1**：自用/内测开发者先行；B2（更广受众）留门，触发条件见
   `docs/b2-checklist.md` 文件头。
2. **交付面只做 CLI**（遵循 ADR 0001 的 D1 裁决）：桌面端不在 v1 交付面，不碰 `apps/`。

## 推翻条件

- 出现**第一个真实外部用户** ⇒ 重开 D2（B2 门启动：先过 `docs/b2-checklist.md` 的清单再谈扩受众）。

## 后果

- 产品化施工面收窄为：安装路径、`--doctor`、`--version`、身份面、README 增量（spec §1）。
- npm 发布、桌面端、文档双语、Windows 安装路径、官网、遥测全部出 v1 范围（进 B2 门或永不）。
```

- [x] **Step 2: 写 `docs/b2-checklist.md`**（文件头写触发条件；每项带验收判据）

```markdown
# B2 留门清单（触发条件在头，别提前动工）

> **触发条件：出现第一个真实外部用户。** 未触发前本清单只记账、不施工。

| # | 事项 | 验收判据 |
|---|---|---|
| 1 | npm 源码包（ADR 0001 推翻条件 #2 的对应方案） | `private:true` 摘除＋`files` 白名单实测 `npm pack` 体积合规；`tsx` 从 devDependencies 挪进 dependencies；干净环境克隆装完可跑 |
| 2 | LICENSE 选型重开 | 专有内测授权换成明确 OSS/商业条款；法务口径过一遍 |
| 3 | 桌面交付面 | 重开 ADR 0001 D1；桌面层过自己的门禁（root gates 现不扫 apps/） |
| 4 | 文档双语 | README 英文面与中文面同源对账（docs-check 扩展） |
| 5 | Windows 安装路径 | install.sh 的 PowerShell 对应物＋CI 矩阵实证 |
| 6 | 官网/遥测 | 立项另议；遥测必须先过脱敏判卷 |
```

- [x] **Step 3: 自查**：ADR 0002 与 ADR 0001 的裁决记录无矛盾（0001 D1=桌面不进 v1，本 ADR 引用它而非推翻它）；b2-checklist 第 1 项确实回应 ADR 0001 推翻条件 #2。

---

### Task 2: doctor 纯函数核＋判卷（判卷先行）

**Files:**
- Create: `src/main/doctor.ts`
- Test: `tests/doctor.test.ts`

**Interfaces:**
- Consumes: `PROVIDER_ENV_KEYS`/`ENV_KEYED_PROVIDERS`（`src/providers/env-keys.ts`）、`DEFAULT_MODEL_TABLE`/`specsByTier`（`src/providers/registry.ts`）、`SandboxStatus`（`src/main/sandbox.ts`，`{ available: boolean; reason?: string }`）、`loadSearchConfig`（`src/tools/web-search.ts:43`，返回 `SearchConfig | null`，JSON 坏时**抛**）。
- Produces: `nodeVersionOk`、`parseEngines`、`collectDoctorChecks`、`verdictOf`、`renderDoctor`、`runDoctor`（Task 3 接线用）。

- [x] **Step 1: 先写判卷 `tests/doctor.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import {
  collectDoctorChecks, nodeVersionOk, parseEngines, renderDoctor, verdictOf,
  type DoctorFacts,
} from "../src/main/doctor";
import { DEFAULT_MODEL_TABLE, specsByTier } from "../src/providers/registry";

const RANGE = parseEngines(">=20.11.0 <25")!;

describe("nodeVersionOk（手写比较器，不引 semver）", () => {
  it("区间边界：20.10.9 拒 / 20.11.0 收 / 24.9.9 收 / 25.0.0 拒", () => {
    expect(nodeVersionOk("20.10.9", RANGE)).toBe(false);
    expect(nodeVersionOk("20.11.0", RANGE)).toBe(true);
    expect(nodeVersionOk("24.9.9", RANGE)).toBe(true);
    expect(nodeVersionOk("25.0.0", RANGE)).toBe(false);
  });
  it("v 前缀收；预发布与脏串一律拒（宁可误报也不放行不认识的串）", () => {
    expect(nodeVersionOk("v22.23.2", RANGE)).toBe(true);
    expect(nodeVersionOk("25.0.0-pre.1", RANGE)).toBe(false);
    expect(nodeVersionOk("abc", RANGE)).toBe(false);
    expect(nodeVersionOk("", RANGE)).toBe(false);
  });
  it("engines 读不出来 ⇒ parseEngines 返回 null（fail-closed，不猜区间）", () => {
    expect(parseEngines(">=20")).toBeNull();
    expect(parseEngines("随便")).toBeNull();
  });
});

function facts(over: Partial<DoctorFacts> = {}): DoctorFacts {
  return {
    nodeVersion: process.version,
    engines: ">=20.11.0 <25",
    keyPresence: { CAIRN_API_KEY: true, OPENAI_API_KEY: false, ANTHROPIC_API_KEY: false, GEMINI_API_KEY: false },
    sandbox: { available: true },
    workspaceWritable: true,
    search: { kind: "unset" },
    // 从被度量方自己的表现读，不让判卷抄第二份档位表
    tierCounts: {
      total: DEFAULT_MODEL_TABLE.length,
      cheap: specsByTier(DEFAULT_MODEL_TABLE, "cheap").length,
      standard: specsByTier(DEFAULT_MODEL_TABLE, "standard").length,
      strong: specsByTier(DEFAULT_MODEL_TABLE, "strong").length,
    },
    ...over,
  };
}

describe("collectDoctorChecks（六项固定清单，spec §2）", () => {
  it("脱敏：key 的值进不了任何 detail / hint", () => {
    const checks = collectDoctorChecks(facts({ keyPresence: { CAIRN_API_KEY: false, OPENAI_API_KEY: true, ANTHROPIC_API_KEY: false, GEMINI_API_KEY: false } }));
    const text = renderDoctor({ checks, ...verdictOf(checks) });
    // 值只存在于调用方 env；事实结构里根本没有值字段——这里钉「渲染面没有 sk- 形态的串」
    expect(text).not.toMatch(/sk-[A-Za-z0-9]/);
  });
  it("keys：全缺 ⇒ ✗＋指路 --provider demo（只报不红，非致命）", () => {
    const c = collectDoctorChecks(facts({ keyPresence: { CAIRN_API_KEY: false, OPENAI_API_KEY: false, ANTHROPIC_API_KEY: false, GEMINI_API_KEY: false } }));
    const keys = c.find((x) => x.id === "keys")!;
    expect(keys.ok).toBe(false);
    expect(keys.fatal).toBe(false);
    expect(keys.hint).toContain("--provider demo");
  });
  it("keys：部分在位 ⇒ detail 点名缺省将拨谁（按 ENV_KEYED_PROVIDERS 表序第一个在位的）", () => {
    const c = collectDoctorChecks(facts());
    const keys = c.find((x) => x.id === "keys")!;
    expect(keys.ok).toBe(true);
    expect(keys.detail).toContain("CAIRN_API_KEY");
  });
  it("node：版本不满足 ⇒ fatal（唯一 exit 1 项）；engines 解析失败 ⇒ 同样 fatal", () => {
    const bad = collectDoctorChecks(facts({ nodeVersion: "18.0.0" }));
    expect(bad.find((x) => x.id === "node")!.fatal).toBe(true);
    const unreadable = collectDoctorChecks(facts({ engines: "随便" }));
    expect(unreadable.find((x) => x.id === "node")!.fatal).toBe(true);
  });
  it("sandbox 不可用 ⇒ ✗ 但非致命，detail 带原因，不假装可用", () => {
    const c = collectDoctorChecks(facts({ sandbox: { available: false, reason: "no sandbox-helper" } }));
    const s = c.find((x) => x.id === "sandbox")!;
    expect(s.ok).toBe(false);
    expect(s.fatal).toBe(false);
    expect(s.detail).toContain("no sandbox-helper");
  });
  it("search 三态分开：未配＝ok（web_search 本来就可选）；JSON 坏＝✗ 非致命；已配＝ok", () => {
    const unset = collectDoctorChecks(facts()).find((x) => x.id === "search")!;
    expect(unset.ok).toBe(true);
    const broken = collectDoctorChecks(facts({ search: { kind: "broken", message: "Unexpected token" } })).find((x) => x.id === "search")!;
    expect(broken.ok).toBe(false);
    expect(broken.fatal).toBe(false);
    expect(collectDoctorChecks(facts({ search: { kind: "ok" } })).find((x) => x.id === "search")!.ok).toBe(true);
  });
});

describe("verdictOf（末行总档：就绪/部分就绪/未就绪；只有 fatal 才 exit 1）", () => {
  it("全绿 ⇒ 就绪/0；非致命红 ⇒ 部分就绪/0；fatal ⇒ 未就绪/1", () => {
    const all = collectDoctorChecks(facts());
    expect(verdictOf(all)).toEqual({ verdict: "就绪", exitCode: 0 });
    const partial = collectDoctorChecks(facts({ workspaceWritable: false }));
    expect(verdictOf(partial)).toEqual({ verdict: "部分就绪", exitCode: 0 });
    const fatal = collectDoctorChecks(facts({ nodeVersion: "18.0.0" }));
    expect(verdictOf(fatal)).toEqual({ verdict: "未就绪", exitCode: 1 });
  });
  it("renderDoctor：逐项 ✓/✗＋末行总档", () => {
    const checks = collectDoctorChecks(facts());
    const text = renderDoctor({ checks, ...verdictOf(checks) });
    expect(text).toContain("✓ node");
    expect(text.trim().endsWith("总档：就绪")).toBe(true);
  });
});
```

- [x] **Step 2: 跑判卷确认红**：`node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/doctor.test.ts` ⇒ FAIL（模块不存在）。
- [x] **Step 3: 写 `src/main/doctor.ts`**

```typescript
// cairn --doctor 的核（spec：docs/superpowers/specs/2026-10-06-productization-b1-design.md §2）。
// 纯函数核不做 I/O：node 版本、key 在位、沙箱、可写性、search 配置全由 runDoctor 收齐后注入，
// 判卷只喂数据。**脱敏是结构性的**：DoctorFacts 里只有「在位与否」，没有值的字段——想泄都泄不出去。
import { ENV_KEYED_PROVIDERS, PROVIDER_ENV_KEYS } from "../providers/env-keys";
import { DEFAULT_MODEL_TABLE, specsByTier } from "../providers/registry";
import type { SandboxStatus } from "./sandbox";

export interface DoctorCheck {
  id: "node" | "keys" | "tiers" | "sandbox" | "workspace" | "search";
  ok: boolean;
  detail: string;
  /** 只有 node 版本这一项可能是 true（spec：环境级阻断 exit 1）；其余项只报不红。 */
  fatal: boolean;
  hint?: string;
}
export interface DoctorReport { checks: DoctorCheck[]; verdict: "就绪" | "部分就绪" | "未就绪"; exitCode: 0 | 1; }
export type SearchReadout = { kind: "unset" } | { kind: "ok" } | { kind: "broken"; message: string };

export interface DoctorFacts {
  nodeVersion: string;
  engines: string;
  keyPresence: Record<string, boolean>; // 键 = PROVIDER_ENV_KEYS 的值（env 变量名），值 = 在位与否
  sandbox: SandboxStatus;
  workspaceWritable: boolean;
  search: SearchReadout;
  tierCounts: { total: number; cheap: number; standard: number; strong: number };
}

/** 手写比较器（spec：不引 semver）。只认 `">=X.Y.Z <N"` 这一形态——这是本仓 engines 现在的写法；
 *  认不出 ⇒ null，调用方按「读不出来」处理（fail-closed），不猜区间。 */
export function parseEngines(engines: string): { min: [number, number, number]; maxExclusiveMajor: number } | null {
  const m = /^>=v?(\d+)\.(\d+)\.(\d+)\s*<(\d+)\s*$/.exec(engines.trim());
  if (!m) return null;
  return { min: [Number(m[1]), Number(m[2]), Number(m[3])], maxExclusiveMajor: Number(m[4]) };
}

function cmpTriple(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; }
  return 0;
}

/** 预发布与脏串一律 false——宁可把 dev 版误报成不满足，也不放行不认识的串。 */
export function nodeVersionOk(nodeVersion: string, range: ReturnType<typeof parseEngines>): boolean {
  if (!range) return false;
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion.trim());
  if (!m) return false;
  const t: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return cmpTriple(t, range.min) >= 0 && t[0] < range.maxExclusiveMajor;
}

export function collectDoctorChecks(f: DoctorFacts): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const range = parseEngines(f.engines);
  const nodeOk = nodeVersionOk(f.nodeVersion, range);
  checks.push({
    id: "node", ok: nodeOk, fatal: true,
    detail: nodeOk
      ? "Node " + f.nodeVersion + "（engines " + f.engines + "）"
      : range
        ? "Node " + f.nodeVersion + " 不在 engines 区间（" + f.engines + "）"
        : "engines.node 读不出来（" + f.engines + "），无法判版本",
    hint: nodeOk ? undefined : "按 package.json 的 engines 装 Node",
  });
  const present = ENV_KEYED_PROVIDERS.filter((p) => f.keyPresence[PROVIDER_ENV_KEYS[p]]);
  const missing = ENV_KEYED_PROVIDERS.filter((p) => !f.keyPresence[PROVIDER_ENV_KEYS[p]]);
  checks.push({
    id: "keys", ok: present.length > 0, fatal: false,
    detail: present.length > 0
      ? "缺省将拨 " + present[0] + "（" + PROVIDER_ENV_KEYS[present[0]] + " 在位）；未设：" + (missing.map((p) => PROVIDER_ENV_KEYS[p]).join(" ") || "无")
      : "四个 provider key 全部未设",
    hint: present.length > 0 ? undefined : "export OPENAI_API_KEY=<key>；或 --provider demo 零凭据看流程（预录剧本，不拨号）",
  });
  checks.push({
    id: "tiers", ok: true, fatal: false,
    detail: "模型档位表 " + f.tierCounts.total + " 条（cheap " + f.tierCounts.cheap + " / standard " + f.tierCounts.standard + " / strong " + f.tierCounts.strong + "）",
  });
  checks.push({
    id: "sandbox", ok: f.sandbox.available, fatal: false,
    detail: f.sandbox.available ? "沙箱可用" : "沙箱不可用（" + (f.sandbox.reason ?? "原因未给") + "）",
    hint: f.sandbox.available ? undefined : "跑 pnpm sandbox:check 看原因；run_shell 将明说自己没走沙箱",
  });
  checks.push({
    id: "workspace", ok: f.workspaceWritable, fatal: false,
    detail: f.workspaceWritable ? "工作区可写" : "工作区不可写（W_OK 不过）",
    hint: f.workspaceWritable ? undefined : "检查 --workspace 指向与磁盘权限",
  });
  checks.push({
    id: "search", ok: f.search.kind !== "broken", fatal: false,
    detail: f.search.kind === "ok" ? "search.endpoint 已配（web_search 可用）"
      : f.search.kind === "unset" ? "search.endpoint 未配（web_search 不可用；这是可选项）"
        : ".agent/config.json 存在但解析失败：" + f.search.message,
    hint: f.search.kind === "broken" ? "修好或删掉 .agent/config.json" : undefined,
  });
  return checks;
}

export function verdictOf(checks: DoctorCheck[]): { verdict: DoctorReport["verdict"]; exitCode: 0 | 1 } {
  if (checks.some((c) => c.fatal && !c.ok)) return { verdict: "未就绪", exitCode: 1 };
  if (checks.some((c) => !c.ok)) return { verdict: "部分就绪", exitCode: 0 };
  return { verdict: "就绪", exitCode: 0 };
}

export function renderDoctor(r: DoctorReport): string {
  const lines = r.checks.map((c) => (c.ok ? "✓" : "✗") + " " + c.id + "：" + c.detail + (c.hint ? "（" + c.hint + "）" : ""));
  lines.push("总档：" + r.verdict);
  return lines.join("\n") + "\n";
}

/** IO 壳：收齐六项事实再进纯核。inject 只为判卷开（生产零参调用）。 */
export async function runDoctor(workspace: string, inject: Partial<DoctorFacts> = {}): Promise<DoctorReport> {
  const { checkSandbox } = await import("./sandbox");
  const { loadSearchConfig } = await import("../tools/web-search");
  const { access, readFile } = await import("node:fs/promises");
  const { W_OK } = await import("node:fs");
  const { dirname, join, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const pkg = JSON.parse(await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8")) as { engines: { node: string } };
  let search: SearchReadout;
  try {
    search = (await loadSearchConfig(workspace)) === null ? { kind: "unset" } : { kind: "ok" };
  } catch (err) {
    search = { kind: "broken", message: err instanceof Error ? err.message : String(err) };
  }
  const facts: DoctorFacts = {
    nodeVersion: process.version,
    engines: pkg.engines.node,
    keyPresence: Object.fromEntries(ENV_KEYED_PROVIDERS.map((p) => [PROVIDER_ENV_KEYS[p], (process.env[PROVIDER_ENV_KEYS[p]] ?? "").trim() !== ""])),
    sandbox: await checkSandbox(),
    workspaceWritable: await access(workspace, W_OK).then(() => true, () => false),
    search,
    tierCounts: {
      total: DEFAULT_MODEL_TABLE.length,
      cheap: specsByTier(DEFAULT_MODEL_TABLE, "cheap").length,
      standard: specsByTier(DEFAULT_MODEL_TABLE, "standard").length,
      strong: specsByTier(DEFAULT_MODEL_TABLE, "strong").length,
    },
    ...inject,
  };
  const checks = collectDoctorChecks(facts);
  return { checks, ...verdictOf(checks) };
}
```

- [x] **Step 4: 跑判卷确认绿**（同一命令 ⇒ PASS；facts() 里 registry 现读的辅助按 Step 1 注释实现）。
- [x] **Step 5: 追加 runDoctor 集成判卷**（IO 壳用真 tmpdir 验两条最薄的路；沙箱探测注入，不在判卷里赌机器状态）：

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../src/main/doctor";

describe("runDoctor（IO 壳，tmpdir 真工作区）", () => {
  it("空目录：workspace 可写 ✓、search 未配不抛（loadSearchConfig 的 ENOENT ⇒ null ⇒ unset）", async () => {
    const ws = mkdtempSync(join(tmpdir(), "doctor-"));
    try {
      const r = await runDoctor(ws, { sandbox: { available: true } });
      expect(r.checks.find((c) => c.id === "workspace")!.ok).toBe(true);
      expect(r.checks.find((c) => c.id === "search")!.detail).toContain("未配");
    } finally { rmSync(ws, { recursive: true, force: true }); }
  });

  it(".agent/config.json 是坏 JSON ⇒ search 落在 broken（报告不抛、非致命）", async () => {
    const ws = mkdtempSync(join(tmpdir(), "doctor-"));
    try {
      mkdirSync(join(ws, ".agent"), { recursive: true });
      writeFileSync(join(ws, ".agent", "config.json"), "{bad json");
      const r = await runDoctor(ws, { sandbox: { available: true } });
      const search = r.checks.find((c) => c.id === "search")!;
      expect(search.ok).toBe(false);
      expect(search.fatal).toBe(false);
      expect(search.detail).toContain("解析失败");
    } finally { rmSync(ws, { recursive: true, force: true }); }
  });
});
```

---

### Task 3: CLI 接线 `--version` / `--doctor` ＋ cli-surface 判卷同步

**Files:**
- Modify: `src/cli.ts`（parseArgs 约 :240、main 约 :918、help 文本约 :878、ROOT 常量约 :178）
- Test: `tests/cli-surface.test.ts`（追加两条真跑判卷＋runCli 加 `keys` 注入口）

**Interfaces:**
- Consumes: Task 2 的 `runDoctor`/`renderDoctor`；`parseArgs()` 现返回 `Options | "help"`。
- Produces: `cairn --version` 一行 `cairn <version>` exit 0；`cairn --doctor` 渲染报告、exit = report.exitCode；两者进 `--help`。

- [x] **Step 1: 先加判卷**（`tests/cli-surface.test.ts`；runCli 助手在删 key 之后加 `Object.assign(env, opts.keys ?? {})`，让「假 key 值绝不入报告」可测）

```typescript
it("真跑：--version 打印 cairn <version>，与 package.json 同源，exit 0", () => {
  const r = runCli(["--version"]);
  expect(r.status).toBe(0);
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
  expect(r.out.trim()).toBe("cairn " + pkg.version);
});

it("真跑：--doctor 逐项报告＋总档；假 key 的值绝不出现；node 满足 engines ⇒ exit 0", () => {
  const r = runCli(["--doctor"], { noKeys: true, keys: { OPENAI_API_KEY: "sk-secret-probe-value" } });
  expect(r.status).toBe(0);
  expect(r.out).toContain("✓ node");
  expect(r.out).toContain("keys");
  expect(r.out).toContain("总档：");
  expect(r.out).toContain("OPENAI_API_KEY ✓");
  expect(r.out).not.toContain("sk-secret-probe-value");
});
```

- [x] **Step 2: 跑判卷确认红**（`--version` 现在会撞用法错 exit 2）。
- [x] **Step 3: 接线 `src/cli.ts`**：

```typescript
// ---- parseArgs 顶部（--help 判定旁；这两个旗标不看其余 argv，给了就分派）----
if (argv.includes("--version")) return "version";
if (argv.includes("--doctor")) return "doctor";

// ---- main()（"help" 分支旁）----
if (opts === "version") {
  process.stdout.write("cairn " + PKG_VERSION + "\n");
  return EXIT_OK;
}
if (opts === "doctor") {
  const wsFlag = pick("--workspace");
  const report = await runDoctor(wsFlag !== null ? wsFlag : process.cwd());
  process.stdout.write(renderDoctor(report));
  return report.exitCode;
}
```

`PKG_VERSION` 单一事实源（cli.ts 顶部，ROOT 已在）：

```typescript
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
const PKG_VERSION = PKG.version;
```

help 文本（约 :878 用法块）补两行：

```
  --version            打印版本（cairn <version>）后退出
  --doctor             环境自检（Node/凭据在位/沙箱/工作区可写；不回显密钥值）后退出
```

同步 `parseArgs` 返回类型：`Promise<Options | "help" | "version" | "doctor">`（以现读签名为准，是同步函数就去掉 await）。

- [x] **Step 4: 跑判卷确认绿**＋跑既有 cli-surface 全文件确认无回归。
- [x] **Step 5: 人肉冒烟**：`./bin/cairn.mjs --version`、`./bin/cairn.mjs --doctor`、`./bin/cairn.mjs -h | grep doctor`。

---

### Task 4: `scripts/install.sh`

**Files:**
- Create: `scripts/install.sh`（非 `*check*` 形态，孤儿验收脚本门不拦；spec §3 已裁不新增 GATES 条目）

**Interfaces:**
- Consumes: `package.json` 的 engines（单一事实源，node -p 现读）。
- Produces: 可跑的安装路径（README Task 6 引用）。

- [x] **Step 1: 写脚本**

```bash
#!/usr/bin/env bash
# Cairn 安装（spec：2026-10-06-productization-b1 §1#3）。
# 前提：本仓库已 clone（本包 private，不发布 npm）。两步走：git clone → ./scripts/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "[cairn] 未找到 node：先装 Node（版本区间见 package.json 的 engines）。" >&2
  exit 1
fi
# Node 版本按 package.json engines 判（安装期 tsx 未装不能 import，用 node -e 内联同一条比较规则；
# 区间从 engines 现读，不在这里抄第二份）。判据与 src/main/doctor.ts 的 nodeVersionOk 同构。
node -e '
  const e = require("./package.json").engines.node;
  const m = /^>=v?(\d+)\.(\d+)\.(\d+)\s*<(\d+)\s*$/.exec(e.trim());
  if (!m) { console.error("[cairn] engines.node 读不出来：" + e); process.exit(1); }
  const v = process.versions.node.split(".").map(Number);
  const cur = [v[0], v[1], v[2]], min = [+m[1], +m[2], +m[3]];
  const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
  if (!(cmp(cur, min) >= 0 && v[0] < +m[4])) {
    console.error("[cairn] Node " + process.versions.node + " 不满足 engines（" + e + "）");
    process.exit(1);
  }
'

echo "[cairn] 装依赖（pnpm 在则 pnpm，否则 npm）……"
if command -v pnpm >/dev/null 2>&1; then
  pnpm install
else
  echo "[cairn] 未找到 pnpm，退回 npm install。"
  npm install
fi

echo
echo "[cairn] 装好了。下一步三条："
echo "  1) 零凭据看流程：./bin/cairn.mjs --provider demo --mode auto --workspace /tmp/cairn-demo \"随便写点什么\""
echo "  2) 真跑：export OPENAI_API_KEY=<你的 key> && ./bin/cairn.mjs \"你的任务\""
echo "  3) 自检：./bin/cairn.mjs --doctor"
```

- [x] **Step 2: `chmod +x scripts/install.sh`**。
- [x] **Step 3: 人肉冒烟**：在已装环境真跑一遍（应走 pnpm 支、 enginse 判过、三条下一步打出）；`bash -n scripts/install.sh` 过语法。

---

### Task 5: 身份面（LICENSE / CHANGELOG / 版本号；tag 留业主）

**Files:**
- Create: `LICENSE`
- Create: `CHANGELOG.md`
- Modify: `package.json`（version `0.0.1` → `0.1.0`）

**Interfaces:**
- Consumes: `docs/b2-checklist.md`（Task 1）。
- Produces: `cairn --version` 读到 `0.1.0`（Task 3 的同源判卷自动钉住）。

- [x] **Step 1: 写 LICENSE**（spec #6：专有——All rights reserved＋内测授权一行；OSS 选型留 B2 门）

```
Cairn — 可重放的 agent harness
Copyright (c) 2026 仓库所有者。保留所有权利（All rights reserved）。

本软件为专有软件，按「内测授权」分发：仅限仓库所有者明确授权的个人或团队，
出于内测目的复制、运行与修改；不得再分发、不得公开部署、不得用于生产服务。
授权放宽的选型记录在 docs/b2-checklist.md（B2 门）。
```

- [x] **Step 2: 写 CHANGELOG.md**

```markdown
# Changelog

## 0.1.0 — 2026-10-06

首个内测版（B1：自用/内测开发者先行；受众与范围裁决见 `docs/adr/0002-v1-audience-b1-internal-beta.md`）。

- CLI 交付面：`cairn <任务>` 目标轮、`--goal` 目标模式、四档 `--mode`、`--replay`/`--fork`/`--compact`、
  `--serve`（调度器常驻）、`--provider demo`（零凭据预录剧本）
- 本版新增：`--version`、`--doctor`（环境自检）、`scripts/install.sh`
- 不在本版交付面：桌面端（`apps/`，ADR 0001/0002 裁决）、npm 发布（B2 门）
```

- [x] **Step 3: `package.json` version 改 `0.1.0`**；跑 `tests/cli-surface.test.ts` 的 --version 判卷确认同源读数跟着走。
- [x] **Step 4: 不打 tag**（业主门全绿后亲手打 `v0.1.0`）。

---

### Task 6: README / DOCS-MAP 增量（不重写）

**Files:**
- Modify: `README.md`（注意：该文件有他人会话在飞改动——在其现状之上增量，不回退任何既有行）
- Modify: `docs/DOCS-MAP.md`（若 docs-check 要求登记）

**Interfaces:**
- Consumes: Task 1/3/4 的产物（install.sh、--doctor/--version、ADR 0002、b2-checklist）。

- [x] **Step 1: README「快速开始」前加「安装」小节**：

```markdown
### 安装

本包不发布 npm（`private: true`），装法是克隆仓库后跑安装脚本：

```sh
git clone <this-repo> && cd cairn-harness
./scripts/install.sh        # 按 package.json 的 engines 判 Node 版本；pnpm 在则 pnpm install，否则 npm install
./bin/cairn.mjs --doctor    # 环境自检：Node / 凭据在位 / 沙箱 / 工作区可写（不回显密钥值）
```

版本与受众裁决见 `docs/adr/0002-v1-audience-b1-internal-beta.md`（B1 内测先行；
`--version` 打印版本；B2 扩受众清单留门 `docs/b2-checklist.md`）。
```

- [x] **Step 2: 对齐 Node 口径**：README 里「Node 20.3+（`AbortSignal.any` 的下限）」改为以 `package.json` engines 为准（`>=20.11 <25`）。
- [x] **Step 3: 跑 `pnpm docs-check`**，按其要求把 ADR 0002 / b2-checklist / doctor.ts 登记进 `docs/DOCS-MAP.md`（能过就最小登记，别扩写）。

---

### Task 7: 交笔自检＋落笔清单

**Files:** 无新文件（跑门禁、产出交接清单给业主）。

- [x] **Step 1**: `node --import tsx scripts/typecheck.ts` ⇒ 0 报错。
- [x] **Step 2**: 全量判卷 ⇒ 本笔新增/改动文件相关的用例全绿；既有 4 条他人在飞红按 `/tmp/dsh-suite.log` 归因，不代修。
- [x] **Step 3**: `pnpm docs-check` ⇒ 过。
- [x] **Step 4**: 落笔清单＝文末「执行记录」；commit 由验收笔代行（第 406 页）；`tag v0.1.0` 留业主。

---

## 执行记录（2026-10-06 验收笔）

施工体由并行会话按本计划落进工作树；验收笔逐项现读验收后落账。

**验收（对照 spec §1 七件套）**：ADR 0002、b2-checklist、install.sh、doctor 核＋判卷、CLI 接线（diff 范围干净，只含 `--version`/`--doctor`）、身份面（LICENSE 专有内测授权／CHANGELOG 0.1.0 如实列面／版本号 0.0.1→0.1.0）、README 增量（「安装」小节、两旗标、ADR/b2/CHANGELOG 链、Node 口径对齐 ≥20.11）——全部合格。

**过门**：
- typecheck：0 条报错。
- docs-check：过（UNVERIFIED=3 为既有口径）。
- 全量判卷：**4800/4802，2 红**，均为**他人在飞改动**、非本笔文件——
  ① `prompt-surface-check` 接线格（system-prompt／agent-runner 在飞）；
  ② `repo-hygiene` 帽格（`agent-runner.ts` 现读 3011 > 帽 3000；本笔最大新增 doctor.ts 177 行）。
  本笔文件相关用例（doctor.test／cli-surface）全绿。按 spec §3「不背锅、不代修」。
- 冒烟：`cairn 0.1.0` exit 0；`--doctor` 六项报告如实（本机无 key ⇒ 部分就绪，exit 0，退出码契约兑现）；
  install.sh `bash -n` 过。

**施工补遗**：install.sh 补可执行位（计划 Task 4 Step 2 原列未执行，验收笔 `chmod +x` 补上）。

**落账**：commit 第 406 页（本笔）；`tag v0.1.0` **留业主**——全部门绿这一格今天被那 2 条他人在飞红占着，
打不打、何时打由业主裁（命令备好：`git tag -a v0.1.0 -m "Cairn v0.1.0 — B1 内测首版（B1 内测先行，交付面 CLI）"`）。
README／DOCS-MAP 整文件落账：其内混有既有 m0→Cairn 命名对齐（他方在飞同向改动，与已提交代码一致），提交信息已写明。
