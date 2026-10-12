// SEMA Phase 2 判卷（docs/sema-proposal.md §11）：进化平面 v1（人辅档）+ grants 取料面。
// 判据全在 tmp 根上跑（测试数据绝不落工作区）；门执行面用注桩，不起真进程。核心断言全配反向验证。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GATES } from "../scripts/gate-manifest";
import {
  EvolutionPlane,
  EVOLUTION_PIPELINE_V1,
  PIPELINE_KINDS,
  ProposalRefusedError,
} from "../src/main/evolution/evolution-plane";
import { GrantsConfigError, GrantsStore } from "../src/main/evolution/grants";
import { GateRunner } from "../src/main/evolution/gate-runner";
import { ModuleRegistry } from "../src/main/evolution/registry";

const GATE_SET = new Set(GATES);
const TOOL_GATES = ["typecheck", "tools-check"];

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sema-plane-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function registry(): ModuleRegistry {
  return new ModuleRegistry(root, { knownGates: GATE_SET });
}

function plane(reg?: ModuleRegistry): EvolutionPlane {
  return new EvolutionPlane({ registry: reg ?? registry() });
}

function toolManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "tool.demo-fetch",
    version: "0.1.0",
    kind: "tool",
    entry: "index.ts",
    deps: ["src/tools/base"],
    permissions: ["net.fetch"],
    gates: TOOL_GATES,
    title: "Demo fetch tool",
    ...over,
  };
}

function contentManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "content-pack.demo-prompts",
    version: "0.1.0",
    kind: "content-pack",
    deps: [],
    permissions: [],
    gates: TOOL_GATES,
    ...over,
  };
}

async function grantsFile(content: Record<string, unknown> | string): Promise<void> {
  await mkdir(join(root, "modules"), { recursive: true });
  await writeFile(join(root, "modules", "grants.json"), typeof content === "string" ? content : JSON.stringify(content), "utf8");
}

async function passAllGates(reg: ModuleRegistry, id: string, version: string): Promise<void> {
  const runner = new GateRunner({ registry: reg, runGate: async () => ({ code: 0 }), cwd: root });
  await runner.runDeclaredGates(id, version);
}

