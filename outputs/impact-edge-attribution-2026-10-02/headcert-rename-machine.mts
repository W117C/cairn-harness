// 第 305 页第 6 段②的**造红台**：证明「改一条判卷用例的标题」会让隔壁那把同分母尺红，
// 而不是只留一句"我改过标题所以它红了"（那是一句没有证人的话）。
//
// 为什么不能直接留第一次的读数：那次 `取不到成因=1` 打印在会话里、没落盘，而 `headcert-notresolved.log`
// 是**退回标题之后**的那一份（=0）。两态要有两份可重跑的日志，否则"改之前会红"这一半就只能靠记忆。
//
// 形状＝备份 → 只改那一行 → 跑 §6② 那支探针 → **用备份**复原 → `cmp` 逐字节核（绝不用 `git checkout --`：
// 这个文件里还有本笔其它改动，那是别人的在飞面，抹不得）。
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const TARGET = join(ROOT, "tests/impact-persistence.test.ts");
const PROBE = join(ROOT, "outputs/impact-edge-attribution-2026-10-02/headcert-notresolved-probe.mts");
const HEAD_TITLE = '  it("⑨ artifact 字段齐全：schemaVersion=1、commitSha=真 sha、files/defs/refs/edges/fingerprints 与图对得上", async () => {';
const RENAMED = '  it("⑨ artifact 字段齐全：schemaVersion 与常量一致、commitSha=真 sha、files/defs/refs/edges/nameSources/attribution/fingerprints 与图对得上", async () => {';

function runProbe(): string {
  try {
    return execFileSync("node", ["--import", "tsx", PROBE], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
  } catch (err) {
    return "（探针抛错）\n" + String(err.stdout ?? "") + String(err.stderr ?? "");
  }
}

const bak = "/tmp/dsh-305-rename-machine-" + TARGET.split("/").pop() + ".bak";
const src = readFileSync(TARGET, "utf8");
const hits = src.split(HEAD_TITLE).length - 1;
console.log(`# 备份：${bak}（复原一律用它，不用 git checkout）`);
copyFileSync(TARGET, bak);
console.log(`# 针脚（HEAD 那行标题）命中=${String(hits)} 处 —— 要求恰好 1`);
if (hits !== 1) {
  console.log("❌ 标题行不唯一或找不到 ⇒ 这台不作证据，跳过（不动文件）");
  rmSync(bak, { force: true });
  process.exit(1);
}
writeFileSync(TARGET, src.replace(HEAD_TITLE, RENAMED), "utf8");
const mutated = readFileSync(TARGET, "utf8");
console.log(`# 改成"新标题"之后跑 §6② 那支探针：`);
console.log(mutated.includes(RENAMED) ? "  改法落地 ✅" : "  ❌ 没落地，下面的读数无意义");
process.stdout.write(runProbe().replace(/^/gmu, "  "));
copyFileSync(bak, TARGET);
const restored = readFileSync(TARGET, "utf8") === readFileSync(bak, "utf8");
console.log(`# 复原：${restored ? "与备份逐字节一致 ✅" : "❌ 不一致（残骸！）"}`);
console.log(`# 退回原状后再跑同一支探针：`);
process.stdout.write(runProbe().replace(/^/gmu, "  "));
rmSync(bak, { force: true });
console.log(`# 备份已清（残骸=${restored ? "0" : "有"}）`);
process.exit(restored ? 0 : 1);
