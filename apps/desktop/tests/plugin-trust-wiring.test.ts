// 技能信任链路的三处接线（2026-10-18 真机抓到的三个「静默失效」）：
//   ① 设置页的开关传的是 name 不是 invoke（/demo 在 trustDecide 里永远找不到目标）；
//   ② 插件面板快照按工作区缓存（在 A 项目的空快照不许让 B 项目显示「还没有技能」）；
//   ③ 信任决议后斜杠菜单要刷新（设置关闭时重取，否则一直标「待批准」）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("技能信任接线", () => {
  it("设置页开关传 name（不是 invoke）", () => {
    const pane = read("../src/renderer/components/AppPage.tsx");
    expect(pane).toContain("window.agent.pluginDecide(selected.name, next)");
    expect(pane).not.toContain("pluginDecide(selected.invoke");
  });

  it("主进程 decide 收工作区参数；快照按工作区缓存并在决议后作废", () => {
    const sh = read("../../../src/main/state-handlers.ts");
    expect(sh).toContain("handlePluginDecide(pluginName: string, trusted: boolean, workspaceOverride: string | null = null)");
    expect(sh).toContain("pluginSnapshotWorkspace === ws");
    expect(sh).toContain("if (pluginSnapshotWorkspace === ws) pluginSnapshot = null");
    expect(read("../../../src/main/ipc-protocol.ts")).toContain("pluginDecide(plugin: string, trusted: boolean, workspace?: string)");
    expect(read("../src/main/index.ts")).toContain("handlePluginDecide(plugin as string, trusted as boolean, String(workspace ?? \"\") || workspaceContext)");
  });

  it("run 收束时快照带上 run 的工作区", () => {
    expect(read("../../../src/main/agent-runner.ts")).toContain("setPluginSnapshot(rtNow.snapshot(), getLastWorkspace())");
  });

  it("技能抽屉按名字读正文，不再摆「待接」", () => {
    const pane = read("../src/renderer/components/AppPage.tsx");
    expect(pane).toContain("window.agent.skillBody(selectedName)");
    expect(pane).toContain('className="skill-body"');
    expect(pane).not.toContain("快照不含正文");
    expect(read("../src/renderer/styles.css")).toMatch(/\.skill-body\s*{/);
    expect(read("../../../src/main/ipc-protocol.ts")).toContain("skillBody(name: string, workspace?: string)");
    expect(read("../src/main/channels.ts")).toContain('skillBody: "agent:skill-body"');
  });

  it("插件技能行可读正文（按 /plugin:skill 拉，展开/收起）", () => {
    const pane = read("../src/renderer/components/AppPage.tsx");
    expect(pane).toContain("window.agent.skillBody(invoke)");
    expect(pane).toContain('className="plugin-skill"');
    expect(pane).toContain("读正文");
    expect(read("../src/renderer/styles.css")).toMatch(/\.plugin-skill \.skill-body/);
  });

  it("插件命令与技能同进斜杠补全", () => {
    expect(read("../src/renderer/App.tsx")).toContain("setSkills([...r.skills, ...r.commands])");
    expect(read("../../../src/main/state-handlers.ts")).toContain("commands: snap.plugins.flatMap((p) => p.commands");
  });

  it("设置关闭后刷新斜杠技能清单", () => {
    const app = read("../src/renderer/App.tsx");
    expect(app).toContain("if (settingsOpen) return;");
    expect(app).toContain("}, [activeWorkspace, settingsOpen]);");
  });
});
