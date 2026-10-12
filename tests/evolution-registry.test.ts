// SEMA Phase 0 判卷（docs/sema-proposal.md §9）：manifest 契约与模块注册表。
// 每条不变量配一条反向验证：未过门激活 / 越界 deps / 路径逃逸 / 重复注册 / 日志篡改，都必须当场红。
// 测试数据全部落 OS 临时目录（判卷纪律：测试数据绝不落工作区）。
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GATES } from "../scripts/gate-manifest";
import {
  BUNDLE_KINDS,
  BundleManifestError,
  isBundleId,
  isBundleVersion,
  parseBundleManifest,
} from "../src/main/evolution/manifest";
import {
  ModuleRegistry,
  RegistryLogCorruptError,
  RegistryStateError,
} from "../src/main/evolution/registry";

const GATE_SET = new Set(GATES);
const TOOL_GATES = ["typecheck", "tools-check"];

function manifestOf(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "tool.demo-fetch",
    version: "0.1.0",
    kind: "tool",
    entry: "index.ts",
    deps: ["src/tools/base"],
    permissions: ["net.fetch"],
    gates: TOOL_GATES,
    ...over,
  };
}

describe("CAP Bundle manifest 契约", () => {
  it("合法 tool manifest 全量通过并保留字段", () => {
    const m = parseBundleManifest(manifestOf(), GATE_SET);
    expect(m.id).toBe("tool.demo-fetch");
    expect(m.version).toBe("0.1.0");
    expect(m.entry).toBe("index.ts");
    expect(m.permissions).toEqual(["net.fetch"]);
    expect(m.gates).toEqual(TOOL_GATES);
  });

  it("id 前缀与 kind 不一致即红", () => {
    expect(() => parseBundleManifest(manifestOf({ id: "service.demo-fetch" }), GATE_SET)).toThrow(BundleManifestError);
  });

  it("version 不是 semver triple 即红（含前导零）", () => {
    expect(() => parseBundleManifest(manifestOf({ version: "0.1" }), GATE_SET)).toThrow(BundleManifestError);
    expect(() => parseBundleManifest(manifestOf({ version: "01.2.3" }), GATE_SET)).toThrow(BundleManifestError);
  });

  it("entry 禁绝对路径、..、反斜杠", () => {
    expect(() => parseBundleManifest(manifestOf({ entry: "/etc/passwd" }), GATE_SET)).toThrow(BundleManifestError);
    expect(() => parseBundleManifest(manifestOf({ entry: "../outside.ts" }), GATE_SET)).toThrow(BundleManifestError);
    expect(() => parseBundleManifest(manifestOf({ entry: "a\\b.ts" }), GATE_SET)).toThrow(BundleManifestError);
  });

  it("单向依赖的 schema 面：非桌面包 dep 伸进 apps/desktop 即红，桌面包 dep 出 apps/desktop 即红", () => {
    expect(() =>
      parseBundleManifest(manifestOf({ deps: ["apps/desktop/src/main/index.ts"] }), GATE_SET),
    ).toThrow(/apps\/desktop/);
    const panel = manifestOf({ id: "desktop-panel.cost-trend", kind: "desktop-panel", deps: ["apps/desktop/src/renderer/App.tsx"] });
    expect(parseBundleManifest(panel, GATE_SET).kind).toBe("desktop-panel");
    expect(() =>
      parseBundleManifest(manifestOf({ id: "desktop-panel.cost-trend", kind: "desktop-panel", deps: ["src/agent/loop.ts"] }), GATE_SET),
    ).toThrow(/apps\/desktop/);
  });

  it("dep 指向 node_modules 即红", () => {
    expect(() => parseBundleManifest(manifestOf({ deps: ["node_modules/vitest"] }), GATE_SET)).toThrow(/node_modules/);
  });

  it("gates 未知 / 为空 / 重复都红——门名单只认 GATES", () => {
    expect(() => parseBundleManifest(manifestOf({ gates: ["definitely-not-a-gate"] }), GATE_SET)).toThrow(/未知门/);
    expect(() => parseBundleManifest(manifestOf({ gates: [] }), GATE_SET)).toThrow(/gates/);
    expect(() => parseBundleManifest(manifestOf({ gates: ["typecheck", "typecheck"] }), GATE_SET)).toThrow(/重复/);
  });

  it("permissions 只查形状，成员裁决留给 Permission Broker", () => {
    expect(() => parseBundleManifest(manifestOf({ permissions: ["fetch"] }), GATE_SET)).toThrow(/permissions/);
    expect(parseBundleManifest(manifestOf({ permissions: ["shell.exec"] }), GATE_SET).permissions).toEqual(["shell.exec"]);
  });

  it("content-pack 可省 entry；tool 缺 entry 即红", () => {
    const pack = manifestOf({ id: "content-pack.prompt-core", kind: "content-pack" });
    delete pack.entry;
    expect(parseBundleManifest(pack, GATE_SET).entry).toBeUndefined();
    const tool = manifestOf();
    delete tool.entry;
    expect(() => parseBundleManifest(tool, GATE_SET)).toThrow(/entry/);
  });

  it("未知顶层字段 fail-closed（安全契约不认笔误）", () => {
    expect(() => parseBundleManifest(manifestOf({ autoGrant: true }), GATE_SET)).toThrow(/未知顶层字段/);
  });

  it("形状谓词与解析器同口径", () => {
    expect(isBundleId("tool.demo-fetch")).toBe(true);
    expect(isBundleId("tool.Bad_Name")).toBe(false);
    expect(isBundleVersion("0.3.0-beta.1")).toBe(true);
    expect(isBundleVersion("0.3")).toBe(false);
    expect(BUNDLE_KINDS).toContain("content-pack");
  });
});

