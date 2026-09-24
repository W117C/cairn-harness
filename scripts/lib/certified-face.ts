// 「这一整表绿的是哪一棵树」——一行自述。
//
// 为什么要有：`pnpm gates` 打印逐道退出码，却从不声明取料的是**工作树**。多会话并发是这里的常态
// （2026-09-24 实测：同一时刻主树 313 项相对 HEAD 在飞，其中 11 道门脚本被并发会话删在盘上），
// 于是「整表全 0」被读成「HEAD 全 0」——当天为分辨这两件事花掉了一整天（第 44 页 §十三：
// gate-check H7 的红由别人的在飞改动遮住、ts 戳那三门的红只在工作树里被我的未提交补丁修着）。
// 反向也成立：门读盘 ⇒ 对「HEAD 里有、盘上被删」的文件**零信号**，所以被删的判卷面必须单独出声。
//
// 叶子模块：不碰 git、不碰盘。取料（`git status --porcelain`）由调用方做，这里只做解析与措辞。
import { spawnSync } from "node:child_process";

/** 进门判卷的四面：这四处有任何在飞改动，整表绿就**不能**外推成 HEAD 绿。 */
const JUDGED_ROOTS: readonly string[] = ["src", "scripts", "tests", "fixtures"];

export interface CertifiedFace {
  /** `git status --porcelain` 的行数（全仓在飞项数）。 */
  total: number;
  /** 落在判卷四面上的在飞项数。 */
  judged: number;
  /** 其中被删除的项数（门读盘对它们零信号，所以要单列）。 */
  judgedDeleted: number;
  /** 一句话，直接进汇总。 */
  line: string;
}

/** 解析一行 porcelain：返回 `[状态码, 路径]`。rename 取箭头右侧（新路径才是判卷读到的那个）。 */
function parseEntry(raw: string): [string, string] | null {
  const line = raw.replace(/\r$/, "");
  if (line.length < 4) return null;
  const xy = line.slice(0, 2);
  let rest = line.slice(3);
  const arrow = rest.indexOf(" -> ");
  if (arrow >= 0) rest = rest.slice(arrow + 4);
  if (rest.startsWith('"')) {
    const end = rest.lastIndexOf('"');
    if (end > 0) rest = rest.slice(1, end); // git 把非 ASCII 路径整体加引号（内含八进制转义）
  }
  return [xy, rest];
}

function topSegment(path: string): string {
  return path.replace(/^\.\//, "").split("/")[0] ?? "";
}

export function certifiedFace(porcelain: string): CertifiedFace {
  let total = 0;
  let judged = 0;
  let judgedDeleted = 0;
  for (const raw of porcelain.split("\n")) {
    const entry = parseEntry(raw);
    if (entry === null) continue;
    const [xy, path] = entry;
    total++;
    if (!JUDGED_ROOTS.includes(topSegment(path))) continue;
    judged++;
    if (xy.includes("D")) judgedDeleted++;
  }
  const line = judged > 0
    ? "  认证面 = **工作树，不是 HEAD**：判卷四面（src/scripts/tests/fixtures）在飞 " + String(judged) + " 项" +
      (judgedDeleted > 0 ? "（含删除 " + String(judgedDeleted) + " 项——门读盘，对被删文件零信号）" : "") +
      "｜全仓在飞 " + String(total) + " 项 ⇒ 本表全 0 **不等于 HEAD 全 0**；" +
      "要 HEAD 认证请在 HEAD 的隔离 worktree 里跑整表（`git worktree add --detach <tmp> HEAD`；" +
      "注意 `pnpm gates --direct` 只换执行器〔`pnpm run X` → `/bin/sh -c <script>`〕，**不改取料树**）"
    : "  认证面：判卷四面与 HEAD 逐字一致" + (total === 0 ? "（工作树 = HEAD）" : "（在飞 " + String(total) + " 项全在四面之外）") +
      " ⇒ 本表即 HEAD 认证";
  return { total, judged, judgedDeleted, line };
}

/** 取料：`git status --porcelain`。取不到（非 git 环境 / git 不在）返回 null ⇒ 调用方须**如实说没尺**，
 *  不得把 null 读成「干净」。 */
export function porcelainStatus(cwd: string): string | null {
  try {
    const r = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
    if (r.status !== 0 || typeof r.stdout !== "string") return null;
    return r.stdout;
  } catch {
    return null;
  }
}
