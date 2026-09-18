import { afterEach, beforeEach, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { ObservationLedger } from "../src/agent/ledger";
import { createActionFusion } from "../src/agent/action-fusion";

let root: string;
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(join(process.env.PI_SCRATCH_DIR!, "solpi-review-")));
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const source = { kind: "authorized-redacted-text" as const, text: "diagnostic\n".repeat(2000) };
const input = { toolName: "run_shell", callId: "c1", source };
const ledger = () => new ObservationLedger({ sessionDataDir: root, sessionId: "s1", enabled: true });

it("recovers an interrupted manifest temp under the lock after restart", async () => {
  const first = ledger();
  const old = (await first.archive(input))!;
  await fs.writeFile(join(first.directory, ".index.tmp"), "interrupted");
  const restarted = ledger();
  const next = (await restarted.archive({ ...input, callId: "c2" }))!;
  expect((await restarted.recall({ id: old.id })).text.length).toBeGreaterThan(0);
  expect((await restarted.recall({ id: next.id })).text.length).toBeGreaterThan(0);
  await expect(fs.stat(join(first.directory, ".index.tmp"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("does not follow a manifest temp symlink or steal a held lock", async () => {
  const store = ledger();
  await store.archive(input);
  const target = join(root, "target");
  await fs.writeFile(target, "untouched");
  await fs.symlink(target, join(store.directory, ".index.tmp"));
  await expect(store.archive({ ...input, callId: "c2" })).rejects.toMatchObject({ code: "ELOOP" });
  expect(await fs.readFile(target, "utf8")).toBe("untouched");
  await fs.writeFile(join(store.directory, ".lock"), "held");
  await expect(ledger().archive(input)).rejects.toMatchObject({ code: "EBUSY" });
});

for (const cancelAt of [0, 1, 2]) {
  it(`cancel at check stage ${cancelAt} preserves successful write but never reports all-success`, async () => {
    await fs.mkdir(join(root, ".agent"));
    await fs.writeFile(join(root, ".agent/config.json"), JSON.stringify({ verify: { lint: ["first", "second"] } }));
    await fs.writeFile(join(root, "target.txt"), "new content");
    const controller = new AbortController();
    let calls = 0;
    const fusion = createActionFusion(async (_command, _ctx, beforeExecute) => {
      calls++;
      if (calls === cancelAt) controller.abort();
      const denied = await beforeExecute();
      return denied ?? { ok: true, output: "checked" };
    });
    if (cancelAt === 0) controller.abort();
    const result = await fusion({ ok: true, output: "write succeeded" }, "target.txt", { workspace: root, signal: controller.signal });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("[fused_write:succeeded]");
    expect(result.output).toContain("[fused_lint:failed]");
    expect(await fs.readFile(join(root, "target.txt"), "utf8")).toBe("new content");
    expect(calls).toBe(cancelAt);
  });
}
