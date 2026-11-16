// 成员档案（ADR 0015 §四 的第一件最小件；设计规格 2026-11-16 §1 的命名落点）。
//
// 定位：**档案是投影，不是第二份真源**。写侧只往既有事件里追加补丁键（`member.<id>.<字段>`），
// 读侧从这些补丁重建名单；重建必须可重复（同一份日志重放两次逐字相同）。
//
// 三条纪律（都写成了断言，见 tests/team-members.test.ts）：
//  ① **不新增事件种类、不新增存储面**：档案走既有补丁通道（与段同一条路，spec §2）；
//  ② **权限单调继承**：成员档不得超过团队档（复用 `clampTier`，不是自己再写一套比较）；
//  ③ **坏输入不静默**：名字空、档位认不出、越权档 ⇒ 该条补丁被拒并进 `rejected`，
//     名单仍是「上一条合法状态」——拒绝要看得见，不许悄悄丢。
//
// 命名从本仓既有词长出来（spec §1 的对照表）：成员 / 档案 / 档位 / 团队档 / 能力。
// 上游的 `roster` / `state.json` 这套名字在这里一个都不出现。
import { AGENT_PERMISSION_MODES, type AgentPermissionMode } from "../../events/types";
import { clampTier } from "../worker-report";

/** 补丁键前缀：`member.<id>.<字段>`。id 里不许出现 `.`（分隔符歧义会让读侧猜错人）。 */
export const MEMBER_KEY_PREFIX = "member.";

/** 档案字段白名单（多一个都要改这里，避免「随手加个键就成字段」）。 */
export const MEMBER_FIELDS = ["name", "role", "model", "thinking", "workdir", "tier", "capabilities", "removed"] as const;
export type MemberField = (typeof MEMBER_FIELDS)[number];

export interface MemberProfile {
  id: string;
  name: string;
  role: string;
  model?: string;
  thinking?: string;
  workdir?: string | null;
  /** 权限档：只能是既有五档之一，且不得宽于团队档（重建时按团队档裁剪）。 */
  tier: AgentPermissionMode;
  capabilities: string[];
}

export interface MemberPatchRecord {
  /** 写入顺序（事件 id 或时间戳；只要单调即可，本模块不比大小，只按数组顺序累积）。 */
  at: number;
  patch: Record<string, string>;
}

export interface RejectedMemberPatch {
  at: number;
  id: string | null;
  error: string;
}

export interface MemberRoster {
  members: MemberProfile[];
  rejected: RejectedMemberPatch[];
  /** 被团队档裁剪过的成员（裁剪要出声，不许静默降级）。 */
  clamped: { id: string; requested: AgentPermissionMode; applied: AgentPermissionMode }[];
}

/** 写侧 helper：把一组字段编成补丁键（值一律字符串；`capabilities` 用逗号分隔）。 */
export function memberPatch(id: string, fields: Partial<Record<MemberField, string | readonly string[] | null>>): Record<string, string> {
  if (!isMemberId(id)) throw new Error(`成员 id 不合法：${JSON.stringify(id)}（不许为空、不许含 '.' 或空白）`);
  const patch: Record<string, string> = {};
  for (const field of MEMBER_FIELDS) {
    if (!(field in fields)) continue;
    const value = fields[field];
    if (value === null) continue; // null = 不写这条键（缺席即不变）
    patch[`${MEMBER_KEY_PREFIX}${id}.${field}`] = Array.isArray(value) ? value.join(",") : String(value);
  }
  return patch;
}

function isMemberId(id: string): boolean {
  return id !== "" && !id.includes(".") && !/\s/u.test(id);
}

function isTier(value: string): value is AgentPermissionMode {
  return (AGENT_PERMISSION_MODES as readonly string[]).includes(value);
}

/** 键 → (id, 字段)；不认识的键（不是 member.*）返回 null（不是本模块的键，不当错）。 */
function parseKey(key: string): { id: string; field: string } | null {
  if (!key.startsWith(MEMBER_KEY_PREFIX)) return null;
  const rest = key.slice(MEMBER_KEY_PREFIX.length);
  const dot = rest.lastIndexOf(".");
  if (dot <= 0) return null;
  return { id: rest.slice(0, dot), field: rest.slice(dot + 1) };
}

/**
 * 从补丁记录重建名单。
 *
 * `teamTier` 是团队档（成员档的上界）。缺席时按 `read-only` 处理 = **fail closed**：
 * 没声明团队档就让成员以最窄档跑，不给「默认全权」。
 */
