/** 针脚体检的本地预跑：新加的 8 条变异锚点，各自的 needle 在被改文件里必须**恰好命中一次**。
 *  为什么单独一个探针而不是等 `--check-needles`：那条门要 6 秒且会把别人的在飞文本一起报，
 *  而这里只想在落笔前确认「我这几根针钉的位置是不是唯一的」（规则 223：针脚体检先于交笔）。
 *  用法：`node --import tsx outputs/cert-tree-lock-2026-09-27/needles.mts` */
import { readFileSync } from "node:fs";

const FILES = {
  hc: "scripts/head-cert.ts",
  lib: "scripts/lib/head-cert-deps.ts",
  test: "tests/head-cert-deps.test.ts",
};

/** [文件键, 针脚, 改后文字, 期望红的判卷标题] */
const CASES: [string, string, string, string][] = [
  ["hc", 'if (decision.kind === "held") {', 'if (decision.kind === "held" && false) {', "锁被活人占着"],
  ["hc", 'if (decision.kind === "unreadable") {', 'if (decision.kind === "unreadable" && false) {', "锁文件读不出 ⇒ exit 2"],
  ["hc", "try { unlinkSync(LOCK_PATH); } catch { /* 别人先摘了也算回收成功 */ }", "// 摘旧锁这一步被删了", "陈旧锁（pid 已死）"],
  ["hc", "selfPid: process.pid, alive: pidAlive });", "selfPid: process.pid, alive: () => true });", "先占锁再切树"],
  ["hc", "if (shouldReleaseLock(now, process.pid)) {", "if (shouldReleaseLock(now, 999_999)) {", "反向哨兵：没有锁文件"],
  ["hc", 'if (decision.kind === "reclaim") {', 'if (decision.kind === "reclaim" && false) {', "陈旧锁（pid 已死）"],
  ["hc", "认证树锁=${lockCell}", "锁=未印", "先占锁再切树"],
  ["lib", 'return resolve(root, common, LOCK_DIR_NAME, leaf + ".lock");', 'return resolve(root, LOCK_DIR_NAME, common, leaf + ".lock");', "锁路径：相对 .git"],
  ["lib", "if (typeof o.pid !== \"number\" || !Number.isInteger(o.pid) || o.pid <= 0) return null;", "if (typeof o.pid !== \"number\" || !Number.isInteger(o.pid)) return null;", "parseCertLock 不许猜 pid"],
];

let bad = 0;
for (const [key, needle, replacement, titleHint] of CASES) {
  const src = readFileSync(FILES[key as keyof typeof FILES], "utf8");
  const hits = src.split(needle).length - 1;
  const after = src.replace(needle, replacement);
  const changed = after !== src;
  const title = readFileSync(FILES.test, "utf8").includes(titleHint);
  if (hits !== 1 || !changed || !title) bad++;
  console.log(`${hits === 1 && changed && title ? "ok  " : "BAD "} ${String(hits)} 处｜${key}｜${needle.slice(0, 46)}｜判卷标题里有「${titleHint}」=${String(title)}`);
}
console.log(bad === 0 ? "全部针脚：唯一命中、改得动、判卷标题取得到" : `${String(bad)} 条不合格`);
process.exit(bad === 0 ? 0 : 1);
