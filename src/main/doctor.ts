// cairn --doctor 的核（spec：docs/superpowers/specs/2026-10-06-productization-b1-design.md §2）。
// 纯函数核不做 I/O：node 版本、key 在位、沙箱、可写性、search 配置全由 runDoctor 收齐后注入，
// 判卷只喂数据（tests/doctor.test.ts）。**脱敏是结构性的**：DoctorFacts 里只有「在位与否」，
// 没有值的字段——想泄都泄不出去；渲染面与判卷同时钉住这一点。
// 本文件不 spawn、不 exec 任何进程；正则取组一律用 String.match（不用 RegExp.exec 那个名字）。
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_KEYED_PROVIDERS, PROVIDER_ENV_KEYS } from "../providers/env-keys";
import { DEFAULT_MODEL_TABLE, specsByTier } from "../providers/registry";
import { loadSearchConfig } from "../tools/web-search";
import { checkSandbox, type SandboxStatus } from "./sandbox";

export interface DoctorCheck {
  id: "node" | "keys" | "tiers" | "sandbox" | "workspace" | "search";
  ok: boolean;
  detail: string;
  /** 只有 node 版本这一项可能是 true（spec：环境级阻断 exit 1）；其余项只报不红。 */
  fatal: boolean;
  hint?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  verdict: "就绪" | "部分就绪" | "未就绪";
  exitCode: 0 | 1;
}

/** loadSearchConfig 的三态收拢：null ⇒ 未配（可选项，不算病）；抛 ⇒ 配了但坏（要报，非致命）。 */
export type SearchReadout = { kind: "unset" } | { kind: "ok" } | { kind: "broken"; message: string };

export interface DoctorFacts {
  nodeVersion: string;
  engines: string;
  /** 键 = env 变量名（PROVIDER_ENV_KEYS 的值）；值 = 在位与否。没有值的字段，脱敏从结构开始。 */
  keyPresence: Record<string, boolean>;
  sandbox: SandboxStatus;
  workspaceWritable: boolean;
  search: SearchReadout;
  tierCounts: { total: number; cheap: number; standard: number; strong: number };
}

/** 手写比较器（spec：不引 semver）。只认 `">=X.Y.Z <N"` 这一形态——本仓 engines 现在的写法；
 *  认不出 ⇒ null，调用方按「读不出来」处理（fail-closed），不猜区间。 */
export function parseEngines(engines: string): { min: [number, number, number]; maxExclusiveMajor: number } | null {
  const m = engines.trim().match(/^>=v?(\d+)\.(\d+)\.(\d+)\s*<(\d+)\s*$/);
  if (!m) return null;
  return { min: [Number(m[1]), Number(m[2]), Number(m[3])], maxExclusiveMajor: Number(m[4]) };
}

