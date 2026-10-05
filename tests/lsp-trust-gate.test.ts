// #58 第二半的判卷：`.agent/lsp.json` 的 `command` 进**内容指纹信任门**。
//
// 上一笔（`tests/lsp-permission-gate.test.ts`，`fb76517e`）钉的是**权限门**那一层：
// 风险定级 high ＋ gatedTool 包装，堵「模型自己动手改那份配置」与「每次调用都出卡」。
// **它堵不住克隆即携带**：模型根本不用动手，配置跟着 clone 一起到，任何一次 lsp 调用就按它起进程。
// 本支钉的就是那一格，且**不复述**上一支的任何断言（两支问的是两件事）。
//
// 三条口径（与插件门同源，不重抄）：
// ① 未授权 ⇒ **不起进程**（不是「起了再拦」）——断言要落在"spawn 没发生"这件事上，
//    所以这里用一条会留下痕迹的假命令：真起进程就会写出那个文件。
// ② 授权后按**内容指纹**记住 ⇒ 同一份内容第二次不再问（首次经审批卡问人，之后免批）。
// ③ 内容变了 ⇒ 重新问（这正是要拦的那件事：换了 command 还沿用旧授权）。
import { describe, expect, it, afterAll, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decideLspConfigTrust,
  getLspClient,
  lspConfigTrustState,
  loadLspConfig,
  setLspTrustFile,
  type LspConfig,
} from "../src/tools/lsp";

const dirs: string[] = [];
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), "lsp-trust-"));
  dirs.push(d);
  return d;
};
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
afterEach(() => { setLspTrustFile(null); });

/** 一支带 `.agent/lsp.json` 的工作区。`command` 指向会留下痕迹的假服务器：
 *  真被 spawn 就会写出 `spawned-marker`。用它把「有没有起进程」变成可读的文件事实，而不是靠 mock。 */
function repoWithLsp(command: string, marker = "spawned-marker"): string {
  const root = scratch();
  mkdirSync(join(root, ".agent"), { recursive: true });
  writeFileSync(join(root, ".agent", "lsp.json"), JSON.stringify({
    lsp: { demo: { command, args: [marker], extensions: [".ts"] } },
  }));
  return root;
}

const cfgOf = (root: string): LspConfig => loadLspConfig(root);

describe("① 克隆即携带：未授权 ⇒ 不起进程（这一格是 #58 第二半的全部要点）", () => {
  it("工作区自带 lsp.json + 从未授权 ⇒ 报错点名，且 spawn 没发生", async () => {
    const root = repoWithLsp(join(tmpdir(), "dsh-no-such-lsp-server"));
    const cfg = cfgOf(root);
    expect(cfg.enabled, "配置本身要能读出来，否则这一格测的是别的东西").toBe(true);
    // 真相锚点：命令本来是可执行的形状（这里用 node 自己当 server，args 指向一个写文件的脚本）
    const marker = "spawned-marker";
    const script = join(root, "fake-server.mjs");
    writeFileSync(script, "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[2], 'spawned');\n");
    const root2 = repoWithLsp(process.execPath, marker);
    writeFileSync(join(root2, "fake-server.mjs"), "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[2], 'spawned');\n");
    // 用真 node 当 server：授权后它应当真能起来并写出 marker（下面的 ② 就是这条的对照组）
    const cfg2 = loadLspConfig(root2);
    (cfg2.servers.demo as { args: string[] }).args = [script, join(root2, marker)];
    let threw: unknown = null;
    try {
      await getLspClient(root2, cfg2, "demo");
    } catch (e) { threw = e; }
    expect(String((threw as Error)?.message ?? ""), "未授权竟然没拦").toContain("已跳过");
    expect(String((threw as Error)?.message ?? ""), "要点名是哪个 server").toContain("demo");
    await new Promise((r) => setTimeout(r, 300));
    expect(existsSync(join(root2, marker)), "未授权却 spawn 了 ⇒ 这一格没堵住").toBe(false);
    void root; void cfg;
  });
});

