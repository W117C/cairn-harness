// 判卷 · 模型可见文本里不许出现"半个 UTF-8 字符"（#54/#55，第 68 页）
//
// 现场两支（都实测过，不是推测）：
//   #55 `worktree.ts` 的 git 收集器 `stdout += String(d)` 逐块解码 ⇒ 一份 1.29MB 中文 diff 里 **32 处**
//       U+FFFD，同一条命令一次解码到底 0 处；`hooks.ts` 同形，而 hook 的 stdout 是要回注给模型的上下文。
//   #54 `read_file.ts` 的 50KB 帽 `Buffer...subarray(0, N).toString("utf8")` 裸切 ⇒ 400 行纯中文文件的
//       输出尾部留了一个 U+FFFD（`lsp` 原先同形，第 67 页改成按码位回退）。
// 两支的共同形状是"在交给模型的字节流上做了一次不完整的解码/切割"，所以判卷分三层：
//   ① 行为：跨界那两半喂进去，出来不许有问号（含一条**反向**：旧写法确实会坏 ⇒ 证明这把尺有分辨力）；
//   ② 工具端到端：真跑 `read_file`，不是只看 helper；
//   ③ 棘轮：AST 扫 `src/` 已跟踪文件，两类写法（on("data") 里就地解码 / 按 *BYTES 命名的帽用字符串 slice）
//      必须零命中——注释里的示例不算命中，正是走 AST 而不是按行 grep 的理由（规则 79）。
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { trackedScriptFiles } from "../scripts/lib/scan-scope";
import { createChunkText, createOutputRing, headWithinBytes } from "../src/tools/output-ring";
import { read_file } from "../src/tools/read_file";
import type { ToolContext } from "../src/tools/base";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const replacementChar = String.fromCharCode(0xfffd); // 半个多字节序列解码后就长这样（源码里不留裸字符）
const oneCjkByte = Buffer.from("中", "utf8"); // E4 B8 AD

let ws = "";
const ctx = (): ToolContext => ({ workspace: ws, emit: async () => {} } as unknown as ToolContext);

beforeAll(async () => {
  ws = await mkdtemp(join(tmpdir(), "utf8-safety-"));
});
afterAll(async () => {
  await rm(ws, { recursive: true, force: true });
});

describe("跨 chunk 的解码（#55）", () => {
  it("累加器把一个汉字的三字节分开喂进来，出来必须还是那个汉字", () => {
    const acc = createChunkText();
    acc.push(oneCjkByte.subarray(0, 1));
    acc.push(oneCjkByte.subarray(1));
    expect(acc.text()).toBe("中");
    expect(acc.text()).not.toContain(replacementChar);
  });

  it("反向一侧：逐块 toString 的旧写法确实会留问号（否则上面那条是空载棘轮）", () => {
    const naive = oneCjkByte.subarray(0, 1).toString("utf8") + oneCjkByte.subarray(1).toString("utf8");
    expect(naive).toContain(replacementChar);
  });

  it("输出环（run_shell / verify 的入口）同样不许被 chunk 边界改写", () => {
    const ring = createOutputRing(1024);
    const payload = Buffer.from("结果：中文若干行".repeat(4), "utf8"); // 每行 8 个码位 = 24 字节
    const splitAt = 22; // 第 8 个字符（行）从第 21 字节起 ⇒ 22 是它的第 2 字节
    expect(payload.subarray(0, splitAt).toString("utf8")).toContain(replacementChar); // 前提：这一刀确实切进了字符中间
    ring.push(payload.subarray(0, splitAt));
    ring.push(payload.subarray(splitAt));
    expect(ring.read()).not.toContain(replacementChar);
    expect(ring.read()).toContain("结果：中文若干行");
  });
});

