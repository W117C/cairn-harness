// 项目外附件审批后的**本轮读取白名单**从 handleAgentRun 一路透传到工具上下文的接线判卷。
// 这里用真 read_file（不是假工具）验两件事：给了 grants 能读到批准的文件；
// 同样的绝对路径在没有 grants 时仍按旧口径拒绝（fail-closed 不因新通道变松）。
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLoop } from "../src/agent/loop";
import type { AgentEvent } from "../src/events";
import type { LoopOptions } from "../src/agent/loop";
import type { ModelOutput, Provider } from "../src/providers";

const roots: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** 第一轮发一次 read_file 调用，第二轮收束；把每次请求的 messages 留给人看。 */
function toolCallProvider(path: string, requests: unknown[]): Provider {
  return {
    async *stream(messages): AsyncGenerator<ModelOutput> {
      requests.push(messages);
      if (requests.length === 1) {
        yield { type: "tool_call", id: "read-external", name: "read_file", args: { path } };
      } else {
        yield { type: "assistant_message", content: "done" };
      }
    },
  };
}

async function runWith(options: {
  provider: Provider;
  externalReadGrants?: LoopOptions["externalReadGrants"];
}): Promise<AgentEvent[]> {
  const log: AgentEvent[] = [];
  await runLoop({
    events: { async append(event) { log.push(event); } },
    workspace: await tempRoot("dsh-loop-ws-"),
    userMessage: "read the approved attachment",
    ...options,
  });
  return log;
}

describe("loop externalReadGrants plumbing", () => {
  it("passes the approved external path through to the real read_file tool", async () => {
    const outside = await tempRoot("dsh-loop-out-");
    const file = join(outside, "approved.txt");
    await writeFile(file, "EXTERNAL_GRANT_CONTENT", "utf8");
    const requests: unknown[] = [];

    const log = await runWith({
      provider: toolCallProvider(file, requests),
      externalReadGrants: [{ path: await realpath(file), kind: "file" }],
    });

    const result = log.find((event) => event.type === "tool_result");
    expect(result).toMatchObject({ type: "tool_result", ok: true });
    expect(result && "output" in result ? result.output : "").toContain("EXTERNAL_GRANT_CONTENT");
  });

  it("keeps rejecting the same absolute path when no per-run grant is present", async () => {
    const outside = await tempRoot("dsh-loop-out-");
    const file = join(outside, "unapproved.txt");
    await writeFile(file, "SHOULD_NOT_LEAK", "utf8");
    const requests: unknown[] = [];

    const log = await runWith({ provider: toolCallProvider(file, requests) });

    const result = log.find((event) => event.type === "tool_result");
    expect(result).toMatchObject({ type: "tool_result", ok: false });
    const output = result && "output" in result ? result.output : "";
    expect(output).toContain("只允许 workspace 相对路径");
    expect(output).not.toContain("SHOULD_NOT_LEAK");
  });
});
