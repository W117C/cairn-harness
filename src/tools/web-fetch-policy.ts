// web_fetch 的出网判据（SSRF 闸）。**纯函数**——不做 I/O、不读配置、不看环境变量。
//
// 为什么单独成文件而不并进 `web_fetch.ts`：判据与传输混在一个文件里，测判据就得起一个真服务器，
// 而真服务器只能在 loopback 上起（正是本闸要拒的地址）⇒ 判据只能"顺带"被测到。
// 拆开之后这一层是零网络的纯函数调用，门禁与变异测试能逐条钉住；传输层另用依赖注入测。
//
// 为什么本仓要自己建：全仓此前不存在任何 URL/主机/IP 校验（`new URL` 的几处只做协议白名单，
// 且都不处理重定向）。`fetch` 默认自动跟随重定向（最多 20 跳），所以**只校验输入 URL 等于没校验**。
//
// DNS rebinding 的 TOCTOU 窗口由传输层封住：这里返回校验过的解析结果，连接层必须原样用于 lookup，
// 不能再交给 fetch/系统解析器二次解析。重定向每一跳都重新走本入口。

import { isIP } from "node:net";

/** 主机名 → IP 列表（注入点：生产走 `dns.lookup(host,{all:true})`，测试走桩）。
 *  **必须返回全部记录**：只取第一条等于把 A/AAAA 双栈的另一半交给运气。 */
export type HostResolver = (host: string) => Promise<readonly string[]>;

/** 出网协议白名单。file:/data:/ftp:/javascript: 一律拒——它们不是"能访问的站"，
 *  而是本机与内网的读取面（file:///etc/passwd、data:text/html 里带 <script>）。 */
export const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/** 主机名黑名单。补的是「解析前就能判掉」那一层——省掉一次 DNS，也省掉一次 rebinding 窗口。
 *  逐个点名而不写正则：`.local` 这类后缀没有统一登记处，漏写一个具体主机名（云元数据那个）
 *  就是一条真实存在的旁路，词法正则写不出来。 */
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",                 // RFC 6761 规定必须解析到 loopback
  "metadata.google.internal",  // GCP 元数据端点
  "metadata.goog",             // GCP 同上（短名）
  "instance-data",             // EC2 元数据端点
]);

/** 主机名后缀黑名单（含点，匹配末尾）。同样点名不写通配。 */
const BLOCKED_HOST_SUFFIXES: readonly string[] = [
  ".localhost",
  ".local",       // mDNS
  ".internal",    // 云厂商内网约定
  ".home.arpa",   // RFC 8375 家庭网段
];

/** IPv4 保留段。**写成 CIDR 再展开成 32 位区间**，不手写十进制上下界：
 *  手写过一版 `[首字节, 次字节下界]` 的表，结果 172.16/12、192.168/16、198.18/15、CGNAT
 *  四段因为"两列含义不同"被逐条读错而整段漏判（实测四段全漏）——CIDR 是唯一没有歧义的写法。
 *  0/8 与 240/4 两头都要：前者是"本网络"，后者含广播 255.255.255.255。 */
const BLOCKED_V4_CIDR: readonly (readonly [string, string])[] = [
  ["0.0.0.0/8", "未指定/本网络"],
  ["10.0.0.0/8", "RFC1918 私网"],
  ["100.64.0.0/10", "CGNAT（运营商级 NAT，能摸到同段其他租户）"],
  ["127.0.0.0/8", "loopback"],
  ["169.254.0.0/16", "link-local（含云元数据 169.254.169.254）"],
  ["172.16.0.0/12", "RFC1918 私网"],
  ["192.0.0.0/24", "IETF 协议保留"],
  ["192.168.0.0/16", "RFC1918 私网"],
  ["198.18.0.0/15", "基准测试段"],
  ["224.0.0.0/4", "组播"],
  ["240.0.0.0/4", "保留（含 255.255.255.255 广播）"],
];

/** "a.b.c.d/len" → [起, 止]（闭区间，无符号 32 位）。表是模块内常量，解析失败就抛——
 *  折成"忽略这一段"等于让一条拼错的判据静默消失，而那正是这张表存在的唯一理由的反面。 */
