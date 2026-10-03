// 权限档位的「唯一事实源」对账判卷。
//
// 为什么值得专门判：档位字面量此前抄了五份（permissions / events / settings / TriggerMode /
// `tierToMode` 返回类型），而最坏的一处是 `checkPermission` 以 `return "allow"` 收尾——
// **加一档（或持久化里冒出个陌生值）不会报错，只会静默拿到"全放行"**。
// 本文件把"少一份抄本没跟上"与"表外值拿宽权限"两件事变成红。
import { describe, expect, it } from "vitest";
import { AGENT_PERMISSION_MODES } from "../src/events";
import { PERMISSION_MODES, isPermissionMode, permissionModeRank, type PermissionMode } from "../src/permissions/modes";
import { checkPermission, gate, sideEffectDecisionTable } from "../src/permissions";
import { PERMISSION_MODES as SETTINGS_PERMISSION_MODES } from "../src/main/settings";
import { isPermissionMode as workerIsPermissionMode, clampTier } from "../src/agent/worker-report";

describe("档位集合只有一个事实源", () => {
  it("events 的抄本与 permissions 的事实源逐位相同（顺序=松紧序，clampTier 依赖它）", () => {
    expect([...AGENT_PERMISSION_MODES]).toEqual([...PERMISSION_MODES]);
  });

  it("settings 的档位表就是那只数组（不是第二份字面量）", () => {
    expect(SETTINGS_PERMISSION_MODES).toBe(PERMISSION_MODES);
  });

  it("判别函数也只有一只：worker 侧 re-export 与事实源是同一个引用", () => {
    expect(workerIsPermissionMode).toBe(isPermissionMode);
  });

  it("名次：read-only < default < guided < auto，且每档的名次都非负（-1 会被 clampTier 当成最松侧）", () => {
    expect(PERMISSION_MODES.map(permissionModeRank)).toEqual([0, 1, 2, 3]);
  });

  // 上面两条的**标题**都点了 clampTier，正文却一次都没调用它——「已按父档裁剪」那句 worker 看得见的
  // 话此前没有观测者（本仓记过的第 4 形态：用例存在、标题承诺了，正文判的不是这件事）。
  // 两支各钉一次：越界要夹回父档并说清是单调继承；不越界必须原样放过——只钉前一支的话「一律裁剪」也照样绿。
  it("clampTier 两支都钉：越界回父档并给出整句警告，不越界原样放过且不给警告", () => {
    const clamped = clampTier("auto", "guided");
    expect([clamped.mode, clamped.clamped]).toEqual(["guided", true]);
    expect(clamped.warning).toContain("worker 档位 auto 越界（父会话 guided）——已按父档裁剪");
    expect(clamped.warning, "警告得说清为什么夹：单调继承、worker 不可提权").toContain("worker 不可提权");
    for (const [requested, parent] of [["guided", "auto"], ["read-only", "default"], ["default", "default"]] as const) {
      const kept = clampTier(requested, parent);
      expect([kept.mode, kept.clamped, kept.warning], requested + " 派在父 " + parent + " 之内，不该被动过").toEqual([requested, false, undefined]);
    }
  });
});

describe("档位→裁决表：少一行就编译不过，表外值不许拿到 allow", () => {
  it("表恰好覆盖每一档，且逐档等于 §11.7.2 的档位语义（只读拒 / 默认问 / 引导按风险 / 自主放）", () => {
    expect(Object.keys(sideEffectDecisionTable()).sort()).toEqual([...PERMISSION_MODES].sort());
    expect(sideEffectDecisionTable()).toEqual({ "read-only": "deny", default: "ask", guided: "allow", auto: "allow" });
    for (const m of PERMISSION_MODES) {
      expect(checkPermission(m, "write_file")).toBe(sideEffectDecisionTable()[m]);
      expect(checkPermission(m, "run_shell")).toBe(sideEffectDecisionTable()[m]);
    }
  });

  it("只读动作（read_file）不进这张表：任何档都 allow", () => {
    for (const m of PERMISSION_MODES) expect(checkPermission(m, "read_file")).toBe("allow");
  });

  it("表外档位 ⇒ ask（不是 allow）；非交互时 gate() 再把它收成 deny（fail-closed）", () => {
    const unknown = "chaos" as PermissionMode;
    expect(checkPermission(unknown, "write_file")).toBe("ask");
    expect(gate(unknown, "write_file", true)).toBe("ask");
    expect(gate(unknown, "write_file", false)).toBe("deny");
  });
});

describe("isPermissionMode 的边界（判错方向会让未知档静默降级或静默放行）", () => {
  it("只认事实源里的字面值；大小写、空串、对象、原型键都 false", () => {
    for (const m of PERMISSION_MODES) expect(isPermissionMode(m)).toBe(true);
    expect(isPermissionMode("Default")).toBe(false);
    expect(isPermissionMode("")).toBe(false);
    expect(isPermissionMode(undefined)).toBe(false);
    expect(isPermissionMode(null)).toBe(false);
    expect(isPermissionMode(1)).toBe(false);
    // 原型键：`"constructor" in 表` 这类写法会把它当成员，数组 includes 不会
    expect(isPermissionMode("constructor")).toBe(false);
  });
});
