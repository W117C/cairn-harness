// F2 余项（2026-11-12 评审；方向 2026-11-13 业主批修）：
// 显式 trustFile 解析后落在 workspace 里 = 项目可改写自己的信任表。
// 修法：PluginRuntime 装表前 fail loud 拒载。
import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginRuntime } from "../src/agent/plugins";

const opts = (dir: string, tf: string) => ({
  workspace: dir,
  home: dir,
  projectPluginsDir: join(dir, "plugins"),
  userPluginsDir: join(dir, "none"),
  projectSkillsDir: join(dir, "skills"),
  looseRoots: [],
  pluginDataRoot: join(dir, "data"),
  trustFile: tf,
});

const plugin = async (dir: string): Promise<void> => {
  await mkdir(join(dir, "plugins", "demo"), { recursive: true });
  await writeFile(join(dir, "plugins", "demo", "plugin.json"), JSON.stringify({ name: "demo", version: "1.0.0" }), "utf8");
};

describe("显式信任表文件不得落在项目控制目录内（F2 余项）", () => {
  it("trustFile 在工作区内 ⇒ fail loud 拒载", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dsh-trust-loc-"));
    try {
      await plugin(dir);
      await expect(
        PluginRuntime.load(opts(dir, join(dir, "trust.json"))),
      ).rejects.toThrow(/不能位于项目控制目录/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("对照：工作区外正常装载", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dsh-trust-loc-"));
    const out = await mkdtemp(join(tmpdir(), "dsh-trust-loc-out-"));
    try {
      await plugin(dir);
      const runtime = await PluginRuntime.load(opts(dir, join(out, "trust.json")));
      expect(runtime).toBeInstanceOf(PluginRuntime);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });
});
