import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { relative } from "node:path";
import { loadVerifyConfig } from "./verify";
import { assertNotAgentArea, assertRealContainment, resolveInWorkspace, type ToolContext, type ToolResult } from "../tools/base";

/** Internal callback only: the runner MUST recheck immediately after shell approval. */
export type FusionShell = (command: string, ctx: ToolContext, beforeExecute: () => Promise<ToolResult | null>) => Promise<ToolResult>;

/** Conservative snapshot: resolve every time, reject symlink escapes/system paths, open without following
 * the final symlink, and bound reads. This is a stale-content guard, not an OS-level file lock. */
async function snapshot(workspace: string, path: string): Promise<string> {
  const abs = resolveInWorkspace(workspace, path, "fused_lint");
  assertNotAgentArea(path, "fused_lint");
  const root = await realpath(workspace);
  const target = await realpath(abs);
  await assertRealContainment(root, target, "fused_lint");
  assertNotAgentArea(relative(root, target), "fused_lint");
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error("unsafe or oversized file");
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) throw new Error("oversized file");
      hash.update(chunk);
    }
    return `${target}:${stat.dev}:${stat.ino}:${hash.digest("hex")}`;
  } finally {
    await file.close();
  }
}

/** One instance per main run, never installed in workers; independent from verify.maxAttempts. */
export function createActionFusion(runShell: FusionShell) {
  let attempts = 0;
  return async (write: ToolResult, path: unknown, ctx: ToolContext): Promise<ToolResult> => {
    if (!write.ok) return write; // No config reads, hashing or commands after a failed write.
    const finish = (status: "succeeded" | "failed" | "skipped", detail: string): ToolResult => ({
      ...write,
      ok: status !== "failed",
      // 结构化事实给 loop：落盘已经发生，lint 的成败不改变这一点。
      fusedWrite: true,
      output: `${write.output}\n\n[fused_write:succeeded] File changes persist; lint does not roll them back.\n[fused_lint:${status}]\n${detail}`,
    });
    const skipped = (reason: string) => finish("skipped", reason);
    if (ctx.signal?.aborted) return finish("failed", "cancelled before lint");
    if (attempts >= 3) return skipped("independent lint attempt limit (3) reached");
    let initial: string;
    try {
      if (typeof path !== "string") return skipped("missing write path");
      initial = await snapshot(ctx.workspace, path);
      await setImmediate();
      if (initial !== await snapshot(ctx.workspace, path)) return skipped("content changed after write");
    } catch {
      return skipped("content guard unavailable or unsafe path");
    }
    const beforeExecute = async (): Promise<ToolResult | null> => {
      if (ctx.signal?.aborted) return { ok: false, output: "cancelled before lint" };
      try {
        if (initial === await snapshot(ctx.workspace, path as string)) return null;
      } catch { /* Fail closed if deleted/replaced/redirected during approval. */ }
      return { ok: false, output: "content changed or unsafe path before lint" };
    };
    try {
      // Only project configuration/probed scripts; never model params or plan.verify.
      const { config } = await loadVerifyConfig(ctx.workspace);
      const commands = config.lint ?? [];
      if (commands.length === 0) return skipped("no configured lint commands");
      const stale = await beforeExecute();
      if (stale) return ctx.signal?.aborted ? finish("failed", stale.output) : skipped(stale.output);
      attempts++;
      const results: string[] = [];
      for (const command of commands) {
        let guarded = false;
        const result = await runShell(command, ctx, async () => {
          const rejection = await beforeExecute();
          guarded = rejection !== null;
          return rejection;
        });
        results.push(`[lint_command:${result.ok ? "succeeded" : "failed"}] ${command}\n${result.output}`);
        if (!result.ok) return finish(guarded && !ctx.signal?.aborted ? "skipped" : "failed", results.join("\n\n"));
        if (ctx.signal?.aborted) return finish("failed", results.join("\n\n") + "\nCancelled during lint; checks incomplete.");
      }
      return finish("succeeded", results.join("\n\n"));
    } catch (err) {
      return finish("failed", `Lint configuration/execution failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
