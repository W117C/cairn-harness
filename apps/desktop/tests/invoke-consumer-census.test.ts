// invoke 通道的「消费面」人口普查（2026-10-23）。
//
// 既有 channels.test.ts 的 wired 守卫只查主进程 index.ts 里有没有一行 handler——那证明
// 「通道接得通」，不证明「有人调」。第 642 页点名的 createProject / cardAction 就是这种形状：
// 主进程齐全、渲染层零调用点，功能在 UI 上不可达。
// 本判卷扫渲染层源码，要求 INVOKE_CHANNELS 的每个键至少有一个 `<key>(` 调用点；
// 例外必须写进 ALLOW 并给出理由（目前只有 previewStop：它由主进程生成的预览页脚本调用）。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INVOKE_CHANNELS } from "../src/main/channels";

const ROOT = fileURLToPath(new URL("../src/renderer", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/u.test(p)) out.push(p);
  }
  return out;
}

describe("invoke 通道消费面：每个通道至少有一个渲染层调用点", () => {
  it("100 条通道全部有消费者；例外只有带理由的 allowlist", () => {
    const text = walk(ROOT).map((p) => readFileSync(p, "utf8")).join("\n");
    const allow = new Map<string, string>([
      // 预览页的「停止」由主进程生成的页面脚本调用（apps/desktop/src/main/index.ts 里那段
      // window.agent.previewStop(...)），不是渲染层代码。
      ["previewStop", "主进程生成的预览页脚本调用"],
    ]);
    const missing = Object.keys(INVOKE_CHANNELS).filter((key) => {
      if (allow.has(key)) return false;
      return !new RegExp(`\\b${key}\\s*\\(`, "u").test(text);
    });
    expect(missing, "没有渲染层消费者的 invoke 通道（主进程接了也没人调）").toEqual([]);
    // 反向：allowlist 不许空转——写进去的键必须真的没有渲染层调用点。
    const stale = [...allow.keys()].filter((key) => new RegExp(`\\b${key}\\s*\\(`, "u").test(text));
    expect(stale, "allowlist 里的通道已经有渲染层调用点，删掉这条豁免").toEqual([]);
  });
});
