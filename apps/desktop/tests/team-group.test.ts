// 团队会话（群）判卷（v64）：群＝一条带 `group=1` 补丁的会话。
//
// 判的是什么：
//   ① 建群 = 建会话 + 写标记（不新增事件种类、不改 `session_meta.kind`）；
//   ② 名字可选：给了就落 `group_name`，没给就不写这条键；
//   ③ 反查：不是群返回 null；是群返回名字（没取名返回空串）；
//   ④ 建会话失败 / 写标记失败都如实交回，不假装成功。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTeamGroup, defaultGroupDeps, groupOfSession, type GroupDeps } from "../src/main/team-group";

let root: string | null = null;
afterEach(async () => { if (root !== null) await rm(root, { recursive: true, force: true }); root = null; });

describe("团队会话", () => {
  it("建群 = 会话 + group=1 标记；反查得到群名", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-group-"));
    const result = await createTeamGroup({ sessionsRoot: root, name: "壁纸攻坚" });
    expect(result.ok).toBe(true);
    const group = await groupOfSession(root, String(result.sessionId));
    expect(group).toEqual({ name: "壁纸攻坚" });
  });

  it("不取名 ⇒ 不写 group_name（反查回空串）", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-group-"));
    const result = await createTeamGroup({ sessionsRoot: root });
    expect(await groupOfSession(root, String(result.sessionId))).toEqual({ name: "" });
  });

  it("普通会话不是群（反查 null）", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-group-"));
    const id = await defaultGroupDeps.createSession(root, "普通会话");
    expect(await groupOfSession(root, id)).toBeNull();
  });

  it("建会话失败 ⇒ 如实交回", async () => {
    const deps: GroupDeps = {
      createSession: async () => { throw new Error("目录不可写"); },
      append: async () => undefined,
      pathOf: () => "/dev/null",
    };
    const result = await createTeamGroup({ sessionsRoot: "/ws" }, deps);
    expect(result).toEqual({ ok: false, error: "目录不可写" });
  });

  it("写标记失败 ⇒ 如实交回（不把半个群当成功）", async () => {
    const deps: GroupDeps = {
      createSession: async () => "s1",
      append: async () => { throw new Error("补丁写不进去"); },
      pathOf: () => "/dev/null",
    };
    const result = await createTeamGroup({ sessionsRoot: "/ws" }, deps);
    expect(result).toEqual({ ok: false, error: "补丁写不进去" });
  });
});
