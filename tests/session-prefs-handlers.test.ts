// v35：会话级模型/思考档的 IPC 面（sidecar 落盘 + 列表回读）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  handleSessionCreate,
  handleSessionList,
  handleSessionPrefsSet,
  initSessionsDir,
} from "../src/main/session-handlers";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-session-prefs-"));
  initSessionsDir(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("sessionPrefsSet → listSessions 回读（v35）", () => {
  it("写入后列表带 model/thinking；清空只摘指定键", async () => {
    const { id } = await handleSessionCreate("偏好会话");
    expect(await handleSessionPrefsSet({ sessionId: id, prefs: { model: "glm-5.3-flash", thinking: "high" } })).toEqual({ ok: true });
    let row = (await handleSessionList()).find((s) => s.id === id);
    expect(row).toMatchObject({ model: "glm-5.3-flash", thinking: "high" });

    expect(await handleSessionPrefsSet({ sessionId: id, prefs: { model: null } })).toEqual({ ok: true });
    row = (await handleSessionList()).find((s) => s.id === id);
    expect(row?.model).toBeUndefined();
    expect(row?.thinking).toBe("high");
  });

  it("会话不存在 ⇒ 拒（不给幽灵 id 建 sidecar）", async () => {
    const r = await handleSessionPrefsSet({ sessionId: "no-such", prefs: { model: "glm-5.3-flash" } });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("会话不存在");
  });

  it("未知字段 / 非字符串 / 空 patch 一律拒（不透传任意形状）", async () => {
    const { id } = await handleSessionCreate("形状会话");
    expect((await handleSessionPrefsSet({ sessionId: id, prefs: { model: "x", extra: 1 } })).ok).toBe(false);
    expect((await handleSessionPrefsSet({ sessionId: id, prefs: { model: 42 } })).ok).toBe(false);
    expect((await handleSessionPrefsSet({ sessionId: id, prefs: {} })).ok).toBe(false);
    expect((await handleSessionPrefsSet({ sessionId: id, prefs: [] })).ok).toBe(false);
  });
});
