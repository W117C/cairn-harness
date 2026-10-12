// cairn --doctor 的核（spec：docs/superpowers/specs/2026-10-06-productization-b1-design.md §2）。
// 纯函数核不做 I/O：node 版本、key 在位、沙箱、可写性、search 配置、信任落点全由 runDoctor 收齐后注入，
// 判卷只喂数据（tests/doctor.test.ts）。**脱敏是结构性的**：DoctorFacts 里只有「在位与否」，
// 没有值的字段——想泄都泄不出去；渲染面与判卷同时钉住这一点。
// 本文件不 spawn、不 exec 任何进程；正则取组一律用 String.match（不用 RegExp.exec 那个名字）。
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginDataRootOf, trustFilePathOf } from "../agent/plugins";
import { parseTrustFile } from "../agent/plugins/trust";
import { ENV_KEYED_PROVIDERS, PROVIDER_ENV_KEYS } from "../providers/env-keys";
import { effectiveModelTable, specsByTier } from "../providers/registry";
import { loadSearchConfig } from "../tools/web-search";
import { checkSandbox, type SandboxStatus } from "./sandbox";

export interface DoctorCheck {
  id: "node" | "keys" | "tiers" | "sandbox" | "workspace" | "search" | "trust";
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

/** 信任/插件数据的落点这一格（第 432 页，能力 7「操作可审计」）。
 *  动因：第 424 页把数据根从 `<tmpdir>/m2e-plugin-data` 搬进 `<home>/.config/cairn/plugin-data`，
 *  搬完仍然没人报「它在哪、权限位多少、表里有几条决议」——信任决议是个静默的落盘动作，
 *  自检面不报它，用户就只能靠读代码知道决议写没写进自己家里。
 *  三态一律显式：`dirState`/`storeState` 各有「读不出」那一档，`entries` 在读不出时是 `null`
 *  而**不是 0**——「数不出来」不许被报成「一条都没有」。条数取自 `parseTrustFile` 那份数组，
 *  与 TrustStore 装载时用的是同一口径（这里再数一遍就是第二份事实源）。 */
export interface TrustFaceFacts {
  /** 数据根：由 `pluginDataRootOf` 现算，doctor 自己不拼路径（拼第二遍就会和装配面漂）。 */
  root: string;
  /** 这一格是 env（`M2E_PLUGIN_DATA`）给的还是缺省值——报告里要说明来路。 */
  source: "env" | "default";
  /** 目录三态：不存在（还没写过决议，正常）／存在／读不出（stat 抛，须报病）。 */
  dirState: "ok" | "absent" | "unreadable";
  /** 目录权限位低 9 位；`dirState !== "ok"` 时为 `null`（不许由 0 顶成「不可写」）。 */
  dirMode: number | null;
  /** 信任表三态：没有表／读得出／读不出（JSON 坏或顶层不是对象）。 */
  storeState: "absent" | "ok" | "unreadable";
  /** 表内条目数；`storeState !== "ok"` 时必须是 `null`。 */
  entries: { trusted: number; declined: number } | null;
}

export interface DoctorFacts {
  nodeVersion: string;
  engines: string;
  /** 键 = env 变量名（PROVIDER_ENV_KEYS 的值）；值 = 在位与否。没有值的字段，脱敏从结构开始。 */
  keyPresence: Record<string, boolean>;
  sandbox: SandboxStatus;
  workspaceWritable: boolean;
  search: SearchReadout;
  tierCounts: { total: number; cheap: number; standard: number; strong: number };
  trust: TrustFaceFacts;
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

/** 条数那一句的**唯一拼法**（导出的理由：判卷要钉「报告里有这两数」，但不许自己再抄一遍生产文案——
 *  抄来的整串横跨生产侧好几个字面量，改动其中任一个都不会响，正是本仓的顶包候选那一格）。 */
export function trustCountsText(trusted: number, declined: number): string {
  return "信任表 已信任 " + trusted + " 条／已拒绝 " + declined + " 条";
}

/** 信任落点的纯核。判序：目录读不出 → 目录世界可写 → 表读不出 → 报数。
 *  「世界可写」为什么要单独出声：数据根从前落在 `<os.tmpdir()>/m2e-plugin-data`（第 424 页搬走的那个洞——
 *  任何本机用户都能在那儿预建 `plugin-trust.json`，把自己的条目写成已信任）。搬进用户级配置目录后
 *  这条路只剩「用户自己把 `M2E_PLUGIN_DATA` 指回临时区」——变窄了但没关死，所以它要**可看见**，
 *  而不是靠一次搬家假装解决。
 *  状态与条数不自洽（state 说 ok 却没给数、说 absent 却给了数）也算病：那种输入只可能是取料面写错了，
 *  读成「干净」就是把没尺报成没问题。 */
export function trustFaceCheck(t: TrustFaceFacts): DoctorCheck {
  const origin = t.source === "env" ? "取址来自 env M2E_PLUGIN_DATA" : "取址来自用户级缺省落点";
  const mode = t.dirMode === null ? "权限读不出" : "权限 " + t.dirMode.toString(8).padStart(4, "0");
  const where = "插件数据根 " + t.root + "（" + origin + "，" + mode + "）";
  const worldWritable = t.dirMode !== null && (t.dirMode & 0o002) !== 0;
  const store =
    t.storeState === "ok" && t.entries !== null
      ? { text: trustCountsText(t.entries.trusted, t.entries.declined), ok: true }
      : t.storeState === "unreadable"
        ? { text: "信任表读不出（这不等于「已信任 0 条」）", ok: false }
        : t.storeState === "absent" && t.entries === null
          ? { text: "信任表还没写", ok: true }
          : { text: "信任表状态与条数不自洽（状态 " + t.storeState + "）", ok: false };
  if (t.dirState === "unreadable") {
    return {
      id: "trust",
      ok: false,
      fatal: false,
      detail: where + "——目录读不出，权限位与信任表都无从判断",
      hint: "读不出的是数据根本身：用 M2E_PLUGIN_DATA 指到一个可读目录，或把它的权限修好",
    };
  }
  if (t.dirState === "absent") {
    return { id: "trust", ok: true, fatal: false, detail: where + "——目录还没建（还没有信任决议落盘）" };
  }
  const parts = [where, store.text];
  if (worldWritable) parts.push("目录世界可写，本机任何用户都能预置这份信任表");
  return {
    id: "trust",
    ok: store.ok && !worldWritable,
    fatal: false,
    detail: parts.join("，"),
    hint: store.ok && !worldWritable
      ? undefined
      : "chmod go-w 这个目录；信任表读不出就删掉它，让插件重新出信任卡",
  };
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
  checks.push(trustFaceCheck(f.trust));
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

/** 取信任落点的三态事实（目录 stat ＋ 表文件读文）。
 *  每一档「读不出」都留在事实里：不许折成 absent，更不许折成「0 条决议」。
 *  路径与表名都走装配面那两个出口（`pluginDataRootOf`／`trustFilePathOf`），doctor 不自己拼——
 *  自己拼一遍就有了第二份事实源，第 424 页搬的那次家正好会让它指到旧地址。 */
async function readTrustFace(env: NodeJS.ProcessEnv, home: string): Promise<TrustFaceFacts> {
  const root = pluginDataRootOf(env, home);
  const source: TrustFaceFacts["source"] = env.M2E_PLUGIN_DATA ? "env" : "default";
  let dirState: TrustFaceFacts["dirState"] = "unreadable";
  let dirMode: number | null = null;
  try {
    const st = await stat(root);
    if (st.isDirectory()) {
      dirState = "ok";
      dirMode = st.mode & 0o777;
    }
  } catch (err) {
    // 只有「确实不存在」才算 absent；EACCES／路径中段不是目录一律 unreadable——
    // 把读不出读成「还没建」就是让机器上的毛病冒充干净。
    dirState = (err as { code?: string }).code === "ENOENT" ? "absent" : "unreadable";
  }
  let storeState: TrustFaceFacts["storeState"] = "absent";
  let entries: TrustFaceFacts["entries"] = null;
  if (dirState === "ok") {
    try {
      const parsed = parseTrustFile(await readFile(trustFilePathOf({ pluginDataRoot: root }), "utf8"));
      storeState = parsed === null ? "unreadable" : "ok";
      entries = parsed === null ? null : { trusted: parsed.trusted.length, declined: parsed.declined.length };
    } catch (err) {
      storeState = (err as { code?: string }).code === "ENOENT" ? "absent" : "unreadable";
    }
  }
  return { root, source, dirState, dirMode, storeState, entries };
}

/** IO 壳：收齐七项事实再进纯核。inject 只为判卷开（生产零参调用，判卷用它替换沙箱探测等机器态）。 */
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
      // 有效表：内置 + 已装自定义（doctor 报的是"你现在有哪些档位"，漏掉自定义家会低报）
      total: effectiveModelTable().length,
      cheap: specsByTier(effectiveModelTable(), "cheap").length,
      standard: specsByTier(effectiveModelTable(), "standard").length,
      strong: specsByTier(effectiveModelTable(), "strong").length,
    },
    trust: await readTrustFace(process.env, homedir()),
    ...inject,
  };
  const checks = collectDoctorChecks(facts);
  return { checks, ...verdictOf(checks) };
}
