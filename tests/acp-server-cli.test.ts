import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const roots: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

afterAll(async () => {
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

interface Frame {
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string };
  method?: string;
  params?: unknown;
}

function framesOf(child: ChildProcessWithoutNullStreams): { frames: Frame[]; waitFor: (pred: (frames: Frame[]) => boolean) => Promise<void> } {
  const frames: Frame[] = [];
  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line !== "") frames.push(JSON.parse(line) as Frame);
    }
  });
  return {
    frames,
    waitFor: async (pred) => {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (pred(frames)) return;
        await new Promise((done) => setTimeout(done, 10));
      }
      throw new Error("ACP frame not received; frames=" + JSON.stringify(frames));
    },
  };
}

describe("acp-server CLI", () => {
  it("serves a real handleAgentRun session over stdio", async () => {
    const root = await mkdtemp(join(tmpdir(), "acp-cli-"));
    roots.push(root);
    const workspace = join(root, "ws");
    await mkdir(join(workspace, ".agent"), { recursive: true });
    await writeFile(join(workspace, ".agent", "settings.json"), JSON.stringify({ provider: "demo", model: "" }), "utf8");
    const script = join(root, "main.jsonl");
    await writeFile(script, JSON.stringify({ type: "assistant_message", content: "hello over ACP" }) + "\n", "utf8");

    const env: NodeJS.ProcessEnv = { ...process.env, M3A_MAIN_SCRIPT: script };
    for (const key of ["M3A_AGENTS_DEMO", "M1B_GATE_FLOW", "M1C_AUTONOMY_SCRIPT", "M0A_PROVIDER", "M0B_WORKSPACE", "CAIRN_MODEL"]) {
      delete env[key];
    }
    const child = spawn(process.execPath, [
      "--import", "tsx", join(ROOT, "scripts", "acp-server.ts"),
      "--workspace", workspace, "--mode", "read-only",
    ], { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"] });
    children.push(child);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    const { frames, waitFor } = framesOf(child);

    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } }) + "\n");
    await waitFor((list) => list.some((f) => f.id === 1));
    expect(frames.find((f) => f.id === 1)?.result).toMatchObject({ protocolVersion: 1 });

    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: workspace } }) + "\n");
    await waitFor((list) => list.some((f) => f.id === 2));
    const sessionId = (frames.find((f) => f.id === 2)?.result as { sessionId?: string } | undefined)?.sessionId;
    expect(sessionId).toBeDefined();

    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "session/prompt",
      params: { sessionId, prompt: [{ type: "text", text: "hello" }] },
    }) + "\n");
    await waitFor((list) => list.some((f) => f.id === 3));
    expect(frames.find((f) => f.id === 3)?.result).toEqual({ stopReason: "end_turn" });
    const chunks = frames.filter((f) => f.method === "session/update")
      .map((f) => (f.params as { update?: { content?: { text?: string } } }).update?.content?.text ?? "");
    expect(chunks.join("")).toContain("hello over ACP");

    child.stdin.end();
    await new Promise<void>((done, fail) => {
      child.once("exit", (code) => { if (code === 0) done(); else fail(new Error("acp-server exit " + String(code) + "\n" + stderr)); });
    });
  }, 60_000);
});
