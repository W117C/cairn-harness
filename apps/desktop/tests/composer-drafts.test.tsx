// 每会话草稿（2026-10-18 真机抓到的串稿）：Composer 常驻不随会话重挂，旧实现切会话时把 A 的
// 草稿带到 B，再把 B 的写回 A；首页也会继承上一会话的草稿。现在按 activeId 分桶：切走存、切回取、
// 发送删键（否则发完切回又捞回来）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const src = read("../src/renderer/components/Composer.tsx");

describe("Composer 每会话草稿", () => {
  it("按 activeId 分桶：切换时存旧取新，首页用常量键", () => {
    expect(src).toContain("const draftKey = props.activeId ?? HOME_DRAFT_KEY;");
    expect(src).toContain("draftsRef.current.set(draftKeyRef.current, text);");
    expect(src).toContain("setText(draftsRef.current.get(draftKey) ?? \"\");");
  });

  it("草稿落盘：启动回读 + 防抖写整张桶表（附件不落盘）", () => {
    expect(src).toContain('import { DRAFTS_KEY, HOME_DRAFT_KEY } from "../drafts";');
    expect(read("../src/renderer/drafts.ts")).toContain('export const DRAFTS_KEY = "cairn.composer.drafts.v1";');
    expect(src).toContain("const draftsRef = useRef<Map<string, string>>(storedDrafts());");
    expect(src).toContain("const snap: Record<string, string> = Object.fromEntries(draftsRef.current);");
    expect(src).toContain('if (text !== "") snap[draftKey] = text;');
    expect(src).toContain("window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(snap));");
    expect(src).toContain("const saved = draftsRef.current.get(draftKey);");
    // 结构守卫（2026-10-18 事故）：这两个 effect 必须在切会话 effect 的闭合之后，
    // 不能落在它的回调里——嵌在回调里是 invalid hook call，真机构建直接白屏（React #321）。
    const closeSwitch = src.indexOf("mentionSeq.current += 1;");
    const snapshot = src.indexOf("const snap: Record<string, string> = Object.fromEntries");
    expect(closeSwitch).toBeGreaterThan(-1);
    expect(snapshot).toBeGreaterThan(closeSwitch);
  });

  it("侧栏草稿标记：Composer 上报、App 持集合、Sidebar 画铅笔", () => {
    expect(src).toContain('props.onDraftPresence?.(props.activeId ?? null, text.trim() !== "");');
    const sidebar = read("../src/renderer/components/Sidebar.tsx");
    expect(sidebar).toContain('className="s-draft"');
    expect(sidebar).toContain("hasDraft={props.draftIds?.has(s.id) === true}");
    const app = readAppSurface();
    expect(app).toContain("useState<Set<string>>(() => readDraftIds())");
    expect(app).toContain("onDraftPresence={noteDraft}");
    expect(app).toContain("draftIds={draftIds}");
  });

  it("附件 chip 与草稿同键分桶（切会话不带着别人选的附件去发）", () => {
    expect(src).toContain("attachByKey.current.set(draftKeyRef.current, attachments);");
    expect(src).toContain("setAttachments(attachByKey.current.get(draftKey) ?? []);");
    expect(src).toContain("attachByKey.current.delete(draftKeyRef.current);");
  });

  it("切会话收浮层：mention/附件/权限菜单关闭，防抖作废，模型菜单重挂", () => {
    expect(src).toContain("setMention(null);");
    expect(src).toContain('setMenu("none");');
    expect(src).toContain("mentionSeq.current += 1;");
    expect(src).toContain("key={draftKey}");
  });

  it("发送后删键，切回不会把已发送的草稿捞回来", () => {
    expect(src).toContain("draftsRef.current.delete(draftKeyRef.current);");
    expect(src).toContain("useEffect(() => { autoResize(); }, [draftKey]);");
  });
});
