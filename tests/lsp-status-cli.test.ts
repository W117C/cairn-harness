// LSP 状态的 CLI 面（第 995 页）：`scripts/lsp-status.ts`。
// 这里只判三件事：参数解析不静默收坏输入、CLI 与 core 读**同一份事实**、读状态不起进程。
// 状态本身的语义判卷在 `tests/lsp.test.ts` 的「lspServerStatus：状态面」一节——两面各抄一份口径
// 正是本仓点名的第二事实源，所以第 4 条判的是"逐字相等"。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { closeAllLspClients, formatLspStatus, setLspTrustedRepos } from "../src/tools/lsp";
import { parseArgs, runLspStatus } from "../scripts/lsp-status";

const STUB = fileURLToPath(new URL("../fixtures/lsp/stub-server.mjs", import.meta.url));
let root = "";

afterEach(async () => {
  await closeAllLspClients();
  setLspTrustedRepos([]);
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

async function wsWithConfig(config: object): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "lsp-status-cli-"));
  await mkdir(join(root, ".agent"), { recursive: true });
  await writeFile(join(root, ".agent", "lsp.json"), JSON.stringify(config), "utf8");
  return root;
}

describe("lsp-status CLI 面", () => {
  it("缺省取当前目录；--workspace 与 --json 各认各的", () => {
    const plain = parseArgs([]);
    expect(plain.json).toBe(false);
    const withDir = parseArgs(["--workspace", "/tmp/somewhere", "--json"]);
    expect(withDir.workspace).toBe("/tmp/somewhere");
    expect(withDir.json).toBe(true);
  });

  it("坏参数当场说，不静默收下（--workspace 后面没值 / 不认识的开关）", () => {
    expect(() => parseArgs(["--workspace"])).toThrow(/--workspace/);
    expect(() => parseArgs(["--foo"])).toThrow(/不认识的参数/);
  });

  it("未配置的工作区：CLI 说的与 core 报告逐字一致（两面不许各抄一份口径）", async () => {
    root = await mkdtemp(join(tmpdir(), "lsp-status-cli-off-"));
    const out = await runLspStatus(["--workspace", root]);
    const st = out.status;
    expect(st.enabled).toBe(false);
    expect(out.text).toBe(formatLspStatus(st));
    expect(out.text).toContain("未启用");
  });

  it("--json 出的是同一份结构（脚本、模型与判卷读同一个对象）", async () => {
    const ws = await wsWithConfig({ lsp: { stub: { command: "node", args: [STUB], extensions: [".ts"] } } });
    setLspTrustedRepos([ws]);
    const textOut = await runLspStatus(["--workspace", ws]);
    const jsonOut = await runLspStatus(["--workspace", ws, "--json"]);
    expect(JSON.parse(jsonOut.text)).toEqual(textOut.status);
    expect(textOut.status.servers.map((s) => s.id)).toEqual(["stub"]);
    expect(textOut.status.servers[0]?.state).toBe("not-started");
  });

  it("CLI 读状态**不起进程**（留痕脚本：marker 出现＝真 spawn 过）", async () => {
    root = await mkdtemp(join(tmpdir(), "lsp-status-cli-trace-"));
    await mkdir(join(root, ".agent"), { recursive: true });
    const marker = join(root, "spawned.marker");
    const trace = join(root, "trace.mjs");
    await writeFile(trace, 'import { appendFileSync } from "node:fs";\nappendFileSync(' + JSON.stringify(marker) + ', "x");\nsetTimeout(() => process.exit(0), 50);\n', "utf8");
    await writeFile(join(root, ".agent", "lsp.json"), JSON.stringify({
      lsp: { trace: { command: "node", args: [trace], extensions: [".ts"] } },
    }), "utf8");
    setLspTrustedRepos([root]);
    const out = await runLspStatus(["--workspace", root]);
    expect(out.status.servers[0]?.state).toBe("not-started");
    await new Promise((r) => setTimeout(r, 200));
    expect(existsSync(marker)).toBe(false);
  });
});