function cmpTriple(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** 预发布与脏串一律 false——宁可把 dev 版误报成不满足，也不放行不认识的串。 */
export function nodeVersionOk(nodeVersion: string, range: ReturnType<typeof parseEngines>): boolean {
  if (!range) return false;
  const m = nodeVersion.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const t: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return cmpTriple(t, range.min) >= 0 && t[0] < range.maxExclusiveMajor;
}

export function collectDoctorChecks(f: DoctorFacts): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const range = parseEngines(f.engines);
  const nodeOk = nodeVersionOk(f.nodeVersion, range);
  checks.push({
    id: "node",
    ok: nodeOk,
    fatal: true,
    detail: nodeOk
      ? "Node " + f.nodeVersion + "（engines " + f.engines + "）"
      : range
        ? "Node " + f.nodeVersion + " 不在 engines 区间（" + f.engines + "）"
        : "engines.node 读不出来（" + f.engines + "），无法判版本",
    hint: nodeOk ? undefined : "按 package.json 的 engines 装 Node",
  });
  const present = ENV_KEYED_PROVIDERS.filter((p) => f.keyPresence[PROVIDER_ENV_KEYS[p]]);
  const missing = ENV_KEYED_PROVIDERS.filter((p) => !f.keyPresence[PROVIDER_ENV_KEYS[p]]);
  checks.push({
    id: "keys",
    ok: present.length > 0,
    fatal: false,
    detail: present.length > 0
      ? "缺省将拨 " + present[0] + "（" + PROVIDER_ENV_KEYS[present[0]] + " 在位）" +
        (missing.length > 0 ? "；未设：" + missing.map((p) => PROVIDER_ENV_KEYS[p]).join(" ") : "")
      : "四个 provider key 全部未设",
    hint: present.length > 0 ? undefined : "export OPENAI_API_KEY=<key>；或 --provider demo 零凭据看流程（预录剧本，不拨号）",
  });
  checks.push({
    id: "tiers",
    ok: true,
    fatal: false,
    detail: "模型档位表 " + f.tierCounts.total + " 条（cheap " + f.tierCounts.cheap +
      " / standard " + f.tierCounts.standard + " / strong " + f.tierCounts.strong + "）",
  });
  checks.push({
    id: "sandbox",
    ok: f.sandbox.available,
    fatal: false,
    detail: f.sandbox.available ? "沙箱可用" : "沙箱不可用（" + (f.sandbox.reason ?? "原因未给") + "）",
    hint: f.sandbox.available ? undefined : "跑 pnpm sandbox:check 看原因；run_shell 将明说自己没走沙箱",
  });
  checks.push({
    id: "workspace",
    ok: f.workspaceWritable,
    fatal: false,
    detail: f.workspaceWritable ? "工作区可写" : "工作区不可写（W_OK 不过）",
    hint: f.workspaceWritable ? undefined : "检查 --workspace 指向与磁盘权限",
  });
  checks.push({
    id: "search",
    ok: f.search.kind !== "broken",
    fatal: false,
    detail: f.search.kind === "ok"
      ? "search.endpoint 已配（web_search 可用）"
      : f.search.kind === "unset"
        ? "search.endpoint 未配（web_search 不可用；这是可选项）"
        : ".agent/config.json 存在但解析失败：" + f.search.message,
    hint: f.search.kind === "broken" ? "修好或删掉 .agent/config.json" : undefined,
  });
  return checks;
}

export function verdictOf(checks: DoctorCheck[]): { verdict: DoctorReport["verdict"]; exitCode: 0 | 1 } {
  if (checks.some((c) => c.fatal && !c.ok)) return { verdict: "未就绪", exitCode: 1 };
  if (checks.some((c) => !c.ok)) return { verdict: "部分就绪", exitCode: 0 };
  return { verdict: "就绪", exitCode: 0 };
}

export function renderDoctor(r: DoctorReport): string {
  const lines = r.checks.map(
    (c) => (c.ok ? "✓" : "✗") + " " + c.id + "：" + c.detail + (c.hint ? "（" + c.hint + "）" : ""),
  );
  lines.push("总档：" + r.verdict);
  return lines.join("\n") + "\n";
}

/** IO 壳：收齐六项事实再进纯核。inject 只为判卷开（生产零参调用，判卷用它替换沙箱探测等机器态）。 */
export async function runDoctor(workspace: string, inject: Partial<DoctorFacts> = {}): Promise<DoctorReport> {
  const pkg = JSON.parse(
    await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8"),
  ) as { engines: { node: string } };
  let search: SearchReadout;
  try {
    search = (await loadSearchConfig(workspace)) === null ? { kind: "unset" } : { kind: "ok" };
  } catch (err) {
    search = { kind: "broken", message: err instanceof Error ? err.message : String(err) };
  }
  const facts: DoctorFacts = {
    nodeVersion: process.version,
    engines: pkg.engines.node,
    keyPresence: Object.fromEntries(
      ENV_KEYED_PROVIDERS.map((p) => [PROVIDER_ENV_KEYS[p], (process.env[PROVIDER_ENV_KEYS[p]] ?? "").trim() !== ""]),
    ),
    sandbox: await checkSandbox(),
    workspaceWritable: await access(workspace, constants.W_OK).then(
      () => true,
      () => false,
    ),
    search,
    tierCounts: {
      total: DEFAULT_MODEL_TABLE.length,
      cheap: specsByTier(DEFAULT_MODEL_TABLE, "cheap").length,
      standard: specsByTier(DEFAULT_MODEL_TABLE, "standard").length,
      strong: specsByTier(DEFAULT_MODEL_TABLE, "strong").length,
    },
    ...inject,
  };
  const checks = collectDoctorChecks(facts);
  return { checks, ...verdictOf(checks) };
}