function cidrToRange(cidr: string): readonly [number, number, string] {
  const [addr, lenRaw] = cidr.split("/");
  const o = parseV4(addr ?? "");
  const len = Number(lenRaw);
  if (o === null || !Number.isInteger(len) || len < 0 || len > 32) throw new Error(`BLOCKED_V4_CIDR 写错了: ${cidr}`);
  const base = (((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0);
  const size = len === 0 ? 1 : 2 ** (32 - len);
  // 未对齐就抛：悄悄把一段扩成"包含它的最小对齐段"= 悄悄多拒一批公网地址，而表里没人看得出来。
  if (base % size !== 0) throw new Error(`BLOCKED_V4_CIDR 未对齐: ${cidr}`);
  return [base, Math.min(base + size - 1, 0xffffffff), ""];
}

const BLOCKED_V4: readonly (readonly [number, number, string])[] = BLOCKED_V4_CIDR.map(
  ([cidr, why]) => { const r = cidrToRange(cidr); return [r[0], r[1], why] as const; },
);

/** 把点分十进制拆成 4 个八位组；不是合法 IPv4 字面量时返回 null。
 *  **不接受前导零写法**（`0177.0.0.1`、`127.1`）：`dns.lookup` 会把它们当名字解析走，
 *  而某些 HTTP 栈当整数解析——两种解释不一致就是一类绕过，宁可在这里判成"不是字面量"，
 *  交给解析器按名字处理（解析器给出的 IP 仍要过同一张表）。 */
function parseV4(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const oct: number[] = [];
  for (const p of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    oct.push(n);
  }
  return [oct[0]!, oct[1]!, oct[2]!, oct[3]!];
}

/** 拆 IPv6 字面量成 8 个 16 位组。`::` 补零、`::ffff:a.b.c.d` 尾段按 IPv4 展开。
 *  返回 null = 不是 IPv6 字面量。%zone（fe80::1%en0）先剥掉。 */
function parseV6(ip: string): number[] | null {
  let s = ip.split("%")[0] ?? "";
  if (s === "") return null;
  // 尾部内嵌 IPv4（::ffff:127.0.0.1）：拆出来先换成两组十六进制。
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseV4(tail);
    if (v4 === null) return null;
    const [o0, o1, o2, o3] = v4;
    s = s.slice(0, lastColon + 1) + ((o0 << 8) | o1).toString(16) + ":" + ((o2 << 8) | o3).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null; // 多个 :: 是畸形
  // `2001::` / `::` 的尾段切出来是 [""]，直接当元素会让长度算错、整条被判成"不是 IPv6"。
  const head = halves[0] === "" ? [] : (halves[0] as string).split(":");
  const rest = halves.length === 2
    ? (halves[1] as string).split(":").filter((g) => g !== "")
    : [];
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - rest.length).fill("0"), ...rest] : head;
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

/** 剥掉 IPv6 字面量外层的方括号。`new URL("http://[::1]/").hostname` 是 **`"[::1]"`**（带括号），
 *  而 `isIP("[::1]")` 是 0 —— 不剥的话 URL 里的 IPv6 字面量全部绕开"字面量直接判"那一支，
 *  改走 DNS 分支，生产里只是因为 `dns.lookup("[::1]")` 抛错才碰巧 fail-closed：
 *  那是事故不是判决，而 `fetch`/undici 是认方括号形式的（会真连 ::1）。
 *  在 `blockedReason` 里也剥，是为了让这个导出**不可能对调用方说谎**。 */
function unwrapBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** 一条地址是否该拒；不拒时 why 为空串。**逐段判定而不是整段黑名单**：
 *  返回值带上段名，是为了在审批卡与报错里说清"因为哪条"——只说"不安全"没人能自查。 */
export function blockedReason(ip: string): string {
  const addr = unwrapBrackets(ip);
  const v4 = parseV4(addr);
  if (v4 !== null) {
    const n = ((v4[0] << 24) | (v4[1] << 16) | (v4[2] << 8) | v4[3]) >>> 0;
    for (const [lo, hi, why] of BLOCKED_V4) {
      if (n >= lo && n <= hi) return why;
    }
    return "";
  }
  const g = parseV6(addr);
  if (g === null) return ""; // 不是 IP 字面量：不是本闸的事（由调用方交给解析器）
  const [a, b] = [g[0]!, g[1]!];
  const firstSevenZero = g.slice(0, 7).every((x) => x === 0);
  if (firstSevenZero && g[7] === 0) return ":: 未指定";
  if (firstSevenZero && g[7] === 1) return "::1 loopback";
  // 内嵌 IPv4 的两类映射必须在这里提出来再判一次，否则 ::ffff:127.0.0.1 过得去
  // （前 32 位全是 0，任何"看前缀"的私网判据都看不见低 32 位里的 127）。
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    const hi = g[6] as number;
    const lo = g[7] as number;
    return blockedReason(`${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`);
  }
  if ((a & 0xffc0) === 0xfe80) return "fe80::/10 link-local";
  if ((a & 0xfe00) === 0xfc00) return "fc00::/7 唯一本地地址（ULA）";
  if ((a & 0xff00) === 0xff00) return "ff00::/8 组播";
  if (a === 0x0064 && b === 0xff9b) return "64:ff9b::/96 NAT64（内嵌 IPv4）";
  if (a === 0x2002) return "2002::/16 6to4（内嵌 IPv4）";
  if (a === 0x2001 && b === 0x0000) return "2001::/32 Teredo（内嵌 IPv4）";
  return "";
}

