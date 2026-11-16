// 密钥授权（ADR 0015 §五 M12；对表里最后一块 `absent`）。
//
// 形状故意做到最小：**成员 × 密钥 → 允许/拒绝**，一条一条追加进团队事件日志
// （`grant.<member>.<secret> = allow|deny`）。不搬明文、不碰 safeStorage 的密文——
// 这一层只管「谁被允许用哪个名字的密钥」；真正的注入仍是既有 `provider-key-inject` 的活。
//
// 三条纪律：
//  ① **默认拒**：没有记录 ＝ 不许用（与权限层的 fail-closed 同一条）；
//  ② **后写覆盖前写**：同一条 grant 改主意就再追加一条，读侧按最后一条算（可审计：历史都在）；
//  ③ **名字要合法**：密钥名与成员 id 都只收 `[A-Za-z0-9_-]`，不许带点/斜杠（防路径与键歧义）。
export const GRANT_KEY_PREFIX = "grant.";
/** 申请（成员发起 → 人审批）：`request.<member>.<secret> = pending|approved|denied`。 */
export const REQUEST_KEY_PREFIX = "request.";

export const SECRET_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface SecretGrantRecord {
  at: number;
  patch: Record<string, string>;
}

export interface SecretGrant {
  memberId: string;
  secret: string;
  allow: boolean;
  /** 最后一条记录的行号（审计用）。 */
  at: number;
}

export type SecretRequestState = "pending" | "approved" | "denied";

export interface SecretRequest {
  memberId: string;
  secret: string;
  state: SecretRequestState;
  at: number;
}

export interface SecretGrantView {
  /** 每个（成员, 密钥）的最终态。 */
  grants: SecretGrant[];
  /** 被拒的补丁（名字非法等），不静默丢。 */
  rejected: { at: number; error: string }[];
  /** 申请（后写覆盖前写）；`pending` 的排在最前，等人数它。 */
  requests: SecretRequest[];
}

/** 写侧 helper：一条申请/审批状态补丁。 */
export function requestPatch(memberId: string, secret: string, state: SecretRequestState): Record<string, string> {
  if (!SECRET_NAME_RE.test(memberId)) throw new Error(`成员 id 只收字母/数字/下划线/连字符：${JSON.stringify(memberId)}`);
  if (!SECRET_NAME_RE.test(secret)) throw new Error(`密钥名只收字母/数字/下划线/连字符：${JSON.stringify(secret)}`);
  return { [`${REQUEST_KEY_PREFIX}${memberId}.${secret}`]: state };
}

/** 写侧 helper：一条授权补丁。 */
export function grantPatch(memberId: string, secret: string, allow: boolean): Record<string, string> {
  if (!SECRET_NAME_RE.test(memberId)) throw new Error(`成员 id 只收字母/数字/下划线/连字符：${JSON.stringify(memberId)}`);
  if (!SECRET_NAME_RE.test(secret)) throw new Error(`密钥名只收字母/数字/下划线/连字符：${JSON.stringify(secret)}`);
  return { [`${GRANT_KEY_PREFIX}${memberId}.${secret}`]: allow ? "allow" : "deny" };
}

/** 读侧投影：后写覆盖前写，非法名字进 rejected。 */
export function projectSecretGrants(records: readonly SecretGrantRecord[]): SecretGrantView {
  const state = new Map<string, SecretGrant>();
  const requests = new Map<string, SecretRequest>();
  const rejected: { at: number; error: string }[] = [];
  for (const record of records) {
    for (const [key, value] of Object.entries(record.patch)) {
      if (key.startsWith(REQUEST_KEY_PREFIX)) {
        if (value !== "pending" && value !== "approved" && value !== "denied") {
          rejected.push({ at: record.at, error: `申请状态只收 pending/approved/denied，实测 ${JSON.stringify(value)}` });
          continue;
        }
        const rest = key.slice(REQUEST_KEY_PREFIX.length);
        const dot = rest.lastIndexOf(".");
        if (dot <= 0) {
          rejected.push({ at: record.at, error: `申请键形状不对：${key}` });
          continue;
        }
        const memberId = rest.slice(0, dot);
        const secret = rest.slice(dot + 1);
        if (!SECRET_NAME_RE.test(memberId) || !SECRET_NAME_RE.test(secret)) {
          rejected.push({ at: record.at, error: `申请键里的成员/密钥名不合法：${key}` });
          continue;
        }
        requests.set(`${memberId}\u0000${secret}`, { memberId, secret, state: value, at: record.at });
        continue;
      }
      if (!key.startsWith(GRANT_KEY_PREFIX)) continue;
      if (value !== "allow" && value !== "deny") {
        rejected.push({ at: record.at, error: `授权值只收 allow/deny，实测 ${JSON.stringify(value)}` });
        continue;
      }
      const rest = key.slice(GRANT_KEY_PREFIX.length);
      const dot = rest.lastIndexOf(".");
      if (dot <= 0) {
        rejected.push({ at: record.at, error: `授权键形状不对：${key}` });
        continue;
      }
      const memberId = rest.slice(0, dot);
      const secret = rest.slice(dot + 1);
      if (!SECRET_NAME_RE.test(memberId) || !SECRET_NAME_RE.test(secret)) {
        rejected.push({ at: record.at, error: `授权键里的成员/密钥名不合法：${key}` });
        continue;
      }
      state.set(`${memberId}\u0000${secret}`, { memberId, secret, allow: value === "allow", at: record.at });
    }
  }
  const grants = [...state.values()].sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : a.secret < b.secret ? -1 : 1));
  // 待审批的排最前（面板第一眼要看的就是「谁在等」）。
  const requestList = [...requests.values()].sort((a, b) => {
    const rank = (r: SecretRequest): number => (r.state === "pending" ? 0 : 1);
    return rank(a) - rank(b) || (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : a.secret < b.secret ? -1 : 1);
  });
  return { grants, rejected, requests: requestList };
}

/** 能不能用：没记录 ⇒ 拒（默认拒）。 */
export function canUseSecret(view: SecretGrantView, memberId: string, secret: string): boolean {
  return view.grants.find((g) => g.memberId === memberId && g.secret === secret)?.allow === true;
}
