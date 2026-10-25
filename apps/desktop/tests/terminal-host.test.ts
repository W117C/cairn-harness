// terminal 窗格宿主判卷（v5）：非 darwin fail-visible；darwin 真起 script(1) PTY 验证数据流。
// 真 spawn 只在 macOS 跑（CI ubuntu 走拒绝分支——两分支都判，不假装）。
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TerminalHost, type TerminalPush } from "../src/main/terminal-host";

const hosts: TerminalHost[] = [];
afterEach(() => { for (const h of hosts) h.killAll(); hosts.length = 0; });

function makeHost(): { host: TerminalHost; events: TerminalPush[] } {
  const events: TerminalPush[] = [];
  const host = new TerminalHost((e) => { events.push(e); });
  hosts.push(host);
  return { host, events };
}

const waitFor = async (cond: () => boolean, ms = 6000): Promise<boolean> => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return cond();
};

describe("TerminalHost", () => {
  it("非 darwin ⇒ 明确拒绝（不冒充可用）；write 未知 id ⇒ false", async () => {
    const { host } = makeHost();
    if (process.platform !== "darwin") {
      const r = await host.start(null);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("macOS");
    }
    expect(host.write("ghost", "x")).toBe(false);
  });

  it.runIf(process.platform === "darwin")("真起 PTY：echo 标记经推送回来；kill 后不再有输出", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cairn-term-"));
    const { host, events } = makeHost();
    const r = await host.start(dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(host.write(r.id, "echo CAIRN-TERM-MARKER-42\n")).toBe(true);
    const got = await waitFor(() => events.some((e) => e.kind === "data" && e.data.includes("CAIRN-TERM-MARKER-42")));
    expect(got).toBe(true);
    host.kill(r.id);
    const exited = await waitFor(() => events.some((e) => e.kind === "exit" && e.id === r.id));
    expect(exited).toBe(true);
    expect(host.write(r.id, "echo after-kill\n")).toBe(false); // 已摘表：fail-visible 不静默
  }, 15000);
});

describe("TerminalHost 启动失败（2026-10-19）", () => {
  it.runIf(process.platform === "darwin")("cwd 不存在 ⇒ 启动直接失败，不产生失联的终端 id", async () => {
    const { host, events } = makeHost();
    const r = await host.start("/definitely/not/a/real/dir-cairn-test");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("启动失败不应返回终端 id");
    expect(r.error).toContain("启动失败");
    expect(events).toEqual([]);
  }, 10000);
});
