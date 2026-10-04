// P0-b：`scripts/prompt-cost.ts` 的「含插件真实面」口径。
//
// 钉三件事，每一件都对应一个已经犯过或差点犯的错：
//  ① 不传 `--plugin-tools` 时输出**逐字不变**（零回归支；P0-b 是加能力，不是换尺子）。
//  ② 传了就把插件件真算进去，并且**明说这次含不含插件**——「含插件读数」与「首方读数」
//     混读会得出「工具面已越线」的错误结论（2026-10-03 我就是这么读错 App 的数据的）。
//  ③ 插件发现入口按 `M2B_WORKSPACE ?? cwd` 取根，不是 `PI_SCRATCH_DIR`（第一版取错根，
//     把不存在的目录报成「12 个条目」，而且不报错）。
//
// 真跑脚本（spawn 子进程）而不是 import：`scripts/prompt-cost.ts` 顶层直接 `await main()`，
// import 就会执行一次 main——测的就不是 CLI 行为而是 import 副作用了。
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const SCRIPT = join(ROOT, "scripts", "prompt-cost.ts");

let dir: string | null = null;
afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; } });

function run(args: string[], env: NodeJS.ProcessEnv = {}): { out: string; code: number } {
  const r = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, ...args], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env },
  });
  return { out: (r.stdout ?? "") + (r.stderr ?? ""), code: r.status ?? -1 };
}

describe("prompt-cost 的含插件口径", () => {
  it("① 不传 --plugin-tools：读数逐字不变，且明说不含插件", () => {
    const before = run([]).out;
    const after = run(["--json"]).out;            // 形状不同不比；同形状比两次空跑
    const again = run([]).out;
    expect(again).toBe(before);                    // 同一命令两次必须逐字相同（无隐藏随机/时间）
    expect(before).not.toBe(after);
    expect(before).toContain("本次测量**不含任何插件工具**");
  });

  it("② 传 --plugin-tools：插件件进面，且输出明说含了几件", () => {
    dir = mkdtempSync(join(tmpdir(), "pc-face-"));
    const face = join(dir, "face.json");
    writeFileSync(face, JSON.stringify([
      { name: "mcp__x__a", description: "做 A。", parameters: { type: "object", properties: {} } },
      { name: "mcp__x__b", description: "做 B。", parameters: { type: "object", properties: {} } },
    ], null, 2), "utf8");

    const plain = run(["--json"]);
    const withFace = run(["--json", "--plugin-tools", face]);
    expect(withFace.code).toBe(0);
    const a = JSON.parse(plain.out) as { pluginToolsIn: number; full: { mode: string; tools: number }[] };
    const b = JSON.parse(withFace.out) as { pluginToolsIn: number; full: { mode: string; tools: number }[] };
    expect(a.pluginToolsIn).toBe(0);
    expect(b.pluginToolsIn).toBe(2);
    const defA = a.full.find((f) => f.mode === "default")!;
    const defB = b.full.find((f) => f.mode === "default")!;
    expect(defB.tools).toBe(defA.tools + 2);       // 两件插件工具真的进了面
    expect(run(["--plugin-tools", face]).out).toContain("本次测量**含 2 件插件/MCP 工具**");
  });

  it("③ 插件根按 M2B_WORKSPACE 取；空工作区报「不存在」而不是瞎报条目数", () => {
    dir = mkdtempSync(join(tmpdir(), "pc-ws-"));
    const out = run([], { M2B_WORKSPACE: dir, M2E_USER_PLUGINS: "", M2E_LOOSE_SKILLS: "" }).out;
    // 这个工作区里没有 .agent/plugins —— 第一版按 PI_SCRATCH_DIR 取根，会误报成「有 N 个条目」。
    expect(out).toContain("<workspace>/.agent/plugins  不存在");
    expect(out).not.toMatch(/\.agent\/plugins\s+\d+ 个条目/);
  });

  it("③b 真有插件目录时条目数读得出来（不是恒报「不存在」）", () => {
    dir = mkdtempSync(join(tmpdir(), "pc-ws2-"));
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(join(dir, ".agent", "plugins", "demo"), { recursive: true });
    const out = run([], { M2B_WORKSPACE: dir, M2E_USER_PLUGINS: "", M2E_LOOSE_SKILLS: "" }).out;
    expect(out).toMatch(/\.agent\/plugins\s+1 个条目/);
  });

  it("④ 坏文件：不吞错，退出码 2 且说清缺什么", () => {
    dir = mkdtempSync(join(tmpdir(), "pc-bad-"));
    const r = run(["--plugin-tools", join(dir, "nope.json")]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("读插件面失败");
    const noArg = run(["--plugin-tools"]);
    expect(noArg.code).toBe(2);
    expect(noArg.out).toContain("需要一个 JSON 文件路径");
  });
});