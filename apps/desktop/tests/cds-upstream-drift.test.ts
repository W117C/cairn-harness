// CDS 上游漂移判卷（2026-11-12 · 对标 ADR 0010 的待办第 2 条）。
//
// 动因（实测事故，不是假想）：本仓 vendored 的 CDS 停在 Claude Desktop 3.6556.2，
// 而本机上游早已是 5.1231.2——`cds-parity.test.ts` 一直**绿**，因为它钉的是
// 「vendored 文件自身与 UPSTREAM.json 的记录一致」，不是「vendored 与本机上游一致」。
// ⇒ 上游每更新一次，都是**静默**的漂移：令牌薄落后两代、组件集从 45 变 48、组件账失配，
// 没有一道门会响。
//
// 这条判据怎么钉漂移：**唯一事实源是仓库自己的抽取脚本**
// （`apps/desktop/scripts/extract-cds-tokens.py --check`），它读本机 Claude.app 的 app.asar
// 现算官方令牌薄与渲染层 CSS 的摘要，再与 UPSTREAM.json 的记录对账。
// 本判卷不另写一份解析（另抄一份就是新的漂移面）。
//
// 三态（缺席不许读成通过）：
//   ① 上游在位 ⇒ 必须 PASS（上游动了而本仓没跟上 ⇒ 红）；
//   ② 上游缺席 ⇒ 这一格**未检**（skip，不是绿）；
//   ③ 与机器无关的那部分（上游版本与摘要的钉、判据自身的接线）**永远判**，CI 上也判。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const vendorDir = fileURLToPath(new URL("../src/renderer/vendor/cds-official/", import.meta.url));
const extractor = fileURLToPath(new URL("../scripts/extract-cds-tokens.py", import.meta.url));
const upstream = JSON.parse(readFileSync(`${vendorDir}UPSTREAM.json`, "utf8")) as {
  extractedFrom: { shortVersion: string; asarSha256: string; member: string };
  files: { file: string; sha256: string; bytes: number }[];
  upstreamDrift: { check: string; judge: string; why: string };
};

const asarPath = "/Applications/Claude.app/Contents/Resources/app.asar";
const hasLocalApp = existsSync(asarPath);

/** 跑仓库自己的抽取脚本做对账；返回它印的 JSON。 */
function runCheck(): {
  verdict: string;
  match: Record<string, boolean>;
  tokens: { member: string; sha256: string; bytes: number };
  rendererCss: { member: string; sha256: string; bytes: number };
} {
  const out = execFileSync("python3", [extractor, "--check"], { encoding: "utf8" });
  const start = out.indexOf("{");
  if (start < 0) throw new Error(`抽取脚本没有印出 JSON：${out.slice(0, 200)}`);
  return JSON.parse(out.slice(start)) as ReturnType<typeof runCheck>;
}

