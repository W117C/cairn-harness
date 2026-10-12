// SEMA Phase 1 判卷（docs/sema-proposal.md §10）：Permission Broker / Gate Runner / Installer。
// 判据全在 tmp 根上跑（测试数据绝不落工作区）；门执行面用注桩，不起真进程。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GATES } from "../scripts/gate-manifest";
import { GateRunner } from "../src/main/evolution/gate-runner";
import { Installer, InstallRefusedError } from "../src/main/evolution/installer";
import { adjudicateInstall, DEFAULT_HIGH_RISK_NAMESPACES } from "../src/main/evolution/permission-broker";
import { ModuleRegistry, RegistryStateError } from "../src/main/evolution/registry";

const GATE_SET = new Set(GATES);
const TOOL_GATES = ["typecheck", "tools-check"];

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sema-install-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function registry(): ModuleRegistry {
  return new ModuleRegistry(root, { knownGates: GATE_SET });
}

async function stageBundle(id = "tool.demo-fetch", version = "0.1.0", over: Record<string, unknown> = {}): Promise<void> {
  const dir = join(root, "modules", "staging", id, version);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "manifest.json"),
    JSON.stringify({
      id,
      version,
      kind: id.split(".")[0],
      entry: "index.ts",
      deps: ["src/tools/base"],
      permissions: ["net.fetch"],
      gates: TOOL_GATES,
      ...over,
    }),
    "utf8",
  );
  await writeFile(join(dir, "index.ts"), "export const demo = 1;\n", "utf8");
}

async function registeredBundle(id = "tool.demo-fetch", version = "0.1.0", over: Record<string, unknown> = {}): Promise<ModuleRegistry> {
  await stageBundle(id, version, over);
  const reg = registry();
  await reg.registerStaged(id, version, "evo-pipeline");
  return reg;
}

async function passAll(reg: ModuleRegistry, id: string, version: string, gates: readonly string[] = TOOL_GATES): Promise<void> {
  for (const gate of gates) await reg.recordGate(id, version, gate, true, "gate-runner");
}

interface FakeGateSpec {
  codes?: Record<string, number>;
  output?: string;
  calls?: string[];
}

function fakeRunGate(spec: FakeGateSpec = {}): (gate: string) => Promise<{ code: number; output?: string }> {
  return async (gate: string) => {
    spec.calls?.push(gate);
    const code = spec.codes?.[gate] ?? 0;
    return code === 0 ? { code: 0 } : { code, output: spec.output ?? "TYPE ERROR ts(2322):\n  at line 1\n\u0007bell" };
  };
}

describe("Permission Broker 裁决", () => {
  it("全授权且非高危 → 两清单皆空", () => {
    const adj = adjudicateInstall(["mcp.spawn", "ui.panel"], new Set(["mcp.spawn", "ui.panel"]));
    expect(adj).toEqual({ missing: [], requiringApproval: [] });
  });

  it("授权面没覆盖 → missing 列出缺口（拒装）", () => {
    const adj = adjudicateInstall(["net.fetch", "fs.write"], new Set(["net.fetch"]));
    expect(adj.missing).toEqual(["fs.write"]);
  });

  it("命名空间通配 net.* 覆盖 net.fetch", () => {
    expect(adjudicateInstall(["net.fetch"], new Set(["net.*"])).missing).toEqual([]);
  });

  it("高危命名空间即便已授权也进 requiringApproval（人工档不可被授权豁免）", () => {
    const adj = adjudicateInstall(["shell.exec", "mcp.spawn"], new Set(["shell.exec", "mcp.spawn"]));
    expect(adj.missing).toEqual([]);
    expect(adj.requiringApproval).toEqual(["shell.exec"]);
    expect(DEFAULT_HIGH_RISK_NAMESPACES).toEqual(["shell", "net", "fs"]);
  });

  it("高危名单可注入（与 GATES 同款纪律，不在 src 抄死）", () => {
    const adj = adjudicateInstall(["shell.exec"], new Set(["shell.exec"]), ["fs"]);
    expect(adj.requiringApproval).toEqual([]);
  });

  it("空权限包（纯内容）恒通过裁决", () => {
    expect(adjudicateInstall([], new Set())).toEqual({ missing: [], requiringApproval: [] });
  });
});

