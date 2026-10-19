import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { closeAllLspClients, getLspClient, loadLspConfig, setLspTrustedRepos } from "../src/tools/lsp";

const stubUrl = pathToFileURL(join(process.cwd(), "fixtures/lsp/stub-server.mjs")).href;
const dirs: string[] = [];
afterEach(async () => {
  await closeAllLspClients();
  setLspTrustedRepos([]);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "lsp-argv-"));
  dirs.push(dir);
  await mkdir(join(dir, ".agent"));
  await mkdir(join(dir, "bin"));
  const wrapper = join(dir, "bin/argv-server.mjs");
  const record = join(dir, "argv.json");
  await writeFile(wrapper, [
    'import { readFileSync, writeFileSync } from "node:fs";',
    'const args = process.argv.slice(2);',
    'const payload = args.includes("--read-input") ? readFileSync(args.at(-1), "utf8") : null;',
    `writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args, cwd: process.cwd(), payload }));`,
    `await import(${JSON.stringify(stubUrl)});`,
  ].join("\n"));
  const start = async (args: string[]) => {
    await writeFile(join(dir, ".agent/lsp.json"), JSON.stringify({ lsp: { fixture: { command: process.execPath, args, extensions: [".fixture"] } } }));
    setLspTrustedRepos([dir]);
    const client = await getLspClient(dir, loadLspConfig(dir), "fixture");
    // 真 initialize 与请求都要通，不能只把 argv 写下来就当语言服务启动成功。
    expect(await client.request("workspace/symbol", { query: "" })).toEqual([]);
    return JSON.parse(await readFile(record, "utf8")) as { args: string[]; cwd: string; payload: string | null };
  };
  return { dir, wrapper, start };
}

describe("LSP 参数遵守原生命令行 argv 语义", () => {
  it.each([
    { label: "子命令", args: ["serve", "stdio"] },
    { label: "选项值与数字", args: ["--mode", "debug", "--port", "0"] },
    { label: "空格、Unicode、空参数与字面变量", args: ["--label", "两个 words", "", "$HOME"] },
    { label: "URI", args: ["--root-uri", "file:///tmp/source.ts?rev=1"] },
  ])("$label 原样抵达进程，不被当成文件路径", async ({ args }) => {
    const s = await setup();
    const record = await s.start([s.wrapper, ...args]);
    expect(record.args).toEqual(args);
    expect(record.cwd).toBe(await realpath(s.dir));
  });

  it("相对脚本和相对文件参数由 cwd 正确解析，参数文本仍保持原样", async () => {
    const s = await setup();
    await mkdir(join(s.dir, "data"));
    await writeFile(join(s.dir, "data/input.txt"), "workspace input");
    const args = ["--read-input", "data/input.txt"];
    const record = await s.start(["bin/argv-server.mjs", ...args]);
    expect(record.args).toEqual(args);
    expect(record.payload).toBe("workspace input");
    expect(record.cwd).toBe(await realpath(s.dir));
  });

  it("node -e 的代码参数可执行，不被加上工作区路径", async () => {
    const s = await setup();
    const expression = `import(${JSON.stringify(pathToFileURL(s.wrapper).href)})`;
    const record = await s.start(["-e", expression]);
    expect(record.args).toEqual([]);
    expect(record.cwd).toBe(await realpath(s.dir));
  });

  it.each([true, false])("已有 flag 参数保持原样，脚本使用绝对路径=%s 时也可启动", async (absolute) => {
    const s = await setup();
    const args = ["--stdio", "--node-ipc", "--log-level=debug"];
    const record = await s.start([absolute ? s.wrapper : "bin/argv-server.mjs", ...args]);
    expect(record.args).toEqual(args);
    expect(record.cwd).toBe(await realpath(s.dir));
  });
});