async function logEvents(): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(join(root, "modules", "registry.jsonl"), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("GrantsStore 取料面（§10 立案的接线）", () => {
  it("缺文件 = 空授权面（fail-closed 缺省）；合法文件现读 exact 词与 <ns>.* 通配", async () => {
    const store = new GrantsStore(join(root, "modules"));
    expect([...(await store.load())]).toEqual([]);
    await grantsFile({ version: 1, grants: ["net.fetch", "mcp.*"] });
    const grants = await store.load();
    expect(grants.has("net.fetch")).toBe(true);
    expect(grants.has("mcp.*")).toBe(true);
    expect(grants.has("fs.write")).toBe(false);
  });

  it("非法授权词全红：裸 *、单段命名空间、深通配 a.b.*、大写词干", async () => {
    for (const bad of ["*", "net", "a.b.*", "Net.Fetch"]) {
      await grantsFile({ version: 1, grants: [bad] });
      await expect(new GrantsStore(join(root, "modules")).load()).rejects.toThrow(GrantsConfigError);
    }
  });

  it("坏账全红：坏 JSON / 未知顶层字段 / version 漂移 / 重复授权词", async () => {
    await grantsFile("{ not json");
    await expect(new GrantsStore(join(root, "modules")).load()).rejects.toThrow(/不是合法 JSON/);
    await grantsFile({ version: 1, grants: [], autoGrant: true });
    await expect(new GrantsStore(join(root, "modules")).load()).rejects.toThrow(/未知顶层字段/);
    await grantsFile({ version: 2, grants: [] });
    await expect(new GrantsStore(join(root, "modules")).load()).rejects.toThrow(/version 非法/);
    await grantsFile({ version: 1, grants: ["net.fetch", "net.fetch"] });
    await expect(new GrantsStore(join(root, "modules")).load()).rejects.toThrow(/重复/);
  });
});

describe("EvolutionPlane submitProposal", () => {
  it("tool 正向：staging 落盘、管线 signedBy 戳、账本定格门清单与权限面、actor = 管线", async () => {
    const receipt = await plane().submitProposal({ manifest: toolManifest(), files: { "index.ts": "export const demo = 1;\n" } });
    expect(receipt.id).toBe("tool.demo-fetch");
    expect(receipt.stagingDir).toBe(join(root, "modules", "staging", "tool.demo-fetch", "0.1.0"));
    expect(existsSync(join(receipt.stagingDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(receipt.stagingDir, "index.ts"))).toBe(true);
    const stamped = JSON.parse(await readFile(join(receipt.stagingDir, "manifest.json"), "utf8")) as Record<string, unknown>;
    expect(stamped.signedBy).toBe(EVOLUTION_PIPELINE_V1);
    expect(receipt.record.versions["0.1.0"]?.declaredGates).toEqual(TOOL_GATES);
    expect(receipt.record.versions["0.1.0"]?.permissions).toEqual(["net.fetch"]);
    const events = await logEvents();
    expect(events[0]?.op).toBe("register");
    expect(events[0]?.actor).toBe(EVOLUTION_PIPELINE_V1);
  });

  it("content-pack 正向：无 entry、嵌套目录文件照落", async () => {
    const receipt = await plane().submitProposal({
      manifest: contentManifest(),
      files: { "prompts/base.md": "# base\n", "prompts/deep/review.md": "review" },
    });
    expect(existsSync(join(receipt.stagingDir, "prompts", "base.md"))).toBe(true);
    expect(existsSync(join(receipt.stagingDir, "prompts", "deep", "review.md"))).toBe(true);
    expect(receipt.record.versions["0.1.0"]?.entry).toBeUndefined();
  });

  it("kind 越围即拒：service / plugin 都不进流水线门", async () => {
    expect(PIPELINE_KINDS).toEqual(["tool", "content-pack", "desktop-panel"]);
    for (const kind of ["service", "plugin"] as const) {
      await expect(
        plane().submitProposal({
          manifest: toolManifest({ kind, id: `${kind}.demo-x` }),
          files: { "index.ts": "x" },
        }),
      ).rejects.toThrow(/只收 tool \/ content-pack \/ desktop-panel/);
    }
  });

  it("manifest 契约不合法 → 拒且盘上无半成品", async () => {
    await expect(
      plane().submitProposal({ manifest: toolManifest({ autoGrant: true }), files: { "index.ts": "x" } }),
    ).rejects.toThrow(/manifest 契约不合法/);
    expect(existsSync(join(root, "modules", "staging", "tool.demo-fetch"))).toBe(false);
  });

  it("files 路径逃逸全拒：..、绝对路径、反斜杠，且无痕", async () => {
    for (const files of [{ "../escape.ts": "x" }, { "/abs.ts": "x" }, { "back\\slash.ts": "x" }]) {
      await expect(plane().submitProposal({ manifest: toolManifest(), files })).rejects.toThrow(ProposalRefusedError);
    }
    expect(existsSync(join(root, "modules", "staging", "tool.demo-fetch"))).toBe(false);
  });

  it("manifest.json 不得由 files 带；entry 声明了缺文件也拒", async () => {
    await expect(
      plane().submitProposal({ manifest: toolManifest(), files: { "manifest.json": "{}" } }),
    ).rejects.toThrow(/manifest\.json/);
    await expect(plane().submitProposal({ manifest: toolManifest(), files: {} })).rejects.toThrow(/manifest\.entry/);
  });

  it("文件与目录前缀冲突拒：同一相对路径不能既是文件又是目录", async () => {
    await expect(
      plane().submitProposal({ manifest: toolManifest(), files: { "a": "x", "a/b": "y" } }),
    ).rejects.toThrow(/前缀/);
  });

  it("signedBy 提案自带 → 拒（管线身份由进化平面落盘时自己盖）", async () => {
    await expect(
      plane().submitProposal({ manifest: toolManifest({ signedBy: "someone-else" }), files: { "index.ts": "x" } }),
    ).rejects.toThrow(/signedBy/);
  });

  it("同 id@version 重提拒——版本不可变从 staging 起；bump version 后过", async () => {
    const p = plane();
    await p.submitProposal({ manifest: toolManifest(), files: { "index.ts": "v1" } });
    await expect(p.submitProposal({ manifest: toolManifest(), files: { "index.ts": "v2" } })).rejects.toThrow(/staging 位已存在/);
    await p.submitProposal({ manifest: toolManifest({ version: "0.2.0" }), files: { "index.ts": "v2" } });
  });

  it("进账被拒（重复注册）→ staging 清退无痕", async () => {
    const reg = registry();
    const p = plane(reg);
    await p.submitProposal({ manifest: toolManifest(), files: { "index.ts": "v1" } });
    await rm(join(root, "modules", "staging", "tool.demo-fetch", "0.1.0"), { recursive: true, force: true });
    await expect(p.submitProposal({ manifest: toolManifest(), files: { "index.ts": "v2" } })).rejects.toThrow(/重复注册/);
    expect(existsSync(join(root, "modules", "staging", "tool.demo-fetch", "0.1.0"))).toBe(false);
  });

  it("膨胀护栏：单文件超帽拒", async () => {
    await expect(
      plane().submitProposal({ manifest: toolManifest(), files: { "big.ts": "x".repeat(1_048_577) } }),
    ).rejects.toThrow(/单文件超帽/);
  });
});

describe("installApprovedProposal（v1 全量人工档）", () => {
  it("零权限包缺 approvedBy 也拒；approvedBy = 管线自己（自审批）也拒", async () => {
    const reg = registry();
    const p = plane(reg);
    await p.submitProposal({ manifest: contentManifest(), files: { "prompts/base.md": "# base\n" } });
    await passAllGates(reg, "content-pack.demo-prompts", "0.1.0");
    await expect(p.installApprovedProposal("content-pack.demo-prompts", "0.1.0", { approvedBy: "" })).rejects.toThrow(
      /approvedBy/,
    );
    await expect(
      p.installApprovedProposal("content-pack.demo-prompts", "0.1.0", { approvedBy: EVOLUTION_PIPELINE_V1 }),
    ).rejects.toThrow(/自审批/);
  });

  it("grants 取料面接线：grants.json 缺 → 未授权拒；补授权配置后同一提案装上", async () => {
    const reg = registry();
    const p = plane(reg);
    await p.submitProposal({ manifest: toolManifest(), files: { "index.ts": "export const demo = 1;\n" } });
    await passAllGates(reg, "tool.demo-fetch", "0.1.0");
    await expect(p.installApprovedProposal("tool.demo-fetch", "0.1.0", { approvedBy: "owner" })).rejects.toThrow(
      /未授权即拒装/,
    );
    await grantsFile({ version: 1, grants: ["net.*"] });
    const outcome = await p.installApprovedProposal("tool.demo-fetch", "0.1.0", { approvedBy: "owner" });
    expect(outcome.activeVersion).toBe("0.1.0");
    expect(existsSync(join(root, "modules", "installed", "tool.demo-fetch", "0.1.0", "index.ts"))).toBe(true);
    const activateEvt = (await logEvents()).find((e) => e.op === "activate");
    expect(activateEvt?.actor).toBe("owner");
  });

  it("未过全门拒装（未过验证的包不进安装序）", async () => {
    const reg = registry();
    const p = plane(reg);
    await p.submitProposal({ manifest: toolManifest(), files: { "index.ts": "x" } });
    await grantsFile({ version: 1, grants: ["net.*"] });
    await expect(p.installApprovedProposal("tool.demo-fetch", "0.1.0", { approvedBy: "owner" })).rejects.toThrow(
      /未过全门/,
    );
  });

  it("kind 越围的预置账不进 v1 前门（service 走控制平面直连，不经进化平面）", async () => {
    const reg = registry();
    const dir = join(root, "modules", "staging", "service.demo-queue", "0.1.0");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "manifest.json"),
      JSON.stringify({ id: "service.demo-queue", version: "0.1.0", kind: "service", entry: "index.ts", deps: ["src/agent"], permissions: [], gates: TOOL_GATES }),
      "utf8",
    );
    await writeFile(join(dir, "index.ts"), "export const q = 1;\n", "utf8");
    await reg.registerStaged("service.demo-queue", "0.1.0", "human");
    await passAllGates(reg, "service.demo-queue", "0.1.0");
    await expect(plane(reg).installApprovedProposal("service.demo-queue", "0.1.0", { approvedBy: "owner" })).rejects.toThrow(
      /本流水线只装/,
    );
  });

  it("content-pack 端到端：submit → 全门绿 → 审批安装 → 指针切上", async () => {
    const reg = registry();
    const p = plane(reg);
    await p.submitProposal({
      manifest: contentManifest(),
      files: { "prompts/base.md": "# base\n", "prompts/deep/review.md": "review" },
    });
    await passAllGates(reg, "content-pack.demo-prompts", "0.1.0");
    const outcome = await p.installApprovedProposal("content-pack.demo-prompts", "0.1.0", { approvedBy: "owner" });
    expect(outcome.activeVersion).toBe("0.1.0");
    expect(existsSync(join(root, "modules", "installed", "content-pack.demo-prompts", "0.1.0", "prompts", "base.md"))).toBe(true);
    const index = await reg.readIndex();
    expect(index.bundles["content-pack.demo-prompts"]?.active?.version).toBe("0.1.0");
  });
});