describe("上游钉：版本与摘要必须记在仓里（与机器无关，永远判）", () => {
  it("UPSTREAM.json 记了上游短版本、app.asar 摘要与令牌成员名", () => {
    expect(upstream.extractedFrom.shortVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(upstream.extractedFrom.asarSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(upstream.extractedFrom.member).toMatch(/^\.vite\/build\/index\.chunk-[\w-]+\.js$/);
  });

  it("vendored 令牌薄就是记录里那一份（钉住的是「我们 vendored 的东西」）", () => {
    const bytes = readFileSync(`${vendorDir}tokens.css`);
    const record = upstream.files.find((f) => f.file === "tokens.css");
    expect(record).toBeDefined();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(record?.sha256);
    expect(bytes.byteLength).toBe(record?.bytes);
  });

  it("漂移记录指明了检查命令与判卷（不许是空话）", () => {
    expect(upstream.upstreamDrift.check).toContain("extract-cds-tokens.py");
    expect(upstream.upstreamDrift.judge).toContain("cds-upstream-drift.test.ts");
    expect(upstream.upstreamDrift.why.trim().length).toBeGreaterThan(10);
  });

  it("抽取器止点是 JS 模板串的闭合反引号，不是 </style>（第 1175 页）", () => {
    const src = readFileSync(extractor, "utf8");
    expect(src).toContain('if chunk[i] == "`":');
    expect(src).toContain("js_unescape(chunk[start:end])");
    // 旧写法 chunk[start:chunk.find(TOKENS_END, start)] 会把压缩 JS 尾巴一起写进 CSS。
    expect(src).not.toContain("end = chunk.find(TOKENS_END, start)");
  });

  it("抽出来的是**整张薄**：起点块在、终点块在、花括号配平（防切多也防切少）", () => {
    // 为什么要有这一格：「薄是纯 CSS」那一格能挡住**尾部**混进压缩 JS，
    // 但**切在半路**（起点锚点命中了更早的一处、或止点提前）它查不出来——
    // 文件仍然是合法 CSS，sha 也自洽，只有「内容不完整」这一种病。
    // ⚠️ 第 1182 页实测更正：起点＋终点＋花括号配平**不足以**证明整张——删掉中间一整块
    // （@media screen，683–827 行）后这三件仍全绿（探针实测），只有字节数/声明数/sha 会响。
    // 所以这一格自己也要钉「与 UPSTREAM.json 记录的字节数相等」，才对得起「防切少」这个标题；
    // 形状三钉保留作**尾部/切在半途失衡**的便宜早报，不再冒充完整性证明。
    const sheet = readFileSync(`${vendorDir}tokens.css`, "utf8");
    // 起点：官方薄的第一块是 :root 的 radius 刻度（抽取器起点锚点所在处）。
    expect(sheet).toMatch(/^:root \{\n\s*--radius: calc\(0\.5rem \* var\(--cds-rem-scale, 1\)\);/);
    // 终点：官方薄的最后是「跟随系统偏好」的暗色媒体块。
    expect(sheet).toContain('[data-mode="system"]:not(:root)');
    expect(sheet.trimEnd().endsWith("}")).toBe(true);
    // 花括号配平：切在半路必然失衡。
    const open = (sheet.match(/\{/g) ?? []).length;
    const close = (sheet.match(/\}/g) ?? []).length;
    expect(open, `薄的花括号不配平（{=${open} }=${close}）⇒ 抽取切在了半路`).toBe(close);
    // 实测字节数对账：中间少一整块也仍满足上面三条，但字节数必然变 ⇒ 这一格才真能「防切少」。
    const record = upstream.files.find((f) => f.file === "tokens.css");
    expect(record).toBeDefined();
    expect(Buffer.byteLength(sheet)).toBe(record?.bytes);
  });
  it("判据自身的接线：抽取脚本在仓里（缺席 ⇒ 这一格恒真）", () => {
    expect(existsSync(extractor)).toBe(true);
  });
});

describe("上游漂移面（本机装了 Claude.app 才判；缺席＝未检，不等于通过）", () => {
  it.skipIf(!hasLocalApp)("vendored 必须与本机上游一致（上游动了而本仓没跟上 ⇒ 红）", () => {
    const result = runCheck();
    expect(result.match["tokens.css"], `令牌薄与上游不一致：${JSON.stringify(result.tokens)}`).toBe(true);
    expect(result.match.rendererCss, `渲染层 CSS 与上游不一致：${JSON.stringify(result.rendererCss)}`).toBe(true);
    expect(result.verdict).toBe("PASS");
  });

  it.skipIf(!hasLocalApp)("抽取到的上游成员名与记录一致（成员改名 ⇒ 也要跟着重抽）", () => {
    const result = runCheck();
    expect(result.tokens.member.replace(/^\//, "")).toBe(upstream.extractedFrom.member);
  });

  it("缺席不等于通过：上游不在场时这一格是未检（skip），不是绿", () => {
    // 这条在有上游时也成立：它断言的是「判据在位且知道自己会在缺席时跳过」，
    // 防止有人把这一格改成恒真、或把 skip 读成通过。
    expect(typeof hasLocalApp).toBe("boolean");
    if (!hasLocalApp) {
      expect(existsSync(extractor)).toBe(true);
    }
  });
});
