import { mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GATES } from "/Users/ze/Downloads/Cairn/deepseek harness/scripts/gate-manifest.ts";
import { ModuleRegistry } from "/Users/ze/Downloads/Cairn/deepseek harness/src/main/evolution/registry.ts";
import { activeContentPackNote } from "/Users/ze/Downloads/Cairn/deepseek harness/src/main/evolution/activation-host.ts";

const root = await mkdtemp(join(tmpdir(), "evo-rebuild-"));
const GATE_SET = new Set(GATES);

// 1) TCB 侧注册一个 content-pack（真名单校验通过 ⇒ 账本里留下合法的 register 行）
const dir = join(root, "modules", "staging", "content-pack.demo", "0.1.0");
await mkdir(dir, { recursive: true });
await writeFile(join(dir, "manifest.json"), JSON.stringify({
  id: "content-pack.demo", version: "0.1.0", kind: "content-pack", entry: "index.ts",
  deps: [], permissions: [], gates: ["typecheck"],
}), "utf8");
await writeFile(join(dir, "prompt.md"), "PACK PROMPT\n", "utf8");
await writeFile(join(dir, "index.ts"), "export const v = 1;\n", "utf8");

const reg = new ModuleRegistry(root, { knownGates: GATE_SET });
await reg.registerStaged("content-pack.demo", "0.1.0", "evo-pipeline");
await reg.recordGate("content-pack.demo", "0.1.0", "typecheck", true, "gate-runner");
const { Installer } = await import("/Users/ze/Downloads/Cairn/deepseek harness/src/main/evolution/installer.ts");
await new Installer(reg).installStaged({ id: "content-pack.demo", version: "0.1.0", actor: "human", grants: new Set() });

console.log("A) 索引新鲜 ⇒ 生产读面：", JSON.stringify(await activeContentPackNote(root)));

// 2) 模拟「append 已成功、index 落盘前进程被杀」⇒ 索引与日志对不上 ⇒ 下次读必须重建
await rm(join(root, "modules", "registry.index.json"), { force: true });
console.log("B) 索引已删 ⇒ 触发重建路径：");
try {
  const note = await activeContentPackNote(root);
  console.log("   ⇒ 返回：", JSON.stringify(note), "（没报错）");
} catch (err) {
  console.log("   ⇒ 抛错：", (err as Error).name, "|", (err as Error).message);
}

// 3) canary 收束面同一条读路
try {
  const { tickCanaryFromSignals } = await import("/Users/ze/Downloads/Cairn/deepseek harness/src/main/evolution/activation-host.ts");
  const ticks = await tickCanaryFromSignals(root, { runId: "r1", verifyOutcome: "green", costMeasurable: false, tokensPerBoundary: null, spendAfterLastBoundary: 0 } as never, "s1");
  console.log("C) canary 收束 tick ⇒", JSON.stringify(ticks));
} catch (err) {
  console.log("C) canary 收束 tick ⇒ 抛错：", (err as Error).name, "|", (err as Error).message);
}
await rm(root, { recursive: true, force: true });
