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

/** 注入用的环境变量名前缀（`DSH_SECRET_<NAME>`；与参照仓同形，但值只来自本机已有 env）。 */
export const SECRET_ENV_PREFIX = "DSH_SECRET_";

export interface MemberSecretEnv {
  /** 这一轮该注入的环境变量。 */
  env: Record<string, string>;
  /** 授权了但本机没有值（名字存在于授权表、值不存在） ⇒ 不注入，点名。 */
  missing: string[];
  /** 没被授权的名字（调用方若想注入这些，必须拒）。 */
  denied: string[];
}

/**
 * 成员这一轮能拿到的密钥环境：**只认 allow 的授权**，值从 `source`（默认 process.env）取；
 * 取不到值 ⇒ 记 missing，不注入空串（空串会让下游以为「配置了但为空」）。
 * 这里只做**决定**，不写 process.env——写与撤由调用方配对（见 applyMemberSecretEnv）。
 */
export function envForMember(
  view: SecretGrantView,
  memberId: string,
  source: Record<string, string | undefined> = process.env,
): MemberSecretEnv {
  const env: Record<string, string> = {};
  const missing: string[] = [];
  const denied: string[] = [];
  for (const grant of view.grants) {
    if (grant.memberId !== memberId) continue;
    if (!grant.allow) { denied.push(grant.secret); continue; }
    const value = source[grant.secret];
    if (typeof value !== "string" || value === "") { missing.push(grant.secret); continue; }
    env[SECRET_ENV_PREFIX + grant.secret] = value;
  }
  return { env, missing, denied };
}

/**
 * 把成员密钥写进进程环境，返回**撤销函数**（调用方在 run 收束后必须调用）。
 * 只增删自己写过的键：外部本来就有的同名变量不覆盖（外部 env 永远权威）。
 */
export function applyMemberSecretEnv(
  env: Record<string, string>,
  target: Record<string, string | undefined> = process.env,
): () => void {
  const written: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (target[name] !== undefined) continue; // 外部已有 ⇒ 不覆盖
    target[name] = value;
    written.push(name);
  }
  return () => {
    for (const name of written) delete target[name];
  };
}

/**
 * 在**一次成员 run 的开窗里**注入密钥：进 run 前写、run 收束后一定撤（抛错也撤）。
 * 并发注意：环境是进程级的，两个成员同时跑会互相看见对方注入的键——
 * 这是既有的进程模型决定的（provider key 注入同形），要在 run 之间真隔离得等按 run 的分环境。
 */
export async function withMemberSecretEnv<T>(
  view: SecretGrantView,
  memberId: string,
  run: (env: MemberSecretEnv) => Promise<T>,
  target: Record<string, string | undefined> = process.env,
  source: Record<string, string | undefined> = process.env,
): Promise<{ result: T; env: MemberSecretEnv }> {
  const decided = envForMember(view, memberId, source);
  const undo = applyMemberSecretEnv(decided.env, target);
  try {
    return { result: await run(decided), env: decided };
  } finally {
    undo();
  }
}