describe("Phase 3：desktop-panel 进同一流水线（§3.5/§12）", () => {
  const DESKTOP_REQUIRED = ["desktop-boundary-check", "desktop-test"];
  const DESKTOP_GATES = ["typecheck", ...DESKTOP_REQUIRED];

  function panelPlane(reg?: ModuleRegistry): EvolutionPlane {
    return new EvolutionPlane({ registry: reg ?? registry(), requiredGatesByKind: { "desktop-panel": DESKTOP_REQUIRED } });
  }

  function panelManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "desktop-panel.demo-costs",
      version: "0.1.0",
      kind: "desktop-panel",
      entry: "panel.tsx",
      deps: ["apps/desktop/src"],
      permissions: [],
      gates: DESKTOP_GATES,
      title: "Cost panel",
      ...over,
    };
  }

  it("desktop-panel 端到端：submit（必需门齐）→ 全门绿 → 审批安装 → 指针切上", async () => {
    const reg = registry();
    const p = panelPlane(reg);
    const receipt = await p.submitProposal({
      manifest: panelManifest(),
      files: { "panel.tsx": "export function Panel() { return null; }\n", "panel.css": ".panel {}" },
    });
    expect(receipt.record.kind).toBe("desktop-panel");
    expect(receipt.record.versions["0.1.0"]?.declaredGates).toEqual(DESKTOP_GATES);
    await passAllGates(reg, "desktop-panel.demo-costs", "0.1.0");
    const outcome = await p.installApprovedProposal("desktop-panel.demo-costs", "0.1.0", { approvedBy: "owner" });
    expect(outcome.activeVersion).toBe("0.1.0");
    expect(existsSync(join(root, "modules", "installed", "desktop-panel.demo-costs", "0.1.0", "panel.tsx"))).toBe(true);
  });

  it("必需门缺席即拒（缺了就不会跑，缺席当通过比跳过更坏），且无痕", async () => {
    await expect(
      panelPlane().submitProposal({
        manifest: panelManifest({ gates: ["typecheck"] }),
        files: { "panel.tsx": "x" },
      }),
    ).rejects.toThrow(/必需门未声明/);
    expect(existsSync(join(root, "modules", "staging", "desktop-panel.demo-costs"))).toBe(false);
  });

  it("安装前对账本门清单再核一遍：注册后策略加严的存量包拒装（重提请 bump version）", async () => {
    const reg = registry();
    const oldPolicy = new EvolutionPlane({ registry: reg });
    // 旧策略面没有 requiredGatesByKind，提交只声明 typecheck 也能进账——缺口正是要拦的那个。
    await oldPolicy.submitProposal({ manifest: panelManifest({ gates: ["typecheck"] }), files: { "panel.tsx": "x" } });
    await passAllGates(reg, "desktop-panel.demo-costs", "0.1.0");
    await expect(
      panelPlane(reg).installApprovedProposal("desktop-panel.demo-costs", "0.1.0", { approvedBy: "owner" }),
    ).rejects.toThrow(/注册时未声明必需门/);
  });

  it("desktop-panel 的 deps 伸进 src/ 在 manifest 契约层就红（schema 面，不等运行期）", async () => {
    await expect(
      panelPlane().submitProposal({
        manifest: panelManifest({ deps: ["src/tools/base"] }),
        files: { "panel.tsx": "x" },
      }),
    ).rejects.toThrow(/manifest 契约不合法/);
  });
});