describe("模块注册表（staging → 门 → 激活 → 回滚）", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sema-registry-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function registry(): ModuleRegistry {
    return new ModuleRegistry(root, { knownGates: GATE_SET });
  }

  async function stage(id: string, version: string, over: Record<string, unknown> = {}): Promise<void> {
    const dir = join(root, "modules", "staging", id, version);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "manifest.json"),
      JSON.stringify(manifestOf({ id, version, kind: id.split(".")[0], ...over })),
      "utf8",
    );
  }

  async function passAll(reg: ModuleRegistry, id: string, version: string, gates: readonly string[]): Promise<void> {
    for (const gate of gates) await reg.recordGate(id, version, gate, true, "gate-runner");
  }

  it("注册 → 全门通过 → 激活的正向链路", async () => {
    await stage("tool.demo-fetch", "0.1.0");
    const reg = registry();
    await reg.registerStaged("tool.demo-fetch", "0.1.0", "evo-pipeline");
    await passAll(reg, "tool.demo-fetch", "0.1.0", TOOL_GATES);
    const entry = await reg.activate("tool.demo-fetch", "0.1.0", "human-approval");
    expect(entry.active?.version).toBe("0.1.0");
    expect(entry.versions["0.1.0"]?.gates).toEqual({ typecheck: "pass", "tools-check": "pass" });
  });

  it("反向验证：门没过完就激活 → 红（验证先行不是口号）", async () => {
    await stage("tool.demo-fetch", "0.1.0");
    const reg = registry();
    await reg.registerStaged("tool.demo-fetch", "0.1.0", "evo-pipeline");
    await reg.recordGate("tool.demo-fetch", "0.1.0", "typecheck", true, "gate-runner");
    await expect(reg.activate("tool.demo-fetch", "0.1.0", "human")).rejects.toThrow(RegistryStateError);
  });

  it("同一道门先 fail 后 pass 以最后一条为准；只 fail 不可激活", async () => {
    await stage("tool.demo-fetch", "0.1.0");
    const reg = registry();
    await reg.registerStaged("tool.demo-fetch", "0.1.0", "evo-pipeline");
    await reg.recordGate("tool.demo-fetch", "0.1.0", "typecheck", false, "gate-runner", "TS2322");
    await reg.recordGate("tool.demo-fetch", "0.1.0", "tools-check", false, "gate-runner");
    await expect(reg.activate("tool.demo-fetch", "0.1.0", "human")).rejects.toThrow(/未过闸门/);
    await passAll(reg, "tool.demo-fetch", "0.1.0", TOOL_GATES);
    const entry = await reg.activate("tool.demo-fetch", "0.1.0", "human");
    expect(entry.active?.version).toBe("0.1.0");
  });

  it("recordGate 只认注册时声明过的门", async () => {
    await stage("tool.demo-fetch", "0.1.0");
    const reg = registry();
    await reg.registerStaged("tool.demo-fetch", "0.1.0", "evo-pipeline");
    await expect(reg.recordGate("tool.demo-fetch", "0.1.0", "docs-check", true, "gate-runner")).rejects.toThrow(/未声明门/);
  });

  it("同一 (id, version) 只注册一次；staging 缺 manifest、路径与身份不符都红", async () => {
    await stage("tool.demo-fetch", "0.1.0");
    const reg = registry();
    await reg.registerStaged("tool.demo-fetch", "0.1.0", "evo-pipeline");
    await expect(reg.registerStaged("tool.demo-fetch", "0.1.0", "evo-pipeline")).rejects.toThrow(/重复注册/);
    await expect(reg.registerStaged("tool.ghost", "0.1.0", "evo-pipeline")).rejects.toThrow(/manifest.json/);
    await stage("tool.mismatch", "0.2.0", { version: "9.9.9" });
    await expect(reg.registerStaged("tool.mismatch", "0.2.0", "evo-pipeline")).rejects.toThrow(/身份不一致/);
  });

  it("id/version 拼进 staging 路径前先过形状闸（路径安全）", async () => {
    const reg = registry();
    await expect(reg.registerStaged("../escape", "0.1.0", "evo-pipeline")).rejects.toThrow(/id 非法/);
    expect(() => reg.stagingDir("tool.x", "../../1.0.0")).toThrow(/version 非法/);
  });

  it("rollback = active/previous 对换；来回滚两次回到原位", async () => {
    await stage("tool.demo-fetch", "0.1.0");
    await stage("tool.demo-fetch", "0.2.0");
    const reg = registry();
    await reg.registerStaged("tool.demo-fetch", "0.1.0", "evo-pipeline");
    await reg.registerStaged("tool.demo-fetch", "0.2.0", "evo-pipeline");
    await passAll(reg, "tool.demo-fetch", "0.1.0", TOOL_GATES);
    await passAll(reg, "tool.demo-fetch", "0.2.0", TOOL_GATES);
    await reg.activate("tool.demo-fetch", "0.1.0", "human");
    await reg.activate("tool.demo-fetch", "0.2.0", "human");
    expect((await reg.rollback("tool.demo-fetch", "human")).active?.version).toBe("0.1.0");
    expect((await reg.rollback("tool.demo-fetch", "human")).active?.version).toBe("0.2.0");
  });

  it("没有 previous 时回滚即红", async () => {
    await stage("tool.demo-fetch", "0.1.0");
    const reg = registry();
    await reg.registerStaged("tool.demo-fetch", "0.1.0", "evo-pipeline");
    await passAll(reg, "tool.demo-fetch", "0.1.0", TOOL_GATES);
    await reg.activate("tool.demo-fetch", "0.1.0", "human");
    await expect(reg.rollback("tool.demo-fetch", "human")).rejects.toThrow(/无从回滚/);
  });

  it("deprecate 不许落在激活位上；已废弃版本不得激活", async () => {
    await stage("tool.demo-fetch", "0.1.0");
    await stage("tool.demo-fetch", "0.2.0");
    const reg = registry();
    await reg.registerStaged("tool.demo-fetch", "0.1.0", "evo-pipeline");
    await reg.registerStaged("tool.demo-fetch", "0.2.0", "evo-pipeline");
    await passAll(reg, "tool.demo-fetch", "0.1.0", TOOL_GATES);
    await passAll(reg, "tool.demo-fetch", "0.2.0", TOOL_GATES);
    await reg.activate("tool.demo-fetch", "0.1.0", "human");
    await expect(reg.deprecate("tool.demo-fetch", "0.1.0", "human")).rejects.toThrow(/激活位/);
    await reg.deprecate("tool.demo-fetch", "0.2.0", "human");
    await expect(reg.activate("tool.demo-fetch", "0.2.0", "human")).rejects.toThrow(/已废弃/);
  });

  it("同一版本重复激活即红", async () => {
    await stage("tool.demo-fetch", "0.1.0");
    const reg = registry();
    await reg.registerStaged("tool.demo-fetch", "0.1.0", "evo-pipeline");
    await passAll(reg, "tool.demo-fetch", "0.1.0", TOOL_GATES);
    await reg.activate("tool.demo-fetch", "0.1.0", "human");
    await expect(reg.activate("tool.demo-fetch", "0.1.0", "human")).rejects.toThrow(/已处于激活位/);
  });

  it("淘汰候选按废弃龄筛出", async () => {
    await stage("tool.demo-fetch", "0.2.0");
    const reg = registry();
    await reg.registerStaged("tool.demo-fetch", "0.2.0", "evo-pipeline");
    await reg.deprecate("tool.demo-fetch", "0.2.0", "human");
    expect(await reg.pruneCandidates(new Date(), 30)).toEqual([]);
    const monthLater = new Date(Date.now() + 31 * 86_400_000);
    expect(await reg.pruneCandidates(monthLater, 30)).toEqual([
      { id: "tool.demo-fetch", version: "0.2.0", deprecatedAt: expect.any(String) },
    ]);
  });

  it("索引丢失或损坏都从日志重建，账目等价", async () => {
    await stage("tool.demo-fetch", "0.1.0");
    const reg = registry();
    await reg.registerStaged("tool.demo-fetch", "0.1.0", "evo-pipeline");
    await passAll(reg, "tool.demo-fetch", "0.1.0", TOOL_GATES);
    await reg.activate("tool.demo-fetch", "0.1.0", "human");
    await rm(join(root, "modules", "registry.index.json"));
    const rebuilt = await reg.readIndex();
    expect(rebuilt.bundles["tool.demo-fetch"]?.active?.version).toBe("0.1.0");
    await writeFile(join(root, "modules", "registry.index.json"), "{broken", "utf8");
    expect((await reg.readIndex()).bundles["tool.demo-fetch"]?.active?.version).toBe("0.1.0");
  });

  it("反向验证：坏行日志拒绝重建（宁空转不拿错账）", async () => {
    await stage("tool.demo-fetch", "0.1.0");
    const reg = registry();
    await reg.registerStaged("tool.demo-fetch", "0.1.0", "evo-pipeline");
    await appendFile(join(root, "modules", "registry.jsonl"), "{oops\n", "utf8");
    await expect(reg.rebuildIndex()).rejects.toThrow(RegistryLogCorruptError);
  });

  it("反向验证：篡改日志（未过门就写入 activate）在重建时红", async () => {
    await stage("tool.demo-fetch", "0.1.0");
    const reg = registry();
    await reg.registerStaged("tool.demo-fetch", "0.1.0", "evo-pipeline");
    const forged = JSON.stringify({
      op: "activate",
      ts: new Date().toISOString(),
      id: "tool.demo-fetch",
      version: "0.1.0",
      actor: "forger",
    });
    await appendFile(join(root, "modules", "registry.jsonl"), forged + "\n", "utf8");
    await expect(reg.rebuildIndex()).rejects.toThrow(/未过闸门/);
  });

  it("反向验证：id/kind 不一致的注册事件在重放时红（复用 manifest 契约，不给重放面留第二种口径）", async () => {
    const reg = registry();
    const forged = JSON.stringify({
      op: "register",
      ts: new Date().toISOString(),
      id: "tool.demo-fetch",
      version: "0.1.0",
      kind: "service",
      permissions: [],
      gates: TOOL_GATES,
      actor: "forger",
    });
    await mkdir(join(root, "modules"), { recursive: true });
    await appendFile(join(root, "modules", "registry.jsonl"), forged + "\n", "utf8");
    await expect(reg.rebuildIndex()).rejects.toThrow(/不一致|kind/);
  });

  it("寄存 register 事件的凭据字段在重放时复用 manifest 契约校验", async () => {
    const reg = registry();
    const forged = JSON.stringify({
      op: "register",
      ts: new Date().toISOString(),
      id: "tool.demo-fetch",
      version: "0.1.0",
      kind: "tool",
      permissions: [],
      gates: ["definitely-not-a-gate"],
      actor: "forger",
    });
    await mkdir(join(root, "modules"), { recursive: true });
    await appendFile(join(root, "modules", "registry.jsonl"), forged + "\n", "utf8");
    await expect(reg.rebuildIndex()).rejects.toThrow(RegistryLogCorruptError);
  });
});
