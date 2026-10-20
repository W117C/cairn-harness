// registry.jsonl 的**尾部半写行**不许把注册表永久打死（2026-10-19 独立评审追出）。
//
// 缺陷形状：进程被硬杀在单次 append 中途 ⇒ 文件尾留下**半条 JSON**。旧实现让重建当场抛
// （`parseEventLine` 的坏行 ⇒ RegistryLogCorruptError）⇒ **每次重建都撞同一行** ⇒
// 注册表**永久打不开**。而 canary 的回滚正是走这条 ⇒ 退化的版本就一直装着退不下来。
//
// 修法（同 src/events/log.ts 的 repairPartialTail 口径）：
//  · **尾部**半写（文件不以换行结尾、且最后一行解析失败）⇒ 这一行**从未成行**（读者本来
//    也看不见它）⇒ 裁掉未成行的字节、响亮告警、把 journal 截回最后一条完整行；
//  · **中段**的坏行不走这一支：那是另一类事故（数据丢失），必须当场抛，不许被安静地抹掉。
import { mkdtemp, rm, writeFile, mkdir, appendFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ModuleRegistry } from "../src/main/evolution/registry";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }).catch(() => {});
});

interface Fx { root: string; registry: ModuleRegistry; logPath: string }

async function fixture(): Promise<Fx> {
  const root = await mkdtemp(join(tmpdir(), "reg-torn-"));
  dirs.push(root);
  const modulesDir = join(root, "modules");
  await mkdir(modulesDir, { recursive: true });
  const registry = new ModuleRegistry(root, { knownGates: new Set(["typecheck"]) });
  return { root, registry, logPath: join(modulesDir, "registry.jsonl") };
}

/** 用**注册表自己的 API** 登记一版（事件形状与生产一致，不手搓 JSON）。 */
async function register(registry: ModuleRegistry, root: string, id: string, version: string): Promise<void> {
  const dir = join(root, "modules", "staging", id, version);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "manifest.json"),
    JSON.stringify({ id, version, kind: id.split(".")[0]!, entry: "index.ts", deps: [], permissions: [], gates: ["typecheck"] }),
    "utf8",
  );
  await writeFile(join(dir, "index.ts"), "export const v = 1;\n", "utf8");
  await registry.registerStaged(id, version, "tester");
  await registry.recordGate(id, version, "typecheck", true, "tester");
  await registry.activate(id, version, "tester");
}

describe("registry.jsonl 尾部半写行（不许永久打死注册表）", () => {
  it("★尾部半写 ⇒ 重建成功（裁掉未成行的字节），且前面的好事件仍然在账上", async () => {
    const fx = await fixture();
    await register(fx.registry, fx.root, "tool.demo-fetch", "0.1.0");
    // 模拟硬杀在写中途：尾部留下半条 JSON（**不以换行结尾**）
    await appendFile(fx.logPath, '{"op":"register","ts":"2026-10-19T00:00:0', "utf8");
    // 索引与日志不再对账（大小变了）⇒ 走重建
    const index = await fx.registry.rebuildIndex();
    expect(index.bundles["tool.demo-fetch"], "半写行把整条好事件也带走了").toBeDefined();
    expect(index.bundles["tool.demo-fetch"]!.active?.version).toBe("0.1.0");
    expect(index.bundles["tool.demo-fetch"]!.active?.version).toBe("0.1.0");
    // 未成行的字节已被裁掉（journal 回到最后一条完整行）
    const raw = await readFile(fx.logPath, "utf8");
    expect(raw.endsWith("\n"), "journal 仍以半行收尾 ⇒ 下一次追加会把它拼成坏行").toBe(true);
    expect(raw).not.toContain("2026-10-19T00:00:0\n");
  });

  it("中段的坏行 ⇒ 仍然当场抛（不许被「裁尾」这一支安静地抹掉）", async () => {
    const fx = await fixture();
    await register(fx.registry, fx.root, "tool.demo-fetch", "0.1.0");
    await appendFile(fx.logPath, "{ 这不是一行 JSON\n", "utf8");
    // 中段坏行 ⇒ 下一次读索引就当场抛（不许被「裁尾」那一支安静地抹掉）
    await expect(fx.registry.rebuildIndex()).rejects.toThrow();
  });

  it("尾行**完整**但没以换行收尾 ⇒ 补换行隔离（否则下一次追加把它拼成坏行）", async () => {
    const fx = await fixture();
    await register(fx.registry, fx.root, "tool.demo-fetch", "0.1.0");
    const raw = await readFile(fx.logPath, "utf8");
    await writeFile(fx.logPath, raw.slice(0, -1), "utf8"); // 去掉末尾换行
    // 再登记一版 ⇒ 追加前必须补换行（否则两行被拼成一条坏行）
    await register(fx.registry, fx.root, "tool.other", "0.1.0");
    const after = await readFile(fx.logPath, "utf8");
    // 判据是"每行都还是一条合法事件"（没被拼成一条坏行），不是行数
    for (const l of after.split("\n").filter((x) => x.trim() !== "")) {
      expect(() => JSON.parse(l), "有一行被拼坏了（半行 + 完整行）").not.toThrow();
    }
    const index = await fx.registry.rebuildIndex();
    expect(index.bundles["tool.demo-fetch"]).toBeDefined();
    expect(index.bundles["tool.other"]).toBeDefined();
  });
});
