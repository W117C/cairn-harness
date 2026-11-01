// M2a LSP 框架测试：stub server（fixtures/lsp/stub-server.mjs）+ 六操作 + 生命周期 + 诊断回流。
// 坑：stub 用 plain node 跑（fixtures 不进 tsc），workspace 每用例独立，收尾 closeAllLspClients。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { snapshotNote } from "../src/tools/snapshot.js";

/** 剥掉「覆盖前原件已存 …」那句尾巴：它属于快照面，不是本条判卷要判的东西。
 *  标记从**生产函数**派生，不在这里抄第二份文案——2026-10-05 修：原写法把正则写死成
 *  `…/snapshots/[^\s]+$`，而后缀里后来加了带空格的说明（`4d52a16c`）⇒ 剥不掉、两支判卷同时红。
 *  派生之后文案再改判卷自动跟上。 */
function stripSnapshotNote(text: string): string {
  const marker = snapshotNote("\u0000").split("\u0000")[0] ?? "";
  const esc = marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return text.replace(new RegExp(esc + "[\\s\\S]*$", "u"), "");
}
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectDiagnostics,
  closeAllLspClients,
  getLspClient,
  setLspTrustedRepos,
  isLspBroken,
  loadLspConfig,
  lsp,
  lspPrefetchEnabled,
  prefetchLsp,
  SYMBOL_KIND_NAMES,
  symbolKindValues,
} from "../src/tools/lsp";
import type { ToolContext } from "../src/tools";

// stub 用绝对路径：相对路径会被解析进 tmp 工作区（不存在）
const STUB = fileURLToPath(new URL("../fixtures/lsp/stub-server.mjs", import.meta.url));

let ws = "";
afterEach(async () => {
  await closeAllLspClients();
  // 断言集合是**模块级**状态：不清会让下一个用例继承上一个工作区的归属（那正是"宽授权"）。
  setLspTrustedRepos([]);
  if (ws) await rm(ws, { recursive: true, force: true });
});

async function newCtx(config?: object): Promise<ToolContext> {
  ws = await mkdtemp(join(tmpdir(), "m2a-lsp-"));
  await mkdir(join(ws, ".agent"), { recursive: true });
  await writeFile(
    join(ws, ".agent", "lsp.json"),
    JSON.stringify(
      config ?? {
        lsp: {
          stub: { command: "node", args: [STUB], extensions: [".ts", ".js"] },
        },
      },
    ),
    "utf8",
  );
  // #58 第二半：本判卷自建的 tmp 工作区**由本判卷拥有**，其 `.agent/lsp.json` 的 command
  // 是仓内 fixture（`fixtures/lsp/stub-server.mjs`），不是仓库自带的外部输入。
  // 用调用方断言显式声明，与 S3 信任闸的 `trustedRepo: true` 同一口径（断言，不是缺省）。
  // 不这么做的话本判卷会撞上新信任门而红——而那个红是**判卷没声明归属**，不是门错了。
  setLspTrustedRepos([ws]);
  return { workspace: ws };
}

const SAMPLE = [
  "function alpha() {}",
  "DEF(alpha) here",
  "REF(alpha) one",
  "REF(alpha) two",
  "IMPL(alpha) iface",
  "SYM(alpha) symbol",
  "ERROR_HERE",
  "WARN_HERE",
  "",
].join("\n");

async function writeSample(rel = "src/sample.ts"): Promise<string> {
  await mkdir(join(ws, "src"), { recursive: true });
  await writeFile(join(ws, rel), SAMPLE, "utf8");
  return join(ws, rel);
}

