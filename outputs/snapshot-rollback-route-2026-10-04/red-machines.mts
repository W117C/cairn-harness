// 造红机（在本仓的 detached 验证树里跑，不碰主树）：三台各改一处生产写法，期望红在**不同**用例上。
// 每台：cp 备份 ⇒ 断言针脚恰好命中 1 次才改 ⇒ 跑判卷取汇总 ⇒ cp 复原 ⇒ cmp 逐字节校验。
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sameBytes = (a: string, b: string): boolean => readFileSync(a).equals(readFileSync(b));

const ROOT = process.cwd();
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/gu, "");
const runSuite = (): { failed: number; passed: number } => {
  try {
    const out = strip(execFileSync("node", ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", "tests/snapshot-rollback-route.test.ts"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    const m = out.match(/Tests\s+(?:(\d+) failed \| )?(\d+) passed/u);
    return { failed: m?.[1] === undefined ? 0 : Number(m[1]), passed: m?.[2] === undefined ? 0 : Number(m[2]) };
  } catch (e) {
    const out = strip(String((e as { stdout?: string }).stdout ?? "") + String((e as { stderr?: string }).stderr ?? ""));
    const m = out.match(/Tests\s+(?:(\d+) failed \| )?(\d+) passed/u);
    if (m === null) return { failed: -1, passed: -1 };
    return { failed: m[1] === undefined ? 0 : Number(m[1]), passed: m[2] === undefined ? 0 : Number(m[2]) };
  }
};

const machines = [
  { name: "M1 回执退回旧文案（只给路径不出声）", file: "src/tools/snapshot.ts",
    old: '"（按字节抄的；要逐字节取回请复制该文件——read_file 的交付不保留末行换行、并有行/字节帽，别用它转写复原）"', neu: '""' },
  { name: "M3 摘掉二进制拒读闸", file: "src/tools/read_file.ts",
    old: "if (looksBinary(buf)) {", neu: "if (false) {" },
  { name: "M4 把单行帽抬到不切（假装长行读得全）", file: "src/tools/read_file.ts",
    old: "const MAX_LINE_CHARS = 2000;", neu: "const MAX_LINE_CHARS = 100000;" },
];

const touched = [...new Set(machines.map((m) => m.file))];
for (const f of touched) copyFileSync(join(ROOT, f), join(ROOT, f + ".prebak"));

for (const m of machines) {
  const abs = join(ROOT, m.file);
  const src = readFileSync(abs, "utf8");
  const hits = src.split(m.old).length - 1;
  if (hits !== 1) {
    console.log(m.name + " ⇒ 针脚命中 " + String(hits) + " 次，跳过（不改）");
    continue;
  }
  writeFileSync(abs, src.replace(m.old, m.neu), "utf8");
  const r = runSuite();
  writeFileSync(abs, src, "utf8");
  const same = sameBytes(abs, join(ROOT, m.file + ".prebak"));
  console.log(m.name + " ⇒ 红 " + String(r.failed) + " 条／绿 " + String(r.passed) + " 条；复原逐字节一致=" + String(same));
}

for (const f of touched) rmSync(join(ROOT, f + ".prebak"), { force: true });
console.log("残骸：" + execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim().replace(/\n/gu, " | "));
