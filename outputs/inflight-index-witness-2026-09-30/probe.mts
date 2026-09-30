/** 这条反向对照为什么在全量下翻不出来（第 245 页的前置诊断，只读、只碰自己那棵临时目录）。
 *
 *  现有判卷（`tests/head-cert-deps.test.ts`）用 **index 的 mtimeMs 变没变** 当"git 写没写 index"的代理。
 *  2026-09-30 全量认证里它红了（单跑 88 条绿）⇒ 代理与负载有关，而代理一旦不可靠，那条断言在两种意义上都失去证人：
 *    ⑴ mtime 粒度/写入合并 ⇒ "写了但看不出来"；
 *    ⑵ git 对**内容脏**那一条本就可以写同样字节 ⇒ "写了但内容没变"。
 *  本探针量的是第⑵种（第⑴种由"全量红／单跑绿"两格读数登记，负载那一臂**没有单独跑**，所以机制不写成已证）：
 *  每圈同时记 mtimeMs、mtimeNs、index 的 sha256 与 size，两种内容态各跑两种读法。
 *
 *  跑法：node --import tsx outputs/inflight-index-witness-2026-09-30/probe.mts
 *  退出码：0＝跑完（结论看打印的表）；2＝现场搭不起来（临时仓/init 失败）——这种"没量到"不许读成"没问题"。 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// 参数形状**必须**取自被守护的那把尺自己（第十三族：探针另抄一份，量的就不是同一件事了）
import { gitInflightArgs } from "../../scripts/lib/head-cert-deps.ts";

/** 一次独立现场：返回它的临时目录，调用方负责在 finally 里删——**删的目标必须是这个固定值本身**，
 *  不许从 `repo` 反推父目录（`join(repo,"..")` 今天恰好等于临时目录，形状一改就会去删 `$TMPDIR`，那是全机共享面）。 */
function buildRepo(dirtyContent: boolean): { repo: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "dsh-idxwit-"));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  const git = (args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (git(["init", "-q", "."]).status !== 0) throw new Error("git init 失败");
  git(["config", "user.email", "probe@example.invalid"]);
  git(["config", "user.name", "probe"]);
  writeFileSync(join(repo, "f.txt"), "a\n");
  git(["add", "f.txt"]);
  if (git(["commit", "-q", "-m", "init"]).status !== 0) throw new Error("git commit 失败");
  if (dirtyContent) writeFileSync(join(repo, "f.txt"), "b\n");
  return { repo, dir };
}

/** index 的可观测量：mtime（旧判卷唯一依赖的）、其纳秒原值、inode（写没写过的证人）、内容哈希（内容变没变的证人）。
 *  四列**全部要印出来**——只算不印就是「取了料却不进读数」，与本仓 `selector-cell-hides-blind-count` 守的那格同形。
 *  ⚠️ 前两版在这几列上各印过一次假读数，机制不同、字面一样（都是「不变」）：
 *  ⑴ `ino` 印了却不在 `readIdx` 的返回形状里 ⇒ `undefined !== undefined` 为假 ⇒ 恒「不变」；
 *  ⑵ `mtimeNs` 不带 `{bigint:true}` 时根本不存在 ⇒ 同一句式又恒「不变」。
 *  第一版据此还给出过一个**错的机理**（说 ns 那列是 `Number()` 的 256ns 浮点量化）——那是把「列坏了」
 *  读成「现象微妙」。缺字段的假「不变」只能靠**一列能翻的哨兵**（见 runSuite 末尾）抓，不能靠看表。 */
function readIdx(repo: string): { ms: number; ns: bigint | null; ino: number; size: number; sha: string } {
  const p = join(repo, ".git", "index");
  const st = statSync(p);
  // `mtimeNs` 只在 `{bigint:true}` 下存在：不带这个选项时它是 **undefined**，
  // 而 `undefined !== undefined` 为假 ⇒ 打印出来是「不变」，与「真的没变」同字（第一版就靠这行糊过去三次读数）。
  // 所以这里显式取一次 bigint 状态，并且**取不到就印 null**，不让缺字段冒充观测。
  const b = statSync(p, { bigint: true });
  const buf = readFileSync(p);
  return {
    ms: st.mtimeMs,
    ns: typeof b.mtimeNs === "bigint" ? b.mtimeNs : null,
    ino: st.ino,
    size: buf.length,
    sha: createHash("sha256").update(buf).digest("hex").slice(0, 12),
  };
}

/** 一圈：把 f.txt 的 mtime 拨成一个**过去且每圈不同**的值，跑一次 status，记下 index 前后三样各变没变。 */
function oneRound(repo: string, n: number, args: string[]): string {
  const t = Math.floor(Date.now() / 1000) - 300 + n;
  utimesSync(join(repo, "f.txt"), t, t);
  const before = readIdx(repo);
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  const after = readIdx(repo);
  const cmp = (x: bigint | null, y: bigint | null): string =>
    x === null || y === null ? "取不到" : x !== y ? "变" : "不变";
  const dns = after.ns === null || before.ns === null ? "NaN" : String(after.ns - before.ns);
  return `t=${String(t)} git退${String(r.status)}｜mtime ${after.ms !== before.ms ? "变" : "不变"}` +
    `(ns ${cmp(before.ns, after.ns)})` +
    `｜Δms=${(after.ms - before.ms).toFixed(3)} Δns=${dns}` +
    `｜ino ${after.ino !== before.ino ? "变" : "不变"}` +
    `｜sha ${after.sha !== before.sha ? "变" : "不变"}` +
    `｜size ${String(before.size)}→${String(after.size)}`;
}

const READS: [string, string[]][] = [
  ["带 --no-optional-locks", gitInflightArgs()],
  ["不带（plain status）", ["status", "--porcelain"]],
];

function runSuite(label: string): void {
  for (const dirty of [true, false]) {
    let built: { repo: string; dir: string };
    try {
      built = buildRepo(dirty);
    } catch (e) {
      console.error(`现场搭不起来（${label}／内容${dirty ? "脏" : "干净"}）：${(e as Error).message} ⇒ 这是"没量到"，不是"没问题"`);
      process.exit(2);
    }
    const { repo, dir } = built;
    try {
      for (const [name, args] of READS) {
        const rounds: string[] = [];
        for (let k = 1; k <= 3; k += 1) rounds.push(oneRound(repo, k, args));
        console.log(`  [${label}] 内容${dirty ? "脏" : "干净"} · ${name}：\n    ${rounds.join("\n    ")}`);
      }
      // 哨兵（规则 322）：一次**非写不可**的 index 写（`git add` 走 lock＋rename）。
      // 没有它，「ino 不变」和上一版的「mtime 变」一样只是表在自说自话——列要能翻才算读数。
      console.log(`  [${label}] 内容${dirty ? "脏" : "干净"} · 哨兵 git add（非写不可的一次）：`);
      console.log(`    ${oneRound(repo, 99, ["add", "f.txt"])}`);
    } finally {
      rmSync(dir, { recursive: true, force: true }); // 删这次 mkdtemp 的那一个；不从 repo 反推父目录（形状一改就会去删 $TMPDIR）
    }
  }
}

console.log("读法对照：mtime 代理 vs 内容哈希代理（同一台机器、同一形状的临时仓；两种内容态各两种读法）");
runSuite("静");