describe("LSP 框架（M2a 任务 5）", () => {
  it("配置：缺省关闭；lsp:false 关闭；坏 JSON fail loud", () => {
    return (async () => {
      const dirA = await mkdtemp(join(tmpdir(), "m2a-lspcfg-"));
      expect(loadLspConfig(dirA).enabled).toBe(false);
      await mkdir(join(dirA, ".agent"), { recursive: true });
      await writeFile(join(dirA, ".agent", "lsp.json"), JSON.stringify({ lsp: false }), "utf8");
      expect(loadLspConfig(dirA).enabled).toBe(false);
      await writeFile(join(dirA, ".agent", "lsp.json"), "{bad json", "utf8");
      expect(() => loadLspConfig(dirA)).toThrow(/合法 JSON/);
      await rm(dirA, { recursive: true, force: true });
    })();
  });

  it("六操作各一条：definition / references / hover / documentSymbol / workspaceSymbol / implementation", async () => {
    const ctx = await newCtx();
    await writeSample();

    const def = await lsp.run({ operation: "definition", path: "src/sample.ts", line: 2, column: 5 }, ctx);
    expect(def.ok).toBe(true);
    expect(def.output).toBe("src/sample.ts:2:1");

    const refs = await lsp.run({ operation: "references", path: "src/sample.ts", line: 2, column: 5 }, ctx);
    expect(refs.ok).toBe(true);
    expect(refs.output.split("\n")).toEqual(["src/sample.ts:2:1", "src/sample.ts:3:1", "src/sample.ts:4:1"]);

    const hover = await lsp.run({ operation: "hover", path: "src/sample.ts", line: 2, column: 5 }, ctx);
    expect(hover.ok).toBe(true);
    expect(hover.output).toBe("hover: alpha（stub）");

    const docSymbols = await lsp.run({ operation: "documentSymbol", path: "src/sample.ts" }, ctx);
    expect(docSymbols.ok).toBe(true);
    expect(docSymbols.output).toContain("alpha Function"); // stub 标记 kind=12（Function）
    expect(docSymbols.output).toContain(":6:");

    const wsSymbols = await lsp.run({ operation: "workspaceSymbol", symbol: "alpha" }, ctx);
    expect(wsSymbols.ok).toBe(true);
    expect(wsSymbols.output).toContain("alpha Function src/sample.ts:6:");

    const impl = await lsp.run({ operation: "implementation", path: "src/sample.ts", line: 2, column: 5 }, ctx);
    expect(impl.ok).toBe(true);
    expect(impl.output).toBe("src/sample.ts:5:1");
  });

  it("行列为 1-based 对外（第 3 行第 9 列 = REF(alpha) 的 alpha 词内）", async () => {
    const ctx = await newCtx();
    await writeSample();
    // "REF(alpha) one"：R=1,E=2,F=3,(=4,a=5…9 → column 9 落在 alpha 词内
    const hover = await lsp.run({ operation: "hover", path: "src/sample.ts", line: 3, column: 9 }, ctx);
    expect(hover.output).toBe("hover: alpha（stub）");
    // definition（第 2 行第 5 列）返回的位置也是 1-based
    const def = await lsp.run({ operation: "definition", path: "src/sample.ts", line: 2, column: 5 }, ctx);
    expect(def.output).toBe("src/sample.ts:2:1");
  });

  it("server 启动失败进 broken 且不重试", async () => {
    const ctx = await newCtx({
      lsp: { bad: { command: "definitely-not-exist-cmd-m2a", extensions: [".ts"] } },
    });
    await writeSample();
    await expect(lsp.run({ operation: "hover", path: "src/sample.ts", line: 2, column: 5 }, ctx)).rejects.toThrow();
    expect(isLspBroken(ws, "bad")).toBe(true);
    // 第二次调用不再 spawn（立即拒绝，错误信息说明 broken）
    const err = await lsp
      .run({ operation: "hover", path: "src/sample.ts", line: 2, column: 5 }, ctx)
      .catch((e: Error) => e);
    expect((err as Error).message).toContain("broken");
    expect((err as Error).message).not.toContain("ENOENT");
  });

  it("配了 LSP 却没验成 ⇒ 明说「没有静态诊断证据」：沉默会被读成绿灯", async () => {
    await newCtx({ lsp: { bad: { command: "definitely-not-exist-cmd-m2a", extensions: [".ts"] } } });
    const abs = await writeSample();
    const first = await collectDiagnostics(ws, abs);
    expect(first.startsWith("\n<diagnostics-unavailable file=\"src/sample.ts\">")).toBe(true);
    expect(first).toContain("没有静态诊断证据");
    expect(first).toContain("没列错误 ≠ 没有错误");
    // 分类要按**实测**文本走：命令不存在时 jsonrpc 抛的是 "Pending response rejected since
    // connection got disposed"（2026-09-20 探针），所以断句是"进程已退出或无响应"；
    // 内部协议文本不外传（它既不可读也白烧 token）——这条断言能杀"照抄 errno 分类"与"直接透传"两种写法
    expect(first).toContain("语言服务器进程已退出或无响应");
    expect(first).not.toContain("Pending response rejected");
    expect(first.length).toBeLessThan(400); // 有界：这条每次写盘都可能注一遍
    // 第二次走 broken 短路（不再 spawn），也必须继续说话——不能因为"已经知道了"就退回沉默
    expect(isLspBroken(ws, "bad")).toBe(true);
    const second = await collectDiagnostics(ws, abs);
    expect(second).toContain("broken");
  });

  it("对照：验了且干净仍是空串（缺席与干净不得合并，反向也不许把干净说成缺席）", async () => {
    await newCtx();
    await mkdir(join(ws, "src"), { recursive: true });
    await writeFile(join(ws, "src", "clean2.ts"), "const a = 1;\n", "utf8");
    expect(await collectDiagnostics(ws, join(ws, "src", "clean2.ts"))).toBe("");
  });

  it("同一 (root, serverID) 只起一个进程", async () => {
    const ctx = await newCtx();
    await writeSample();
    const c1 = await getLspClient(ws, loadLspConfig(ws), "stub");
    const c2 = await getLspClient(ws, loadLspConfig(ws), "stub");
    expect(c1.pid).toBe(c2.pid);
  });

  it("未启用（无 lsp.json）时 lsp 工具 fail loud", async () => {
    ws = await mkdtemp(join(tmpdir(), "m2a-lspoff-"));
    await expect(lsp.run({ operation: "hover", path: "a.ts", line: 1, column: 1 }, { workspace: ws })).rejects.toThrow(
      /未启用/,
    );
  });
});