describe("② 授权后按内容指纹记住（首次问人，之后免批）", () => {
  it("同一份内容授权后不再拦；指纹变了重新拦", async () => {
    const root = scratch();
    mkdirSync(join(root, ".agent"), { recursive: true });
    const script = join(root, "fake-server.mjs");
    writeFileSync(script, "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[2], 'spawned');\n");
    const marker = join(root, "marker");
    const lspPath = join(root, ".agent", "lsp.json");
    const write = (cmd: string): void => writeFileSync(lspPath, JSON.stringify({
      lsp: { demo: { command: cmd, args: [script, marker], extensions: [".ts"] } },
    }));

    write(process.execPath);
    expect((await lspConfigTrustState(root)).state, "从未授权却报 trusted").toBe("pending");

    await decideLspConfigTrust(root, true);
    expect((await lspConfigTrustState(root)).state, "授权后仍不是 trusted ⇒ 决议没落盘").toBe("trusted");

    // 内容没变 ⇒ 仍是 trusted（免批这一格）
    write(process.execPath);
    expect((await lspConfigTrustState(root)).state, "同一份内容被重新问 ⇒ 指纹没绑住内容").toBe("trusted");

    // 内容变了（换 command）⇒ 必须重新问
    write("/bin/sh");
    expect((await lspConfigTrustState(root)).state, "换了 command 还沿用旧授权 ⇒ #58 没堵住").toBe("pending");
  });

  it("拒绝也是一条决议：declined 之后仍不许起进程", async () => {
    const root = repoWithLsp(process.execPath);
    await decideLspConfigTrust(root, false);
    expect((await lspConfigTrustState(root)).state).toBe("declined");
    const cfg = cfgOf(root);
    let threw: unknown = null;
    try { await getLspClient(root, cfg, "demo"); } catch (e) { threw = e; }
    expect(String((threw as Error)?.message ?? "")).toContain("已跳过");
  });
});

describe("③ 边界：取不到指纹不许静默放行（fail-closed）", () => {
  it("lsp.json 缺失 ⇒ 没有可执行命令，不算 trusted 也不当成已授权", async () => {
    const root = scratch();
    const t = await lspConfigTrustState(root);
    expect(t.fp, "文件都没有却算出了指纹").toBe("");
    expect(t.state).toBe("pending");
  });

  it("超大 lsp.json（>512KB）⇒ 按不授权处理，且不写信任条目", async () => {
    const root = scratch();
    mkdirSync(join(root, ".agent"), { recursive: true });
    // 合法 JSON 但撑过单文件帽：内容必须仍是可解析的，否则测到的是 JSON 解析那一格
    const filler = "x".repeat(600 * 1024);
    writeFileSync(join(root, ".agent", "lsp.json"), JSON.stringify({
      lsp: { demo: { command: process.execPath, args: [filler], extensions: [".ts"] } },
    }));
    const t = await lspConfigTrustState(root);
    // 语义是「取不到指纹」而不是插件门那个 bounded 位（单文件面没有目录遍历，就没有 bounded 那一档）：
    // 空串＝不进指纹，调用方按 fail-closed 处理。判**行为**（拿不到指纹），不判字段名。
    expect(t.fp, "超大文件竟算出了指纹 ⇒ E1 那条 fail-closed 没继承").toBe("");
    expect(t.state).toBe("pending");
    await decideLspConfigTrust(root, true);
    // 授权后仍不得变成 trusted（取不到指纹就不写条目）
    expect((await lspConfigTrustState(root)).state, "bounded 形态被授权成 trusted 了").toBe("pending");
  });

  it("信任文件放在工作区外的注入点时，判卷不碰用户真实信任文件", async () => {
    const root = repoWithLsp(process.execPath);
    const outside = join(scratch(), "injected-trust.json");
    setLspTrustFile(outside);
    await decideLspConfigTrust(root, true);
    expect(existsSync(outside), "注入的信任文件没被写").toBe(true);
    expect(readFileSync(outside, "utf8")).toContain("trusted");
    // 工作区内不该长出信任文件（否则注入点形同虚设）
    expect(existsSync(join(root, ".agent", "lsp-trust.json")), "注入点失效：信任写到了缺省位置").toBe(false);
  });
});