/** 第 330 页 · 事故复现读数（规则 248 那一族）：拿第 329 页留下的那份真实 tsc 原文
 *  （`outputs/text-readers-corpus-2026-10-03/typecheck-2.log`，隔壁在飞改动弄红的 4 条），
 *  分别喂「两档旧口径」与「四档新口径」，看同一份输入各自说什么。 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { triageTypecheck, triageVerdict } from "../../scripts/lib/typecheck-triage.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const text = readFileSync(join(ROOT, "outputs/text-readers-corpus-2026-10-03/typecheck-2.log"), "utf8");
const git = (args: string[]): Set<string> | null => {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return r.status !== 0 ? null : new Set((r.stdout ?? "").split("\n").filter((x) => x !== ""));
};
const untracked = git(["ls-files", "--others", "--exclude-standard"]) ?? new Set<string>();
const head = triageTypecheck(text, untracked, new Set<string>());
const dirty = git(["diff", "--name-only", "HEAD"]);
console.log("—— 旧口径的**分类**（把 dirty 传成空集＝所有 tracked 都算 HEAD；这正是第 329 页那句「HEAD 内 2 个」的来路）");
for (const l of triageVerdict(head)) console.log("  " + l);
console.log("—— 新口径（四档；报错文本是当时的、工作树集合是此刻的 ⇒ 落进哪一档看隔壁现在提没提交，本趟这两个文件仍在飞）");
for (const l of triageVerdict(triageTypecheck(text, untracked, dirty))) console.log("  " + l);
console.log("—— 造一格「在飞 tracked」（把报错文件强行标脏）看新口径怎么说");
const files = [...head.head, ...head.scratch];
const forced = new Set(files.length > 0 ? [files[0]!] : []);
for (const l of triageVerdict(triageTypecheck(text, untracked, forced))) console.log("  " + l);
