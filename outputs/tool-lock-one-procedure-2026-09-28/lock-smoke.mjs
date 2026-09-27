// 冒烟读数（不进仓）：mutate-verify 的锁在四条入口上各是什么形状。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = "/Users/ze/Downloads/deepseek harness";
const SCRIPT = join(ROOT, "scripts", "mutate-verify.mjs");
const common = process.env.P1 ?? "";
const LOCK_DIR = join(resolve(ROOT, common.trim()), "dsh-tool-locks");
const LOCK_AT = join(LOCK_DIR, "mutate-verify-deepseek_harness.lock");
const run = (args) => {
  const r = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
};
const bakCount = () => {
  let n = 0;
  for (const rel of ["scripts", "src", "tests"]) {
    const walk = (d, depth) => {
      if (depth > 3) return;
      let ents = [];
      try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (e.name.endsWith(".mutbak")) n++;
      }
    };
    walk(join(ROOT, rel), 0);
  }
  return n;
};

const clear = () => { try { unlinkSync(LOCK_AT); } catch { /* 本来就没有 */ } };
clear();
const a = run(["--list"]);
console.log("① --list            status=" + String(a.status) + " 行数=" + String(a.out.split("\n").filter((l) => l.includes("\t")).length) + " 含「锁=」=" + String(a.out.includes("锁=")) + " 锁文件在=" + String(existsSync(LOCK_AT)));
const b = run(["bogus-id-not-existing"]);
console.log("② 无锁+bogus id     status=" + String(b.status) + " 未知id=" + String(b.out.includes("未知 id")) + " 占用=" + String(b.out.includes("正被占用")) + " cell=" + (b.out.match(/锁=(.+)/) || ["", "?"])[1]);
mkdirSync(LOCK_DIR, { recursive: true });
writeFileSync(LOCK_AT, JSON.stringify({ tool: "mutate-verify", pid: process.pid, target: "deadbeefdeadbeef", tree: ROOT, startedAt: Date.now() }));
const c = run(["bogus-id-not-existing"]);
console.log("③ 活人锁+bogus id   status=" + String(c.status) + " 未知id=" + String(c.out.includes("未知 id")) + " 占用=" + String(c.out.includes("正被占用")) + " 点名pid=" + String(c.out.includes(String(process.pid))) + " 没替别人删=" + String(existsSync(LOCK_AT)) + " .mutbak=" + String(bakCount()));
const d = run(["--check-needles"]);
console.log("④ 活人锁+只读体检   status=" + String(d.status) + " 占用=" + String(d.out.includes("正被占用")) + " 汇总=" + (d.out.split("\n").filter((l) => l.includes("mutate-needles-check")).join(" / ") || "无"));
clear();
console.log("⑤ 复原：锁文件在=" + String(existsSync(LOCK_AT)));
