// LSP 运行态落盘 + 存活判定（第 996 页）。
// 第 995 页的状态面有个明说过的边界：`adoptedCaps / brokenNotes / clients` 是本进程内存 ⇒
// 换进程读同一份工作区只会看到「没起过」，业主拿不到"agent 那边到底起没起、崩没崩"。
// 本批把运行态抄到**用户级目录**（绝不写工作区：clone 携带的状态文件等于让仓库伪造"服务器健康"），
// 读的时候按写方进程存活判定分三档：现值 / 陈旧 / 判不出来。
// 跨进程那一面这样验：起过服务器 → 落盘 → `closeAllLspClients()`（清空本进程事实）→ 再读，
// 读到的就只能来自盘上。不需要为判卷开一个"假装是别的进程"的开关。
import { existsSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeAllLspClients,
  formatLspStatus,
  lsp,
  lspRuntimeStatePath,
  lspServerStatus,
  persistLspRuntimeState,
  setLspTrustedRepos,
} from "../src/tools/lsp";
import type { ProcessLiveness } from "../src/process-liveness";
import type { ToolContext } from "../src/tools";

const STUB = fileURLToPath(new URL("../fixtures/lsp/stub-server.mjs", import.meta.url));
let ws = "";
const savedHome = process.env.CAIRN_LSP_HOME;

afterEach(async () => {
  await closeAllLspClients();
  setLspTrustedRepos([]);
  if (ws) await rm(ws, { recursive: true, force: true });
  ws = "";
  if (savedHome === undefined) delete process.env.CAIRN_LSP_HOME;
  else process.env.CAIRN_LSP_HOME = savedHome;
});

async function newWs(): Promise<ToolContext> {
  ws = await mkdtemp(join(tmpdir(), "lsp-rstate-"));
  await mkdir(join(ws, ".agent"), { recursive: true });
  await mkdir(join(ws, "src"), { recursive: true });
  await writeFile(join(ws, ".agent", "lsp.json"), JSON.stringify({
    lsp: { stub: { command: "node", args: [STUB], extensions: [".ts"] } },
  }), "utf8");
  await writeFile(join(ws, "src", "sample.ts"), "SYM(alpha) one\n", "utf8");
  setLspTrustedRepos([ws]);
  return { workspace: ws };
}

/** 把落盘目录指到 tmp：判卷不许写真人家目录（`tests/vitest.config.ts` 里同一道隔离）。 */
async function isolateHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "lsp-rstate-home-"));
  process.env.CAIRN_LSP_HOME = home;
  return home;
}

const live = (v: ProcessLiveness) => ({ liveness: () => v });

/** 尽力而为的异步落盘：轮询到出现为止（3s 封顶），超时即失败——不许用固定 sleep 蒙时限。 */
async function waitExists(p: string, ms = 3000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (existsSync(p)) return true;
    await new Promise((r) => setTimeout(r, 30));
  }
  return existsSync(p);
}

/** 起过服务器 + 落盘，然后把本进程事实清空：之后读到的只能来自盘上。 */
async function seededThenCleared(ctx: ToolContext): Promise<void> {
  await lsp.run({ operation: "documentSymbol", path: "src/sample.ts" }, ctx);
  expect(await persistLspRuntimeState(ws)).toBe("written");
  await closeAllLspClients();
}