describe("Gate Runner 编排", () => {
  it("全绿：按声明顺序逐道跑闸并落账，随后可激活", async () => {
    const reg = await registeredBundle();
    const calls: string[] = [];
    const runner = new GateRunner({ registry: reg, runGate: fakeRunGate({ calls }), cwd: root });
    const results = await runner.runDeclaredGates("tool.demo-fetch", "0.1.0");
    expect(calls).toEqual(TOOL_GATES);
    expect(results.map((r) => r.passed)).toEqual([true, true]);
    const entry = await reg.activate("tool.demo-fetch", "0.1.0", "human");
    expect(entry.active?.version).toBe("0.1.0");
  });

  it("首红即停：后面的门不跑，账面落红，激活被拒", async () => {
    const reg = await registeredBundle();
    const calls: string[] = [];
    const runner = new GateRunner({ registry: reg, runGate: fakeRunGate({ codes: { typecheck: 1 }, calls }), cwd: root });
    const results = await runner.runDeclaredGates("tool.demo-fetch", "0.1.0");
    expect(calls).toEqual(["typecheck"]);
    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(false);
    await expect(reg.activate("tool.demo-fetch", "0.1.0", "human")).rejects.toThrow(/未过闸门/);
  });

  it("失败 detail 剥控制字符、取尾巴 ≤400，随 gate 事件落 JSONL", async () => {
    const reg = await registeredBundle();
    const runner = new GateRunner({
      registry: reg,
      runGate: fakeRunGate({ codes: { typecheck: 1 }, output: "错\u0007误\r\n" + "x".repeat(900) }),
      cwd: root,
    });
    await runner.runDeclaredGates("tool.demo-fetch", "0.1.0");
    const logText = await readFile(join(root, "modules", "registry.jsonl"), "utf8");
    const gateEvts = logText.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e.op === "gate");
    const detail = String(gateEvts[gateEvts.length - 1]?.detail ?? "");
    expect(detail.length).toBeLessThanOrEqual(400);
    expect(detail).not.toMatch(/[\u0000-\u001f]/);
  });

  it("重跑是全量重验：先 pass 后 fail，翻账后激活被拒", async () => {
    const reg = await registeredBundle();
    const green = new GateRunner({ registry: reg, runGate: fakeRunGate(), cwd: root });
    await green.runDeclaredGates("tool.demo-fetch", "0.1.0");
    const red = new GateRunner({ registry: reg, runGate: fakeRunGate({ codes: { typecheck: 2 } }), cwd: root });
    await red.runDeclaredGates("tool.demo-fetch", "0.1.0");
    await expect(reg.activate("tool.demo-fetch", "0.1.0", "human")).rejects.toThrow(/未过闸门/);
  });

  it("未注册的包不得跑闸", async () => {
    const reg = registry();
    const runner = new GateRunner({ registry: reg, runGate: fakeRunGate(), cwd: root });
    await expect(runner.runDeclaredGates("tool.ghost", "0.1.0")).rejects.toThrow(RegistryStateError);
  });
});