describe("字节帽的缝合处（#54）", () => {
  it("headWithinBytes：ASCII 逐字不变，中文退到完整码位", () => {
    expect(headWithinBytes("xxxxxxxxxx", 5)).toBe("xxxxx");
    expect(headWithinBytes("中中中", 7)).toBe("中中"); // 6 字节，第 3 个装不下
    expect(headWithinBytes("中中中", 8)).toBe("中中");
    expect(headWithinBytes("中中中", 9)).toBe("中中中");
  });

  it("真跑 read_file：50KB 帽落在汉字中间时输出里不许有半个字符", async () => {
    const line = "中".repeat(200); // 600 字节/行 ⇒ 51200 字节的帽必然切在某一行内部
    await writeFile(join(ws, "big.txt"), Array.from({ length: 400 }, () => line).join("\n") + "\n", "utf8");
    const r = await read_file.run({ path: "big.txt", limit: 400 }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("输出超过 50KB 上限"); // 前提：帽真的生效了（没生效就不测缝合处）
    expect(r.output).not.toContain(replacementChar);
  });

  it("对照：同一条 git 命令的补丁，交给模型的文本与一次解码的字节流必须逐字相同", async () => {
    // 这一条量的是 shipped 路径（`worktreeDiff`），不是形状断言；chunk 边界是否切到字符取决于内核缓冲，
    // 所以**不**把它当棘轮（棘轮在下一个 describe 里），只当一次现场见证。
    const repo = await mkdtemp(join(tmpdir(), "utf8-wt-"));
    const git = (args: string[]): void => { execFileSync("git", args, { cwd: repo }); };
    try {
      git(["init", "-q", "."]);
      git(["config", "user.email", "t@example.invalid"]);
      git(["config", "user.name", "t"]);
      await writeFile(join(repo, "seed.md"), "# seed\n", "utf8");
      git(["add", "seed.md"]);
      git(["commit", "-q", "-m", "seed"]);
      const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
      await writeFile(join(repo, "notes.md"), "中文行内容。\n".repeat(20000), "utf8");
      const { worktreeDiff } = await import("../src/agent/worktree");
      const shipped = await worktreeDiff(repo, base);
      const once = execFileSync("git", ["diff", base, "--", "notes.md"], { cwd: repo, maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
      expect(shipped.patch).not.toContain(replacementChar);
      expect(shipped.patch.trimEnd()).toBe(once.trimEnd());
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

/** 两类 hazards 的 AST 扫描（纯函数：喂源码文本，回 offenders，可自证）。 */
export function scanUtf8Hazards(path: string, text: string): string[] {
  const src = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const where = (n: ts.Node): string => path + ":" + String(src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1);
  const isUtf8Decode = (n: ts.Node): boolean =>
    ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
    n.expression.name.text === "toString" && n.arguments.length === 1 &&
    ts.isStringLiteral(n.arguments[0]!) && n.arguments[0]!.text === "utf8";
  const isStringCall = (n: ts.Node): boolean =>
    ts.isCallExpression(n) && ts.isIdentifier(n.expression) &&
    n.expression.text === "String" && n.arguments.length === 1;
  const isDataHandler = (n: ts.Node): n is ts.CallExpression =>
    ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
    n.expression.name.text === "on" && n.arguments.length >= 2 &&
    ts.isStringLiteral(n.arguments[0]!) && n.arguments[0]!.text === "data";

  const walkDataHandlers = (node: ts.Node): void => {
    if (isDataHandler(node)) {
      const cb = node.arguments[1]!;
      // 只认"把回调自己的那个 chunk 参数就地解码"这一种形状：
      // `String(数字)` 这类拼装消息、以及 `setEncoding("utf8")` 之后 `d` 已是字符串的直接拼接（ripgrep 走这条）
      // 都不该被抓——负控在下面的自证用例里，规则把安全写法也判红就是判据越界（规则 60/67）。
      const paramNames = new Set<string>();
      if (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) {
        for (const p of cb.parameters) if (ts.isIdentifier(p.name)) paramNames.add(p.name.text);
      }
      const visit = (inner: ts.Node): void => {
        if (ts.isCallExpression(inner)) {
          if (isUtf8Decode(inner) && ts.isPropertyAccessExpression(inner.expression) &&
            ts.isIdentifier(inner.expression.expression) && paramNames.has(inner.expression.expression.text)) {
            found.push(where(inner) + " 在 on(\"data\") 里把 chunk 逐块 toString(\"utf8\") ⇒ 跨块字符会变成问号，改用 createChunkText() 或输出环");
          }
          const firstArg = inner.arguments[0];
          if (isStringCall(inner) && firstArg !== undefined && ts.isIdentifier(firstArg) && paramNames.has(firstArg.text)) {
            found.push(where(inner) + " 在 on(\"data\") 里 String(chunk) ⇒ 同上（逐块独立解码）");
          }
        }
        ts.forEachChild(inner, visit);
      };
      ts.forEachChild(cb, visit);
    }
    ts.forEachChild(node, walkDataHandlers);
  };

  const walkByteNamedSlices = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "slice" && node.arguments.length === 2 &&
      node.arguments[0]!.getText(src) === "0" && ts.isIdentifier(node.arguments[1]!) &&
      /BYTES$/.test(node.arguments[1]!.getText(src))) {
      found.push(where(node) + " 按 *BYTES 命名的帽用字符串 slice 落实（切的是 UTF-16 字符）⇒ 用 headWithinBytes()，Buffer 请用 subarray()");
    }
    ts.forEachChild(node, walkByteNamedSlices);
  };

  src.statements.forEach((s) => { walkDataHandlers(s); walkByteNamedSlices(s); });
  return found;
}

describe("棘轮：这两类写法不许回到 src/ 的取料面上", () => {
  const files = trackedScriptFiles(ROOT, "src");

  it("收料清单非空（拿不到清单＝没有尺，不许读成干净）", () => {
    expect(files).not.toBeNull();
    expect((files ?? []).length).toBeGreaterThan(50);
  });

  // 桌面层（Electron 入口 / preload / renderer）按 AGENTS.md 已从本 checkout 移除，
  // 而删除尚未提交 ⇒ `git ls-files` 仍列着它们、盘上没有。这里按**根**豁免（不是按文件名抄一份清单），
  // 并要求"豁免之外的读不到"照样算 offender——否则覆盖率掉了没人知道（规则 70/79/105）。
  const REMOVED_ROOTS = ["src/main/index.ts", "src/preload/", "src/renderer/"];
  const isRemovedDesktopFace = (rel: string): boolean =>
    REMOVED_ROOTS.some((r) => (r.endsWith("/") ? rel.startsWith(r) : rel === r));

  it("盘上零命中：on(\"data\") 里就地解码 / 按 *BYTES 命名的帽用字符串 slice", () => {
    const offenders: string[] = [];
    let scanned = 0;
    let skippedDesktop = 0;
    for (const rel of files ?? []) {
      if (!existsSync(join(ROOT, rel))) {
        if (isRemovedDesktopFace(rel)) { skippedDesktop++; continue; }
        offenders.push(rel + " 读不到且不属于已移除的桌面层 ⇒ 判据无法覆盖这一面");
        continue;
      }
      scanned++;
      offenders.push(...scanUtf8Hazards(rel, readFileSync(join(ROOT, rel), "utf8")));
    }
    expect(offenders).toEqual([]);
    // 覆盖率自己也要有名字：三态里不许有"既不扫也不豁免"的第三格，而豁免了多少面要当场可算（规则 82）
    expect(scanned).toBeGreaterThan(50);
    expect(scanned + skippedDesktop).toBe((files ?? []).length);
  });

  it("自证：把本轮修掉的写法**修前原文**喂进去必须各报一条，安全写法必须不报", () => {
    const beforeWorktree = 'child.stdout?.on("data", (d: Buffer) => { stdout += String(d); });';
    const beforeReadFile = 'child.stderr?.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });';
    const beforeSlice = 'settle({ stdout: stdout.slice(0, OUTPUT_CAP_BYTES) });';
    expect(scanUtf8Hazards("worktree.ts", beforeWorktree)).toHaveLength(1);
    expect(scanUtf8Hazards("hooks.ts", beforeReadFile)).toHaveLength(1);
    expect(scanUtf8Hazards("worktree.ts", beforeSlice)).toHaveLength(1);
    // 修法形状自己不许被抓（否则棘轮把正确写法也判成红）
    expect(scanUtf8Hazards("worktree.ts", 'const t = createChunkText(); child.stdout?.on("data", (d: Buffer) => { t.push(d); });')).toEqual([]);
    expect(scanUtf8Hazards("lsp.ts", "return headWithinBytes(text, LSP_OUTPUT_LIMIT_BYTES);")).toEqual([]);
    // 负控（规则第一版在这里假红过，收窄成"只认回调自己的 chunk 参数"才是对的）：
    // `setEncoding("utf8")` 之后 d 已是字符串（Node 的解码器自己管边界），而 `String(数字)` 只是拼装消息。
    const rgShape = 'c.stdout.setEncoding("utf8"); c.stdout.on("data", (d: string) => { bytes += Buffer.byteLength(d); if (bytes > RG_OUTPUT_CAP_BYTES) killWith(String(RG_OUTPUT_CAP_BYTES / 1024)); });';
    expect(scanUtf8Hazards("ripgrep.ts", rgShape)).toEqual([]);
  });

  it("注释里的示例不算命中（这正是走 AST 不按行 grep 的理由）", () => {
    expect(scanUtf8Hazards("worktree.ts", '// 原先 `stdout.slice(0, OUTPUT_CAP_BYTES)` 切的是字符\nconst a = 1;')).toEqual([]);
  });
});