describe("LSP 运行态落盘", () => {
  it("没起过的服务器：状态是 not-started，provider 缺格（第 995 页口径不因本批而退化）", async () => {
    await isolateHome();
    const ctx = await newWs();
    const st = await lspServerStatus(ws);
    expect(st.servers[0]?.state).toBe("not-started");
    expect(st.servers[0]?.providers).toBeUndefined();
    expect(st.servers[0]?.source).toBeUndefined(); // 盘上什么都没有，就不编一个来源出来
  });

  it("本进程实测时优先用自己的事实，且**自动**落盘（不自动就永远没有跨进程可见性）", async () => {
    await isolateHome();
    const ctx = await newWs();
    await lsp.run({ operation: "documentSymbol", path: "src/sample.ts" }, ctx);
    const st = await lspServerStatus(ws);
    expect(st.servers[0]?.source).toBe("in-process");
    expect(st.servers[0]?.providers).toEqual(expect.arrayContaining(["documentSymbolProvider", "hoverProvider"]));
    // 落盘是尽力而为的异步动作，等它出现（不是等返回值）：agent 侧不该为一条状态记录被卡住
    expect(await waitExists(lspRuntimeStatePath(ws))).toBe(true);
  });

  it("另一个进程（写方进程仍活着）读盘 ⇒ 拿到实测 provider，并说清是谁实测的", async () => {
    await isolateHome();
    const ctx = await newWs();
    await seededThenCleared(ctx);
    const st = await lspServerStatus(ws, live("alive"));
    const entry = st.servers.find((s) => s.id === "stub");
    expect(entry?.source).toBe("disk-alive");
    expect(entry?.providers).toEqual(expect.arrayContaining(["documentSymbolProvider", "hoverProvider"]));
    expect(formatLspStatus(st)).toMatch(/pid \d+ 实测/);
  });

  it("写方进程已不在 ⇒ 这条必须自称陈旧，不许当现值报", async () => {
    await isolateHome();
    const ctx = await newWs();
    await seededThenCleared(ctx);
    const st = await lspServerStatus(ws, live("dead"));
    expect(st.servers.find((s) => s.id === "stub")?.source).toBe("disk-stale");
    expect(formatLspStatus(st)).toMatch(/已不在|陈旧/);
  });

  it("探活判不出来 ⇒ 说「判不出来」，不许猜成活的了结（这一档就是假绿灯的入口）", async () => {
    await isolateHome();
    const ctx = await newWs();
    await seededThenCleared(ctx);
    const st = await lspServerStatus(ws, live("unknown"));
    expect(st.servers.find((s) => s.id === "stub")?.source).toBe("disk-unknown");
    expect(formatLspStatus(st)).toContain("判不出来");
  });

  it("落盘目录落在工作区里 ⇒ 一条都不写（clone 携带的状态＝仓库自报健康）", async () => {
    await newWs();
    process.env.CAIRN_LSP_HOME = join(ws, ".agent", "lsp-runtime");
    const ctx: ToolContext = { workspace: ws };
    await lsp.run({ operation: "documentSymbol", path: "src/sample.ts" }, ctx);
    const before = readdirSync(ws);
    expect(await persistLspRuntimeState(ws)).toBe("refused-inside-workspace");
    expect(readdirSync(ws).filter((f) => !before.includes(f))).toEqual([]);
    expect(readdirSync(join(ws, ".agent")).some((f) => f === "lsp-runtime")).toBe(false);
  });

  it("盘上那条写着**别的工作区** ⇒ 一律不当数（哈希撞了或树被搬走时不许串号）", async () => {
    await isolateHome();
    const ctx = await newWs();
    await seededThenCleared(ctx);
    const source = lspRuntimeStatePath(ws);
    const other = await mkdtemp(join(tmpdir(), "lsp-rstate-other-"));
    try {
      await mkdir(join(other, ".agent"), { recursive: true });
      // 同一台服务器名、同一套配置：唯一不同的是工作区路径——而盘上那份写着原来的 workspace
      await writeFile(join(other, ".agent", "lsp.json"), JSON.stringify({
        lsp: { stub: { command: "node", args: [STUB], extensions: [".ts"] } },
      }), "utf8");
      await writeFile(lspRuntimeStatePath(other), await readFile(source, "utf8"), "utf8");
      const st = await lspServerStatus(other, live("alive"));
      expect(st.servers.find((s) => s.id === "stub")?.source).toBeUndefined();
      expect(st.servers.find((s) => s.id === "stub")?.providers).toBeUndefined();
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("写失败不影响 agent：返回 failed，状态面照样读得出", async () => {
    const ctx = await newWs();
    const blocker = join(tmpdir(), "lsp-rstate-blocker-" + String(Date.now()));
    await writeFile(blocker, "x", "utf8");
    process.env.CAIRN_LSP_HOME = blocker; // 一个文件占了目录的位置 ⇒ mkdir/write 必失败
    await lsp.run({ operation: "documentSymbol", path: "src/sample.ts" }, ctx);
    expect(await persistLspRuntimeState(ws)).toBe("failed");
    const st = await lspServerStatus(ws);
    expect(st.servers.map((s) => s.id)).toEqual(["stub"]);
    await rm(blocker, { force: true });
  });

  it("没有实测事实就不落空文件（空记录会被下一次读成「这台什么都不支持」）", async () => {
    await isolateHome();
    await newWs();
    expect(await persistLspRuntimeState(ws)).toBe("nothing");
    expect(existsSync(lspRuntimeStatePath(ws))).toBe(false);
    expect(resolve(ws).length).toBeGreaterThan(0);
  });

  /* 同机两个 agent（桌面双窗口 / CLI + 桌面）开同一个工作区：后写的**不许**把前者的活记录抹掉。
   * 整份覆盖等于"对方的服务器从状态面上消失"——正是本批要消灭的那件事，只是换了个方向。 */
  async function twoServerWs(): Promise<ToolContext> {
    ws = await mkdtemp(join(tmpdir(), "lsp-rstate-two-"));
    await mkdir(join(ws, ".agent"), { recursive: true });
    await mkdir(join(ws, "src"), { recursive: true });
    await writeFile(join(ws, ".agent", "lsp.json"), JSON.stringify({
      lsp: {
        a: { command: "node", args: [STUB], extensions: [".ts"] },
        b: { command: "node", args: [STUB], extensions: [".js"] },
      },
    }), "utf8");
    await writeFile(join(ws, "src", "sample.ts"), "SYM(alpha) one\n", "utf8");
    setLspTrustedRepos([ws]);
    return { workspace: ws };
  }

  /** 模拟"另一个进程已经写过 b 的记录"。pid 用**真活着的**子进程（真探活会去看它），
   *  这样自动落盘那条路径（不注入探活）也认它是活的——不然测的就只是注入的假象。 */
  async function seedForeignRecord(serverId: string, writerPid: number): Promise<void> {
    await writeFile(lspRuntimeStatePath(ws), JSON.stringify({
      workspace: resolve(ws),
      records: [{ serverId, command: "node", providers: ["hoverProvider"], sync: "full", observedAt: 1, writerPid }],
    }), "utf8");
  }

  function spawnAlive(): { pid: number; stop: () => void } {
    const child = spawn("node", ["-e", "setTimeout(() => process.exit(0), 60000)"], { stdio: "ignore" });
    return { pid: child.pid as number, stop: () => { child.kill("SIGKILL"); } };
  }

  async function pidOfDeadChild(): Promise<number> {
    const child = spawn("node", ["-e", "process.exit(0)"], { stdio: "ignore" });
    const pid = child.pid as number;
    await new Promise<void>((r) => child.on("exit", () => r()));
    return pid;
  }

  it("别的活进程的记录被**合并**保留，不是整份覆盖", async () => {
    await isolateHome();
    const ctx = await twoServerWs();
    const other = spawnAlive();
    try {
      await seedForeignRecord("b", other.pid);
      await lsp.run({ operation: "documentSymbol", path: "src/sample.ts" }, ctx); // 本进程起了 a
      expect(await persistLspRuntimeState(ws)).toBe("written");
      const st = await lspServerStatus(ws);
      const ids = Object.fromEntries(st.servers.map((s) => [s.id, s]));
      expect(ids.a?.source).toBe("in-process");
      expect(ids.b?.source).toBe("disk-alive"); // 覆盖写法下这一格会退回 not-started＝对方的服务器消失了
      expect(ids.b?.providers).toEqual(["hoverProvider"]);
    } finally {
      other.stop();
    }
  });

  it("写方已不在的那条被清掉（合并不是把垃圾永久留在盘上）", async () => {
    await isolateHome();
    const ctx = await twoServerWs();
    const dead = await pidOfDeadChild();
    await seedForeignRecord("b", dead);
    await lsp.run({ operation: "documentSymbol", path: "src/sample.ts" }, ctx);
    expect(await persistLspRuntimeState(ws)).toBe("written");
    const st = await lspServerStatus(ws);
    const b = st.servers.find((s) => s.id === "b");
    expect(b?.source).toBeUndefined();
    expect(b?.providers).toBeUndefined();
  });
});
