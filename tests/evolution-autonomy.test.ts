// 闭环 v2 批次 C1 判卷：自治分级（fail-closed 缺省 + 资格裁决矩阵）。
// 反向验证：文件缺失/坏档 ⇒ manual（自治是显式开出来的）、manual 永不自动、带权/tool 永不自动。
import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autonomyPathFor, autoInstallEligible, loadAutonomy } from "../src/main/evolution/autonomy";

describe("autonomy loadAutonomy（fail-closed）", () => {
  it("文件缺失 ⇒ manual（首启正常静默）", async () => {
    const root = await mkdtemp(join(tmpdir(), "autonomy-"));
    try {
      expect((await loadAutonomy(root)).tier).toBe("manual");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("坏 JSON / tier 不在取值域 ⇒ manual 且出声（不许静默维持某个档）", async () => {
    const root = await mkdtemp(join(tmpdir(), "autonomy-"));
    try {
      await mkdir(join(root, "modules"), { recursive: true });
      const said: string[] = [];
      const onCorrupt = (reason: string): void => { said.push(reason); };
      await writeFile(autonomyPathFor(root), "{broken", "utf8");
      expect((await loadAutonomy(root, onCorrupt)).tier).toBe("manual");
      await writeFile(autonomyPathFor(root), JSON.stringify({ tier: "yolo" }), "utf8");
      expect((await loadAutonomy(root, onCorrupt)).tier).toBe("manual");
      expect(said.length).toBe(2);
      expect(said.every((s): boolean => s.includes("manual"))).toBe(true);
      // 坏文件的承诺是 fail-closed 到 manual 且说清原因；这句原话要有观测者。
      expect(said.every((s): boolean => s.includes("自治档位文件读不动"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("gated-auto 显式写盘才读得出来", async () => {
    const root = await mkdtemp(join(tmpdir(), "autonomy-"));
    try {
      await mkdir(join(root, "modules"), { recursive: true });
      await writeFile(autonomyPathFor(root), JSON.stringify({ tier: "gated-auto" }), "utf8");
      expect((await loadAutonomy(root)).tier).toBe("gated-auto");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("autonomy autoInstallEligible（资格矩阵）", () => {
  const contentPack = { kind: "content-pack" as const, permissions: [] };
  const toolPack = { kind: "tool" as const, permissions: [] };
  const grantedPack = { kind: "content-pack" as const, permissions: ["net.fetch"] };

  it("manual 档：零权限 content-pack 也不自动（Phase 2 的 v1 行为）", () => {
    expect(autoInstallEligible(contentPack, "manual").eligible).toBe(false);
  });

  it("gated-auto：只有零权限 content-pack 过；tool 与带权包仍全量人工", () => {
    expect(autoInstallEligible(contentPack, "gated-auto").eligible).toBe(true);
    expect(autoInstallEligible(toolPack, "gated-auto").eligible).toBe(false);
    expect(autoInstallEligible(grantedPack, "gated-auto").eligible).toBe(false);
    expect(autoInstallEligible(grantedPack, "gated-auto").reason).toContain("net.fetch");
  });
});
