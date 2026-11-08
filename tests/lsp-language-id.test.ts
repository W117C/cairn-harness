// LSP `languageId` 判卷（2026-10-23）：didOpen 送出去的 languageId 必须是**服务器声明的那一个**。
//
// 修的缺陷（有复现，不是推断）：`src/tools/lsp.ts` 的 `openFile` 把 languageId 硬编码成
// 「六个 JS/TS 后缀 ⇒ typescript，其余一律 plaintext」，而 `LspServerConfig` 压根没有
// `extensionToLanguage` 这一格 ⇒ 配一个 pyright / gopls / rust-analyzer 时，
// Python/Go/Rust 文件以 `plaintext` 送进服务器：真服务器要么拒绝要么返回空，
// **六操作全静默失效且没有任何一处出声**。
// 探针 server（`fixtures/lsp/languageid-probe-server.mjs`）把每个 didOpen 的 languageId 记下来，
// 用自定义请求 `probe/languageIds` 原样交回 ⇒ 这里判的是**线上真发出去的那个值**。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeAllLspClients,
  defaultLanguageId,
  getLspClient,
  languageIdMap,
  loadLspConfig,
  setLspTrustedRepos,
} from "../src/tools/lsp.js";

const PROBE = fileURLToPath(new URL("../fixtures/lsp/languageid-probe-server.mjs", import.meta.url));

let ws = "";
afterEach(async () => {
  await closeAllLspClients();
  setLspTrustedRepos([]);
  if (ws) await rm(ws, { recursive: true, force: true });
});

/** 探针的返回形状（服务器侧原样观测，不是本文件推算）。 */
async function probeLanguageIds(client: { request: (m: string, p?: unknown) => Promise<unknown> }): Promise<Record<string, string>> {
  const out = await client.request("probe/languageIds");
  return out as Record<string, string>;
}

function uriOf(p: string): string {
  return new URL("file://" + p).href;
}

describe("defaultLanguageId（缺省启发式，存量行为不变）", () => {
  it("六个 JS/TS 后缀 ⇒ typescript；其余 ⇒ plaintext", () => {
    for (const e of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
      expect(defaultLanguageId("/x/a" + e)).toBe("typescript");
    }
    for (const e of [".py", ".go", ".rs", ".java", ".md", ""]) {
      expect(defaultLanguageId("/x/a" + e)).toBe("plaintext");
    }
  });
});

describe("languageIdMap（配置 → 查表）", () => {
  it("只收非空字符串值；坏形状按缺格处理（不抛、不污染查表）", () => {
    const m = languageIdMap({
      command: "node",
      extensions: [".py"],
      extensionToLanguage: { ".py": "python", ".go": "go", ".rs": "" },
    });
    expect(m.get(".py")).toBe("python");
    expect(m.get(".go")).toBe("go");
    // 空串是坏形状：进表会让 languageId 变成空（服务器侧同样无所适从）⇒ 当缺格
    expect(m.has(".rs")).toBe(false);
    // 没配这一格 ⇒ 空表（调用方据此回落缺省值）
    expect(languageIdMap({ command: "node", extensions: [] }).size).toBe(0);
  });
});

describe("didOpen 的 languageId 走服务器声明（真发出去的那个值）", () => {
  /** 造一个带 extensionToLanguage 的工作区，起探针 server，真的 didOpen 一个 .py 文件。 */
  async function probeWs(config: object): Promise<{ root: string }> {
    ws = await mkdtemp(join(tmpdir(), "m2a-langid-"));
    await mkdir(join(ws, ".agent"), { recursive: true });
    await writeFile(join(ws, ".agent", "lsp.json"), JSON.stringify(config), "utf8");
    setLspTrustedRepos([ws]);
    return { root: ws };
  }

  it("配了 extensionToLanguage ⇒ 非 JS 文件拿到声明的 languageId（不再是 plaintext）", async () => {
    const { root } = await probeWs({
      lsp: {
        py: {
          command: "node",
          args: [PROBE],
          extensions: [".py"],
          extensionToLanguage: { ".py": "python" },
        },
      },
    });
    const cfg = loadLspConfig(root);
    // 配置面先证这一格真被读进来了（修复前它在这里就被丢掉 ⇒ 后面全免谈）
    expect(cfg.servers["py"]?.extensionToLanguage).toEqual({ ".py": "python" });

    const client = await getLspClient(root, cfg, "py");
    const target = join(root, "a.py");
    await writeFile(target, "def alpha():\n    return 1\n", "utf8");
    await client.openFile(target);

    const seen = await probeLanguageIds(client);
    expect(seen[uriOf(target)]).toBe("python");
  });

  it("同族：.go ⇒ go、.rs ⇒ rust（两个 server 各管各的，表不串）", async () => {
    const { root } = await probeWs({
      lsp: {
        go: { command: "node", args: [PROBE], extensions: [".go"], extensionToLanguage: { ".go": "go" } },
        rs: { command: "node", args: [PROBE], extensions: [".rs"], extensionToLanguage: { ".rs": "rust" } },
      },
    });
    const cfg = loadLspConfig(root);
    const goClient = await getLspClient(root, cfg, "go");
    const rsClient = await getLspClient(root, cfg, "rs");
    const goFile = join(root, "a.go");
    const rsFile = join(root, "a.rs");
    await writeFile(goFile, "package main\n", "utf8");
    await writeFile(rsFile, "fn main() {}\n", "utf8");
    await goClient.openFile(goFile);
    await rsClient.openFile(rsFile);

    const goSeen = await probeLanguageIds(goClient);
    const rsSeen = await probeLanguageIds(rsClient);
    expect(goSeen[uriOf(goFile)]).toBe("go");
    expect(rsSeen[uriOf(rsFile)]).toBe("rust");
  });

  it("没配 extensionToLanguage ⇒ 回落缺省启发式（存量配置一个字不变）", async () => {
    const { root } = await probeWs({
      lsp: { ts: { command: "node", args: [PROBE], extensions: [".ts", ".py"] } },
    });
    const cfg = loadLspConfig(root);
    expect(cfg.servers["ts"]?.extensionToLanguage).toBeUndefined();

    const client = await getLspClient(root, cfg, "ts");
    const tsFile = join(root, "a.ts");
    const pyFile = join(root, "a.py");
    await writeFile(tsFile, "export const a = 1;\n", "utf8");
    await writeFile(pyFile, "x = 1\n", "utf8");
    await client.openFile(tsFile);
    await client.openFile(pyFile);

    const seen = await probeLanguageIds(client);
    expect(seen[uriOf(tsFile)]).toBe("typescript"); // 旧行为
    expect(seen[uriOf(pyFile)]).toBe("plaintext"); // 旧行为：没配表就照旧
  });

  it("查表按原样键：配置写 .py 只命中 .py，别的扩展仍回落", async () => {
    const { root } = await probeWs({
      lsp: { py: { command: "node", args: [PROBE], extensions: [".py", ".pyi"], extensionToLanguage: { ".py": "python" } } },
    });
    const cfg = loadLspConfig(root);
    const client = await getLspClient(root, cfg, "py");
    const pyi = join(root, "a.pyi"); // 表里没有 .pyi ⇒ 回落 plaintext，不猜
    await writeFile(pyi, "x: int\n", "utf8");
    await client.openFile(pyi);
    const seen = await probeLanguageIds(client);
    expect(seen[uriOf(pyi)]).toBe("plaintext");
  });
});