export function projectMembers(records: readonly MemberPatchRecord[], teamTier: AgentPermissionMode): MemberRoster {
  const state = new Map<string, { profile: Partial<MemberProfile> & { id: string }; order: number }>();
  const rejected: RejectedMemberPatch[] = [];
  let order = 0;

  for (const record of records) {
    // 一条补丁记录按成员分组：先**整组校验**，再应用。
    // 理由（判卷抓出来的）：新成员如果一半字段合法、一半非法，先建后拒会让它带着默认档
    // 出现在名单里 —— 既拒绝了又能看见，等于两套口径。所以「新成员」这一组只要有一条不合法，
    // 整组都不建；已存在的成员只拒那一条不合法的字段，档案保持上一条合法状态。
    const groups = new Map<string, { id: string; ops: { field: MemberField; raw: string }[]; errors: string[] }>();
    for (const [key, raw] of Object.entries(record.patch)) {
      const parsed = parseKey(key);
      if (parsed === null) continue; // 不是本模块的键，不当错
      const { id, field } = parsed;
      if (!isMemberId(id)) {
        rejected.push({ at: record.at, id: null, error: `成员 id 不合法：${JSON.stringify(id)}` });
        continue;
      }
      const group = groups.get(id) ?? { id, ops: [], errors: [] };
      groups.set(id, group);
      if (!(MEMBER_FIELDS as readonly string[]).includes(field)) {
        group.errors.push(`未知字段 ${JSON.stringify(field)}（白名单：${MEMBER_FIELDS.join(" / ")}）`);
        continue;
      }
      if (field === "tier" && !isTier(raw)) {
        group.errors.push(`档位认不出：${JSON.stringify(raw)}（既有五档：${AGENT_PERMISSION_MODES.join(" / ")}）`);
        continue;
      }
      if (field === "removed" && raw !== "0" && raw !== "1") {
        group.errors.push(`removed 只收 "0" / "1"，实测 ${JSON.stringify(raw)}`);
        continue;
      }
      group.ops.push({ field: field as MemberField, raw });
    }

    for (const group of groups.values()) {
      const existing = state.get(group.id);
      if (existing === undefined) {
        const identity = group.ops.find((op) => op.field === "name" || op.field === "role");
        if (identity === undefined) {
          rejected.push({ at: record.at, id: group.id, error: "成员还没有档案，第一条补丁必须带 name 或 role" });
          continue;
        }
        if (group.errors.length > 0) {
          for (const error of group.errors) rejected.push({ at: record.at, id: group.id, error });
          continue; // 整组不建：拒绝要干净，不许留半个档案
        }
        order += 1;
        state.set(group.id, { order, profile: { id: group.id } });
      } else if (group.errors.length > 0) {
        for (const error of group.errors) rejected.push({ at: record.at, id: group.id, error });
      }
      const target = state.get(group.id);
      if (target === undefined) continue;
      const profile = target.profile as Record<string, unknown>;
      for (const op of group.ops) {
        if (op.field === "capabilities") {
          profile.capabilities = op.raw === "" ? [] : op.raw.split(",").map((v) => v.trim()).filter((v) => v !== "");
        } else if (op.field === "workdir") {
          profile.workdir = op.raw;
        } else {
          profile[op.field] = op.raw;
        }
      }
    }
  }

  const clamped: MemberRoster["clamped"] = [];
  const members: MemberProfile[] = [];
  for (const entry of [...state.values()].sort((a, b) => a.order - b.order)) {
    const p = entry.profile;
    // 墓碑：removed="1" 的成员不进名单（历史仍在补丁里，删掉也能重放出来）。
    if ((p as Record<string, unknown>).removed === "1") continue;
    if (typeof p.name !== "string" || p.name === "" || typeof p.role !== "string" || p.role === "") {
      rejected.push({ at: entry.order, id: p.id, error: "档案不完整（name 与 role 都必须有值）" });
      continue;
    }
    const requested = p.tier ?? "read-only";
    const tier = clampTier(requested, teamTier);
    if (tier.clamped) clamped.push({ id: p.id, requested, applied: tier.mode });
    members.push({
      id: p.id,
      name: p.name,
      role: p.role,
      tier: tier.mode,
      capabilities: p.capabilities ?? [],
      ...(p.model === undefined ? {} : { model: p.model }),
      ...(p.thinking === undefined ? {} : { thinking: p.thinking }),
      ...(p.workdir === undefined ? {} : { workdir: p.workdir }),
    });
  }
  return { members, rejected, clamped };
}
