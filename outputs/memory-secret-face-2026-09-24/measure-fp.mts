// 记忆写入面若接上 §11.1 脱敏 pass，会不会把**正常的记忆笔记**改掉？
// 分母 = 真由 agent 写下的记忆 markdown（用户层 + 项目层），不是我自己造的样本。
// 三态印全：① 面为空 = 没有尺（红着退出）；② 有料 = 逐条给行 + 命中规则；③ 判读点单独印。
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { redactSecrets } from "../../src/agent/security/scan";

const FACES = [
  { name: "user-memory", dir: "/Users/ze/.qoder/memory" },
  { name: "project-memory", dir: "/Users/ze/.qoder/projects/-Users-ze-Downloads-deepseek-harness/memory" },
];

interface Hit {
  face: string; file: string; line: number; ruleId: string; severity: string;
  whole: string; blocked: boolean; entropyOnly: boolean;
}

function mdFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".md") && statSync(join(dir, f)).isFile()).map((f) => join(dir, f));
}

const hits: Hit[] = [];
let files = 0;
let lines = 0;
const emptyFaces: string[] = [];

for (const face of FACES) {
  if (!existsSync(face.dir)) { emptyFaces.push(face.name + "(目录不存在)"); continue; }
  const list = mdFiles(face.dir);
  if (list.length === 0) { emptyFaces.push(face.name + "(零 .md)"); continue; }
  for (const f of list) {
    files++;
    const raw = readFileSync(f, "utf8");
    const body = raw.split("\n");
    lines += body.length;
    const r = redactSecrets(raw);
    if (r.findings.length === 0 && !r.blocked) continue;
    for (const fd of r.findings) {
      hits.push({
        face: face.name,
        file: f.replace(/^.*\//, ""),
        line: fd.line,
        ruleId: fd.ruleId,
        severity: fd.severity,
        whole: body[fd.line - 1] ?? "",
        blocked: r.blocked,
        // 只有高熵支命中（没有任何已知模式名）= 这一类最容易误伤散文
        entropyOnly: fd.ruleId === "secret.high_entropy",
      });
    }
  }
}

/** 每次跑都注入的自检：没有它，「0 误伤」与「尺是坏的」在输出里长得一模一样。
 *  三条各钉一支：模式名 / 赋值式 / 私钥块（blocked 语义），外加一条「干净笔记不得命中」的反控。 */
function selfCheck(): string[] {
  const fails: string[] = [];
  const key = "sk-" + "Q".repeat(24);
  const cases: { name: string; text: string; want: "hit" | "clean" | "blocked" }[] = [
    { name: "模式名密钥", text: `网关密钥是 ${key}，轮换找运维。`, want: "hit" },
    { name: "赋值式凭据", text: "deploy_token = 9f3ab71c0d4e8825a1b6c30d", want: "hit" },
    { name: "私钥块", text: "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaA==\n-----END OPENSSH PRIVATE KEY-----", want: "blocked" },
    { name: "正常笔记（反控）", text: "判卷文件 sha256 冻结在 scripts/frozen-sha256.json，改它们等于作弊；`pnpm gates` 的清单事实源是 scripts/gate-manifest.ts。", want: "clean" },
  ];
  for (const c of cases) {
    const r = redactSecrets(c.text);
    const got = r.blocked ? "blocked" : r.findings.length > 0 ? "hit" : "clean";
    if (got !== c.want) fails.push(`自检「${c.name}」期望 ${c.want}，实得 ${got}`);
  }
  return fails;
}

const selfFails = selfCheck();

console.log("=== 分母 ===");
console.log("文件", files, "/ 行", lines, "/ 面", FACES.length - new Set(emptyFaces.map((e) => e.split("(")[0])).size,
  "｜空面:", emptyFaces.join("、") || "无");
console.log("自检（四支：模式名/赋值式/私钥块/干净反控）:", selfFails.length === 0 ? "PASS" : "FAIL " + selfFails.join("；"));
if (files === 0 || selfFails.length > 0) {
  console.log("!! 面为空或自检失败 ⇒ 这不是读数，尺不可信");
  process.exit(1);
}

console.log("\n=== 命中（若接上 pass，这些行会被改写）===");
if (hits.length === 0) console.log("0 条 —— 真记忆散文上零误伤");
for (const h of hits) {
  console.log(`[${h.face}] ${h.file}:${h.line} ${h.ruleId} ${h.severity}${h.entropyOnly ? " 仅高熵支" : " 含模式名"} blocked=${h.blocked}`);
  console.log("   整行:", JSON.stringify(h.whole.slice(0, 200)));
}

const byRule = new Map<string, number>();
for (const h of hits) byRule.set(h.ruleId, (byRule.get(h.ruleId) ?? 0) + 1);
const entropyOnly = hits.filter((h) => h.entropyOnly).length;

console.log("\n=== 判读点 ===");
console.log("命中总数", hits.length, "｜按规则:", JSON.stringify([...byRule]),
  "｜其中「仅高熵支」(最可能误伤散文的那类)", entropyOnly, "｜含模式名", hits.length - entropyOnly);
console.log("受影响文件数", new Set(hits.map((h) => h.face + "/" + h.file)).size, "/", files);
console.log("=> 若「仅高熵支」> 0：无差别按 findings 改写会动正常笔记 ⇒ 策略须按 ruleId 分档（模式名命中才改，纯高熵只报不改）。");
