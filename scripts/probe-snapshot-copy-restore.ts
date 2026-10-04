// 复现器：`snapshotNote` 那句「要逐字节取回请复制该文件」到底做不做得到。
// 由 `scripts/probe-promise-recall.ts` 的 `hopSnapshotNote` 起（登记表里这一面的判定），
// 判卷 `tests/snapshot-rollback-route.test.ts` 钉的是路由形状，本脚本钉的是**承诺本身**：
//   ① 复制这条路由必须逐字节复原（含末行换行、含超 2000 字符的长行——正是 read_file 会切的那两种）；
//   ② 反证不能省：同一份快照经 `read_file` 转写回来必须**不等于**原件，否则这句提示就是白写的装饰。
// 任何一条不成立 ⇒ 退非 0（登记成"有判定"却没判过，比缺登记更难发现——规则 366 那一族）。
import { copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { read_file } from "../src/tools/read_file";
import { write_file } from "../src/tools/write_file";

let failures = 0;
const check = (cond: boolean, label: string, detail = ""): void => {
  console.log((cond ? "  ✅ " : "  ❌ ") + label + (detail === "" ? "" : " — " + detail));
  if (!cond) failures++;
};

async function main(): Promise<void> {
  const ws = await realpath(await mkdtemp(join(tmpdir(), "dsh-snap-restore-")));
  const cases: Array<{ name: string; rel: string; content: string }> = [
    { name: "普通文本（带末行换行）", rel: "src/a.ts", content: "export const a = 1;\n\nexport default a;\n" },
    { name: "单行超 read_file 的行帽（压缩产物那一类）", rel: "dist/b.js", content: "var x=\"" + "A".repeat(4000) + "\";\n" },
  ];

  for (const c of cases) {
    await mkdir(join(ws, c.rel.split("/").slice(0, -1).join("/")), { recursive: true });
    await writeFile(join(ws, c.rel), c.content, "utf8");
    const bad = await write_file.run({ path: c.rel, content: "覆盖掉了\n" }, { workspace: ws, callId: c.name });
    const snapId = bad.snapshotId as string;
    check(typeof snapId === "string", c.name + "：覆盖必须落快照");
    check(String(bad.output).includes("覆盖前原件已存"), c.name + "：回执必须给出那条路径");

    // ① 承诺的那条路：复制。
    await copyFile(join(ws, snapId), join(ws, c.rel));
    const restored = await readFile(join(ws, c.rel), "utf8");
    check(restored === c.content, c.name + "：复制回写必须逐字复原",
      "字节 " + String(Buffer.byteLength(restored, "utf8")) + " vs 原件 " + String(Buffer.byteLength(c.content, "utf8")) + " 字节");

    // ② 反证：read_file 转写不逐字（否则那句提示没必要存在）。
    const back = await read_file.run({ path: snapId }, { workspace: ws, callId: "probe" });
    const delivered = String(back.output).replace(/\n\[[^\n]*\]\s*$/u, "");
    check(delivered !== c.content, c.name + "：read_file 交付确实不等于原件（这才是让人复制的理由）",
      "交付 " + String(delivered.length) + " 字符 vs 原件 " + String(c.content.length) + " 字符");
  }

  // ③ 快照按字节抄：二进制原件也能靠复制复原（read_file 在这一格直接拒读）。
  const binRel = "assets/logo.png";
  await mkdir(join(ws, "assets"), { recursive: true });
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 0, 255]);
  await writeFile(join(ws, binRel), bytes);
  const binBad = await write_file.run({ path: binRel, content: "text now\n" }, { workspace: ws, callId: "bin" });
  await copyFile(join(ws, binBad.snapshotId as string), join(ws, binRel));
  check((await readFile(join(ws, binRel))).equals(bytes), "二进制：复制同样逐字节复原（read_file 在这一格直接拒读）");
}

await main();
console.log(failures > 0 ? "[snapshot-copy-restore] ❌ " + String(failures) + " 项不成立" : "[snapshot-copy-restore] 全部成立");
process.exit(failures > 0 ? 1 : 0);