/** 主机名黑名单（解析前那一层）。大小写与末尾点都归一：`LocalHost.` 与 `localhost` 是同一个。 */
export function blockedHostReason(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(h)) return `主机名黑名单：${h}`;
  for (const suf of BLOCKED_HOST_SUFFIXES) {
    if (h.endsWith(suf)) return `主机名后缀黑名单：${h}（${suf}）`;
  }
  return "";
}

/** 解析结果为空 ⇒ 判拒。**不把"没解析到"当成"安全"**：那正是 DNS 失败被当放行的经典形态。
 *  全部记录逐个判（不是判第一条就收）——双栈站点换个族就绕过去了。 */
function checkResolved(host: string, ips: readonly string[]): string {
  if (ips.length === 0) return `${host} 解析不出任何地址（不把解析失败当放行）`;
  for (const ip of ips) {
    if (isIP(ip) === 0) return `${host} 解析返回无效 IP 地址：${ip}`;
    const why = blockedReason(ip);
    if (why !== "") return `${host} → ${ip} 落在保留段：${why}`;
  }
  return "";
}

export interface PublicUrlTarget {
  url: URL;
  /** DNS 名称对应的所有已校验地址；IP 字面量则只含该字面量。 */
  addresses: readonly string[];
}

/** SSRF 判据的唯一入口。返回 URL 和通过校验的地址；传输层必须用这些地址建立连接。
 *  `label` 只进文案（沿用本仓各工具"报错里说清是哪条"的口径）。 */
export async function assertPublicUrlAndResolve(
  raw: string,
  resolve: HostResolver,
  label = "web_fetch",
): Promise<PublicUrlTarget> {
  if (typeof raw !== "string" || raw.trim() === "") throw new Error(`${label}: url 参数必须是非空字符串`);
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error(`${label}: url 解析失败: ${raw}`);
  }
  if (!ALLOWED_PROTOCOLS.has(u.protocol)) {
    throw new Error(`${label}: 协议 ${u.protocol} 不放行（只允许 http/https）: ${u.href}`);
  }
  const host = unwrapBrackets(u.hostname); // IPv6 字面量带方括号，见 unwrapBrackets 的注
  const hostWhy = blockedHostReason(host);
  if (hostWhy !== "") throw new Error(`${label}: ${hostWhy}`);
  // 已经是 IP 字面量 ⇒ 不必（也不该）再过一遍 DNS：解析器对字面量可能给，也可能抛。
  if (isIP(host) !== 0) {
    const why = blockedReason(host);
    if (why !== "") throw new Error(`${label}: ${host} 落在保留段：${why}`);
    return { url: u, addresses: [host] };
  }
  // 复制注入的数组：后续连接使用的快照与本次判据一一对应，不受调用方随后改写数组影响。
  const addresses = [...await resolve(host)];
  const why = checkResolved(host, addresses);
  if (why !== "") throw new Error(`${label}: ${why}`);
  return { url: u, addresses };
}

/** 兼容只需要判据结果的调用方；联网传输请用 assertPublicUrlAndResolve 并固定其地址。 */
export async function assertPublicUrl(raw: string, resolve: HostResolver, label = "web_fetch"): Promise<URL> {
  return (await assertPublicUrlAndResolve(raw, resolve, label)).url;
}
