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
  for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function waitForUrl(getStderr: () => string): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const match = getStderr().match(/listening (http:\/\/[^\s（]+)/u);
    if (match?.[1] !== undefined) return match[1];
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error("a2a-server URL not announced; stderr=" + getStderr());
}

describe("a2a-server CLI", () => {
  it("serves a real product runtime and exits cleanly on SIGINT", async () => {
    const root = await mkdtemp(join(tmpdir(), "a2a-cli-"));
    roots.push(root);
    const workspace = join(root, "ws");
    await mkdir(join(workspace, ".agent"), { recursive: true });
    await writeFile(join(workspace, ".agent", "settings.json"), JSON.stringify({ provider: "demo", model: "" }), "utf8");
    const script = join(root, "main.jsonl");
    await writeFile(script, JSON.stringify({ type: "assistant_message", content: "hello a2a cli" }) + "\n", "utf8");
    const env: NodeJS.ProcessEnv = { ...process.env, M3A_MAIN_SCRIPT: script };
    for (const key of ["M3A_AGENTS_DEMO", "M1B_GATE_FLOW", "M1C_AUTONOMY_SCRIPT", "M0A_PROVIDER", "M0B_WORKSPACE", "CAIRN_MODEL"]) {
      delete env[key];
    }
    const child = spawn(process.execPath, [
      "--import", "tsx", join(ROOT, "scripts", "a2a-server.ts"),
      "--workspace", workspace, "--port", "0",
    ], { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"] });
    children.push(child);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    const url = await waitForUrl(() => stderr);

    const send = await fetch(url + "/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: { message: { role: "user", messageId: "m1", taskId: "task-a2a-cli", parts: [{ kind: "text", text: "say hello" }] } },
      }),
    });
    expect(send.status).toBe(200);

    let state = "";
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const got = await fetch(url + "/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tasks/get", params: { id: "task-a2a-cli" } }),
      });
      const body = await got.json() as { result?: { status?: { state?: string }; artifacts?: Array<{ parts?: Array<{ text?: string }> }> } };
      state = body.result?.status?.state ?? "";
      if (state === "completed") {
        expect(body.result?.artifacts?.[0]?.parts?.[0]?.text).toContain("hello a2a cli");
        break;
      }
      await new Promise((done) => setTimeout(done, 20));
    }
    expect(state).toBe("completed");

    child.kill("SIGINT");
    await new Promise<void>((done, fail) => {
      child.once("exit", (code) => { if (code === 0) done(); else fail(new Error("a2a-server exit " + String(code) + "\n" + stderr)); });
    });
  }, 60_000);
});