describe("Installer 安装序", () => {
  it("正向：裁决 → 查账 → 部署 → 激活，installed 目录与指针齐备", async () => {
    const reg = await registeredBundle();
    await passAll(reg, "tool.demo-fetch", "0.1.0");
    const installer = new Installer(reg);
    const outcome = await installer.installStaged({
      id: "tool.demo-fetch",
      version: "0.1.0",
      actor: "evo-pipeline",
      grants: new Set(["net.fetch"]),
      approvedBy: "owner",
    });
    expect(outcome.activeVersion).toBe("0.1.0");
    const installedDir = join(root, "modules", "installed", "tool.demo-fetch", "0.1.0");
    expect(existsSync(join(installedDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(installedDir, "index.ts"))).toBe(true);
    const index = await reg.readIndex();
    expect(index.bundles["tool.demo-fetch"]?.active?.version).toBe("0.1.0");
  });

  it("标准权限包无需人工确认即可安装", async () => {
    const reg = await registeredBundle("tool.demo-mcp", "0.1.0", { permissions: ["mcp.spawn"] });
    await passAll(reg, "tool.demo-mcp", "0.1.0");
    const outcome = await new Installer(reg).installStaged({
      id: "tool.demo-mcp",
      version: "0.1.0",
      actor: "evo-pipeline",
      grants: new Set(["mcp.spawn"]),
    });
    expect(outcome.activeVersion).toBe("0.1.0");
  });

  it("未过全门拒装，且不留半成品目录", async () => {
    const reg = await registeredBundle();
    const installer = new Installer(reg);
    await expect(installer.installStaged({
      id: "tool.demo-fetch", version: "0.1.0", actor: "evo-pipeline",
      grants: new Set(["net.fetch"]), approvedBy: "owner",
    })).rejects.toThrow(/未过全门/);
    expect(existsSync(join(root, "modules", "installed", "tool.demo-fetch"))).toBe(false);
  });

  it("未授权即拒装；命名空间通配补齐后过裁决（高危仍需 approvedBy）", async () => {
    const reg = await registeredBundle();
    await passAll(reg, "tool.demo-fetch", "0.1.0");
    const installer = new Installer(reg);
    await expect(installer.installStaged({
      id: "tool.demo-fetch", version: "0.1.0", actor: "evo-pipeline", grants: new Set(),
    })).rejects.toThrow(/未授权即拒装/);
    await expect(installer.installStaged({
      id: "tool.demo-fetch", version: "0.1.0", actor: "evo-pipeline", grants: new Set(["net.*"]),
    })).rejects.toThrow(/人工确认/);
    await installer.installStaged({
      id: "tool.demo-fetch", version: "0.1.0", actor: "evo-pipeline",
      grants: new Set(["net.*"]), approvedBy: "owner",
    });
  });

  it("版本目录不可变：同版本重装即拒（重装请 bump version）", async () => {
    const reg = await registeredBundle();
    await passAll(reg, "tool.demo-fetch", "0.1.0");
    const installer = new Installer(reg);
    const opts = {
      id: "tool.demo-fetch", version: "0.1.0", actor: "evo-pipeline",
      grants: new Set(["net.fetch"]), approvedBy: "owner",
    };
    await installer.installStaged(opts);
    await expect(installer.installStaged(opts)).rejects.toThrow(/版本不可变/);
  });

  it("staging 在注册后被篡改 → 安装前重验拦下（身份不符 / 契约不合法都拒）", async () => {
    const reg = await registeredBundle();
    await passAll(reg, "tool.demo-fetch", "0.1.0");
    const installer = new Installer(reg);
    const manifestPath = join(root, "modules", "staging", "tool.demo-fetch", "0.1.0", "manifest.json");
    await writeFile(manifestPath, JSON.stringify({ id: "tool.demo-fetch", version: "9.9.9", kind: "tool", entry: "index.ts", deps: [], permissions: [], gates: TOOL_GATES }), "utf8");
    await expect(installer.installStaged({
      id: "tool.demo-fetch", version: "0.1.0", actor: "evo-pipeline",
      grants: new Set(["net.fetch"]), approvedBy: "owner",
    })).rejects.toThrow(/身份不一致/);
    await writeFile(manifestPath, JSON.stringify({ id: "tool.demo-fetch", version: "0.1.0", kind: "tool", entry: "index.ts", deps: [], permissions: [], gates: TOOL_GATES, autoGrant: true }), "utf8");
    await expect(installer.installStaged({
      id: "tool.demo-fetch", version: "0.1.0", actor: "evo-pipeline",
      grants: new Set(["net.fetch"]), approvedBy: "owner",
    })).rejects.toThrow(/重验/);
  });

  it("回滚 = 指针对换；previous 文件被删后拒绝再把指针切过去", async () => {
    const reg = await registeredBundle("tool.demo-fetch", "0.1.0");
    await passAll(reg, "tool.demo-fetch", "0.1.0");
    await stageBundle("tool.demo-fetch", "0.2.0");
    await reg.registerStaged("tool.demo-fetch", "0.2.0", "evo-pipeline");
    await passAll(reg, "tool.demo-fetch", "0.2.0");
    const installer = new Installer(reg);
    const opts = { actor: "evo-pipeline", grants: new Set(["net.fetch"]), approvedBy: "owner" };
    await installer.installStaged({ id: "tool.demo-fetch", version: "0.1.0", ...opts });
    await installer.installStaged({ id: "tool.demo-fetch", version: "0.2.0", ...opts });
    expect((await installer.rollbackInstalled("tool.demo-fetch", "human")).active?.version).toBe("0.1.0");
    await installer.rollbackInstalled("tool.demo-fetch", "human"); // 滚回 0.2.0，previous 变 0.1.0
    await rm(join(root, "modules", "installed", "tool.demo-fetch", "0.1.0"), { recursive: true, force: true });
    await expect(installer.rollbackInstalled("tool.demo-fetch", "human")).rejects.toThrow(/未部署在盘上/);
  });
});

describe("清退（prune）账实一致", () => {
  async function threeVersions(): Promise<ModuleRegistry> {
    const reg = registry();
    const installer = new Installer(reg);
    const opts = { actor: "evo-pipeline", grants: new Set(["net.fetch"]), approvedBy: "owner" };
    for (const version of ["0.1.0", "0.2.0", "0.3.0"]) {
      await stageBundle("tool.demo-fetch", version);
      await reg.registerStaged("tool.demo-fetch", version, "evo-pipeline");
      await passAll(reg, "tool.demo-fetch", version);
      await installer.installStaged({ id: "tool.demo-fetch", version, ...opts });
    }
    return reg;
  }

  it("超龄废弃版本被移除并落账；active/previous 位不动；双跑无操作", async () => {
    const reg = await threeVersions();
    const installer = new Installer(reg);
    await reg.deprecate("tool.demo-fetch", "0.1.0", "human");
    const removed = await installer.pruneInstalled(new Date(Date.now() + 31 * 86_400_000), 30, "human");
    expect(removed).toEqual([join("modules", "installed", "tool.demo-fetch", "0.1.0")]);
    expect(existsSync(join(root, "modules", "installed", "tool.demo-fetch", "0.1.0"))).toBe(false);
    const index = await reg.readIndex();
    expect(index.bundles["tool.demo-fetch"]?.versions["0.1.0"]?.prunedAt).toBeTypeOf("string");
    expect(index.bundles["tool.demo-fetch"]?.active?.version).toBe("0.3.0");
    expect(index.bundles["tool.demo-fetch"]?.previous?.version).toBe("0.2.0");
    expect(existsSync(join(root, "modules", "installed", "tool.demo-fetch", "0.3.0"))).toBe(true);
    expect(await installer.pruneInstalled(new Date(Date.now() + 31 * 86_400_000), 30, "human")).toEqual([]);
    await rm(join(root, "modules", "registry.index.json"));
    expect((await reg.readIndex()).bundles["tool.demo-fetch"]?.versions["0.1.0"]?.prunedAt).toBeTypeOf("string");
  });

  it("账本层闸死非法清退：未废弃 / 在 previous 位 / 重复清退都拒", async () => {
    const reg = await threeVersions(); // active=0.3.0、previous=0.2.0、0.1.0 已掉出指针
    await expect(reg.recordPrune("tool.demo-fetch", "0.2.0", "human")).rejects.toThrow(/未废弃/);
    await reg.deprecate("tool.demo-fetch", "0.2.0", "human");
    await expect(reg.recordPrune("tool.demo-fetch", "0.2.0", "human")).rejects.toThrow(/active\/previous/);
    await reg.deprecate("tool.demo-fetch", "0.1.0", "human");
    await reg.recordPrune("tool.demo-fetch", "0.1.0", "human");
    await expect(reg.recordPrune("tool.demo-fetch", "0.1.0", "human")).rejects.toThrow(/已清退/);
  });
});