/* ---- 第 920 页：能力协商 ----
 * 此前 initialize 发的是 `capabilities: {}`，而服务器的应答（含 `textDocumentSync` 与各 provider
 * 声明）**整个丢掉**。三件事因此悄悄出错：真实服务器按"最保守形状"回包（我们收哪种都行，但它本可以
 * 给更好的）；改了盘之后 didChange 的形状与服务器声明的同步方式不符（增量服务器会**沉默丢掉**这条
 * 更新，于是六操作端回旧文本，看着像"代码没变"）；服务器没实现的那一支操作我们照样发，等 8 秒超时。
 */
describe("能力协商（第 920 页）", () => {
  const stubCfg = (extra: string[]) => ({
    lsp: { stub: { command: "node", args: [STUB, ...extra], extensions: [".ts", ".js"] } },
  });

  it("客户端把**真会用到的**能力声明出去：没声明的降级是静默的", async () => {
    const ctx = await newCtx();
    const capsFile = join(ws, "caps.json");
    // 配置是每次调用现读的：先建工作区，再把带 --caps-to 的那份写进去
    await writeFile(join(ws, ".agent", "lsp.json"), JSON.stringify(stubCfg(["--caps-to=" + capsFile])), "utf8");
    await writeSample();
    await lsp.run({ operation: "hover", path: "src/sample.ts", line: 3, column: 9 }, ctx);
    const caps = JSON.parse(await readFile(capsFile, "utf8")) as Record<string, any>;
    // 这三条各对应一种"不声明就白拿"的降级形状：
    expect(caps.textDocument.definition.linkSupport).toBe(true); // 不声明 ⇒ 只回 Location，不回 LocationLink
    expect(caps.textDocument.hover.contentFormat).toContain("markdown"); // 不声明 ⇒ 服务器有权只回 plaintext
    expect(caps.textDocument.documentSymbol.hierarchicalDocumentSymbolSupport).toBe(true); // 不声明 ⇒ 平铺符号表
    // 值集声明 = "这 26 种我都叫得出名字"，而名字就来自同一份枚举（下面那条判卷钉这个）
    expect(caps.textDocument.documentSymbol.symbolKind.valueSet).toEqual(symbolKindValues());
    expect(caps.textDocument.documentSymbol.symbolKind.valueSet).toHaveLength(26);
    // 工作区符号的客户端能力键是 `workspace.symbol.symbolKind.valueSet`
    // （`workspaceSymbol` 这一格协议里不存在——写错键 = 发一段没人听的 JSON）
    expect(caps.workspace.symbol.symbolKind.valueSet).toEqual(symbolKindValues());
    // **不吹**：没实现的面不许声明（声明了就把服务器引到我们根本不处理的通知上）
    expect(caps.textDocument.completion).toBeUndefined();
    expect(caps.workspace?.didChangeWatchedFiles).toBeUndefined();
    expect(caps.workspace?.executeCommand).toBeUndefined();
  });

  it("服务器没声明 hoverProvider ⇒ 当场说不支持，不把协议黑话甩给模型", async () => {
    const ctx = await newCtx(stubCfg(["--no-hover"]));
    await writeSample();
    const err = await lsp
      .run({ operation: "hover", path: "src/sample.ts", line: 3, column: 9 }, ctx)
      .catch((e: Error) => e);
    const message = (err as Error).message;
    expect(message).toContain("hover");
    expect(message).toContain("未声明");
    // 原句证人（第 915 页）：这句的用途是让模型**换路**而不是重跑，所以「能力的边界、不是一次
    // 失败」必须真在话里。抄原句是刻意的——改措辞时这条会红，逼人重新确认那句话还对。
    expect(message).toContain("这是该服务器的能力边界，不是这次调用失败");
    expect(message).toContain("grep / read_file");
    // stub 在 --no-hover 下**不注册** hover handler ⇒ 不设门控拿到的是 jsonrpc 的
    // MethodNotFound 黑话（"Unhandled method"一类）：模型读不懂，也只能原样重跑。
    expect(message).not.toMatch(/Unhandled method|Method not found|jsonrpc/i);
    // 门控只拦没声明的那一支，其余五操作照旧
    const def = await lsp.run({ operation: "definition", path: "src/sample.ts", line: 3, column: 9 }, ctx);
    expect(def.output).toBe("src/sample.ts:2:1");
  });

  it("增量同步（change:2）：didChange 不带 range 就被服务器沉默丢掉，结果停在旧文本", async () => {
    const ctx = await newCtx(stubCfg(["--incremental"]));
    const abs = await writeSample();
    const first = await lsp.run({ operation: "hover", path: "src/sample.ts", line: 3, column: 9 }, ctx);
    expect(first.output).toBe("hover: alpha（stub）");
    await writeFile(abs, SAMPLE.replace(/REF\(alpha\)/g, "REF(beta)"), "utf8");
    const second = await lsp.run({ operation: "hover", path: "src/sample.ts", line: 3, column: 9 }, ctx);
    expect(second.output).toBe("hover: beta（stub）");
  });

  it("不接受增量（change:0）：改盘后走 didClose+didOpen 重开，而不是发一条没人认的 didChange", async () => {
    const ctx = await newCtx(stubCfg(["--sync-none"]));
    const abs = await writeSample();
    const first = await lsp.run({ operation: "hover", path: "src/sample.ts", line: 3, column: 9 }, ctx);
    expect(first.output).toBe("hover: alpha（stub）");
    await writeFile(abs, SAMPLE.replace(/REF\(alpha\)/g, "REF(beta)"), "utf8");
    const second = await lsp.run({ operation: "hover", path: "src/sample.ts", line: 3, column: 9 }, ctx);
    expect(second.output).toBe("hover: beta（stub）");
  });

  it("符号 kind 名派生自协议枚举：手抄那份把 25 抄成了 TypeParameter", () => {
    // 旧表少 6 格（Object/Key/Null/EnumMember/Event/TypeParameter 一律落成 "Symbol"），
    // 而 25 抄错 = **主动给模型一句假话**（协议里 25 是 Operator，26 才是 TypeParameter）。
    expect(SYMBOL_KIND_NAMES[25]).toBe("Operator");
    expect(SYMBOL_KIND_NAMES[26]).toBe("TypeParameter");
    expect(SYMBOL_KIND_NAMES[19]).toBe("Object");
    expect(SYMBOL_KIND_NAMES[22]).toBe("EnumMember");
    expect(symbolKindValues()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]);
    for (const v of symbolKindValues()) expect(SYMBOL_KIND_NAMES[v]).toBeTruthy();
  });

  it("workspaceSymbol 允许「有名字没位置」的条目：不许一条坏形状带走整支工具", async () => {
    const ctx = await newCtx(stubCfg(["--symbol-no-location"]));
    await writeSample();
    // stub 的索引来自"打开过的文档"：先把文档递进去（真服务器有自己的索引，不需要这一步）
    await lsp.run({ operation: "documentSymbol", path: "src/sample.ts" }, ctx);
    const res = await lsp.run({ operation: "workspaceSymbol", symbol: "alpha" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("alpha");
    expect(res.output).toContain("无位置");
    expect(res.output).not.toContain("undefined");
    expect(res.output).not.toMatch(/NaN|:0:0/);
  });
});

describe("诊断回流（M2a 任务 6）", () => {
  it("只取 ERROR 级，≤20 条，附 <diagnostics> 块在输出尾部", async () => {
    const ctx = await newCtx();
    // 22 个 ERROR_HERE + 1 个 WARN_HERE → 只保留 20 条 ERROR，WARNING 被过滤
    const lines: string[] = [];
    for (let i = 0; i < 22; i++) lines.push("ERROR_HERE " + String(i));
    lines.push("WARN_HERE");
    await mkdir(join(ws, "src"), { recursive: true });
    await writeFile(join(ws, "src", "many.ts"), lines.join("\n") + "\n", "utf8");
    const diag = await collectDiagnostics(ws, join(ws, "src", "many.ts"));
    expect(diag.startsWith("\n<diagnostics file=\"src/many.ts\">")).toBe(true);
    expect(diag.endsWith("</diagnostics>")).toBe(true);
    const errLines = diag.split("\n").filter((l) => l.startsWith("ERROR ["));
    expect(errLines.length).toBe(20);
    expect(diag).not.toContain("警告");
    // 行号 1-based
    expect(errLines[0]).toContain("[1:");
  });

  it("无错误（仅 WARN 或干净文件）→ 空串（输出不变）", async () => {
    const ctx = await newCtx();
    await mkdir(join(ws, "src"), { recursive: true });
    await writeFile(join(ws, "src", "clean.ts"), "const a = 1;\nWARN_HERE\n", "utf8");
    const diag = await collectDiagnostics(ws, join(ws, "src", "clean.ts"));
    expect(diag).toBe("");
  });

  it("diagnostics.maxPerFile 兑现：配置 2 就只回流 2 条 ERROR", async () => {
    await newCtx({
      lsp: {
        stub: {
          command: "node", args: [STUB], extensions: [".ts"],
          diagnostics: { enabled: true, maxPerFile: 2 },
        },
      },
    });
    await mkdir(join(ws, "src"), { recursive: true });
    const lines = Array.from({ length: 5 }, (_, i) => "ERROR_HERE " + String(i));
    await writeFile(join(ws, "src", "few.ts"), lines.join("\n") + "\n", "utf8");
    const diag = await collectDiagnostics(ws, join(ws, "src", "few.ts"));
    expect(diag.split("\n").filter((l) => l.startsWith("ERROR [")).length).toBe(2);
  });

  it("宿主 diagnostics.enabled:false 兑现：写后不回流诊断", async () => {
    await newCtx({
      lsp: {
        stub: {
          command: "node", args: [STUB], extensions: [".ts"],
          diagnostics: { enabled: false },
        },
      },
    });
    await mkdir(join(ws, "src"), { recursive: true });
    await writeFile(join(ws, "src", "err.ts"), "ERROR_HERE\n", "utf8");
    expect(await collectDiagnostics(ws, join(ws, "src", "err.ts"))).toBe("");
  });

  it("startupTimeout 兑现：慢 initialize 按配置预算失败，不坠进 8s 缺省", async () => {
    await newCtx({
      lsp: {
        stub: {
          command: "node", args: [STUB, "--slow-init"], extensions: [".ts"],
          startupTimeout: 200,
        },
      },
    });
    const cfg = loadLspConfig(ws);
    const started = Date.now();
    await expect(getLspClient(ws, cfg, "stub")).rejects.toThrow(/initialize 超时（200ms/);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(isLspBroken(ws, "stub")).toBe(true);
  });

  it("restartOnCrash 兑现：首次崩溃后下一次调用惰性重启并可用", async () => {
    await newCtx();
    const marker = join(ws, "crash-once.marker");
    await writeFile(join(ws, ".agent", "lsp.json"), JSON.stringify({
      lsp: {
        stub: {
          command: "node", args: [STUB, "--crash-until=" + marker], extensions: [".ts"],
          restartOnCrash: true, startupTimeout: 3000,
        },
      },
    }), "utf8");
    const cfg = loadLspConfig(ws);
    await expect(getLspClient(ws, cfg, "stub")).rejects.toThrow();
    expect(isLspBroken(ws, "stub")).toBe(true);

    await writeFile(join(ws, "a.ts"), "function alpha() {}\n", "utf8");
    const hover = await lsp.run({ operation: "hover", path: "a.ts", line: 1, column: 10 }, { workspace: ws });
    expect(hover.output).toContain("hover: alpha");
    expect(isLspBroken(ws, "stub")).toBe(false);
  });

  it("LSP 未配置：edit/write 输出保持不变（空串回流）", async () => {
    const { edit_file } = await import("../src/tools/edit_file");
    ws = await mkdtemp(join(tmpdir(), "m2a-nodiag-"));
    await writeFile(join(ws, "a.ts"), "hello world\n", "utf8");
    const res = await edit_file.run({ path: "a.ts", old_string: "hello", new_string: "bonjour" }, { workspace: ws });
    expect(res.ok).toBe(true);
    // 断言面 = 「不追加 <diagnostics> 后缀」。D7 覆盖前快照那句尾巴是另一件事，允许出现但不许在这里当诊断混进来。
    expect(stripSnapshotNote(res.output)).toBe("已替换 a.ts（1 处，+1 −1 行）");
  });
});

// S1（评审 2026-10-03）：read_file 那一脚 prefetchLsp 会走到 spawn(工作区 .agent/lsp.json 里的 command)。
// 这里的证据形状是"留痕"：把一个**会写文件的脚本**当语言服务器——文件出现＝真 spawn 过。
describe("S1：预热默认关，且不吞掉显式开启", () => {
  /** 造一个"命令会留痕"的工作区：marker 出现即证明 spawn 发生了。 */
  async function markerWs(): Promise<{ root: string; marker: string; target: string }> {
    const root = await mkdtemp(join(tmpdir(), "m2a-lsp-s1-"));
    await mkdir(join(root, ".agent"), { recursive: true });
    const marker = join(root, "spawned.marker");
    const evil = join(root, "trace-server.mjs");
    await writeFile(evil, 'import { appendFileSync } from "node:fs";\nappendFileSync(' + JSON.stringify(marker) + ', "x");\nsetTimeout(() => process.exit(0), 50);\n', "utf8");
    await writeFile(join(root, ".agent", "lsp.json"), JSON.stringify({
      lsp: { trace: { command: "node", args: [evil], extensions: [".ts"] } },
    }), "utf8");
    const target = join(root, "a.ts");
    await writeFile(target, "export const a = 1;\n", "utf8");
    // 同上：本判卷拥有这个 tmp 工作区，command 是本判卷写的 trace 脚本（#58 第二半的调用方断言）。
    setLspTrustedRepos([root]);
    return { root, marker, target };
  }

  const waitFor = async (p: string, ms = 3000): Promise<boolean> => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (existsSync(p)) return true;
      await new Promise((r) => setTimeout(r, 40));
    }
    return existsSync(p);
  };

  it("缺省不预热：返回 skipped-prefetch-off，且 spawn 没发生（marker 不存在）", async () => {
    const { root, marker, target } = await markerWs();
    try {
      expect(prefetchLsp(root, target)).toBe("skipped-prefetch-off");
      expect(await waitFor(marker, 300)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("显式开启（参数）确实预热：started，且 marker 出现——开关不是死代码", async () => {
    const { root, marker, target } = await markerWs();
    try {
      expect(prefetchLsp(root, target, true)).toBe("started");
      expect(await waitFor(marker)).toBe(true);
    } finally {
      await closeAllLspClients();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("谓词只认字面 1：缺省 false／0 与 true 都不算开启（宽松真值会把默认关写成默认开）", () => {
    expect(lspPrefetchEnabled({})).toBe(false);
    expect(lspPrefetchEnabled({ CAIRN_LSP_PREFETCH: "1" })).toBe(true);
    expect(lspPrefetchEnabled({ CAIRN_LSP_PREFETCH: "0" })).toBe(false);
    expect(lspPrefetchEnabled({ CAIRN_LSP_PREFETCH: "true" })).toBe(false);
    expect(lspPrefetchEnabled({ CAIRN_LSP_PREFETCH: "" })).toBe(false);
  });

  it("另外两个不 spawn 的出口各自有声（配置坏 / 没有匹配的 server）", async () => {
    const root = await mkdtemp(join(tmpdir(), "m2a-lsp-s1-"));
    try {
      await mkdir(join(root, ".agent"), { recursive: true });
      await writeFile(join(root, ".agent", "lsp.json"), JSON.stringify({ lsp: false }), "utf8");
      expect(prefetchLsp(root, join(root, "a.ts"), true)).toBe("skipped-no-config");
      const marker = join(root, "m2");
      const evil = join(root, "t.mjs");
      await writeFile(evil, 'import { appendFileSync } from "node:fs";\nappendFileSync(' + JSON.stringify(marker) + ', "x");\nsetTimeout(() => process.exit(0), 50);\n', "utf8");
      await writeFile(join(root, ".agent", "lsp.json"), JSON.stringify({
        lsp: { only: { command: "node", args: [evil], extensions: [".md"] } },
      }), "utf8");
      expect(prefetchLsp(root, join(root, "a.ts"), true)).toBe("skipped-no-server");
      expect(existsSync(marker)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
