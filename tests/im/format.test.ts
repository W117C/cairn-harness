// IM 通道判卷：格式化（markdown→纯文本、分片）与连接存储。
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toPlainText, chunkText } from "../../src/im/format";
import { createImStore, isConnection } from "../../src/im/store";
import type { ImConnection } from "../../src/im/types";

describe("IM 格式化", () => {
  it("markdown → 纯文本：标题/列表/强调/链接去装饰保内容", () => {
    const out = toPlainText("# 标题\n- 一\n- 二\n> 引用\n**粗** `码` [链](https://a.b)");
    expect(out).toContain("标题");
    expect(out).toContain("• 一");
    expect(out).toContain("• 二");
    expect(out).toContain("> 引用");
    expect(out).toContain("粗 码 链 (https://a.b)");
    expect(out).not.toContain("**");
    expect(out).not.toContain("# ");
  });

  it("代码栅栏内容保留、装饰行变空行", () => {
    const out = toPlainText("```js\nlet x = 1;\n```");
    expect(out).toContain("let x = 1;");
  });

  it("分片：按行聚合、单行超限硬切、切点不落代理对中间", () => {
    expect(chunkText("一\n二\n三", 5)).toEqual(["一\n二\n三"]);
    expect(chunkText("一\n二\n三", 4)).toEqual(["一\n二", "三"]);
    const emoji = "🙂".repeat(10);
    const parts = chunkText(emoji, 3);
    expect(parts.every((p) => [...p].length <= 3)).toBe(true);
    expect(parts.join("")).toBe(emoji);
  });
});

describe("IM 连接存储", () => {
  it("roundtrip + 坏条目过滤（旧版本/坏形状不崩宿主）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "imstore-"));
    const store = createImStore(dir);
    expect(await store.load()).toEqual([]);
    const conn: ImConnection = {
      id: "im_a1", platform: "feishu", account: null, sessionId: "s1",
      settings: { appId: "x" }, secretKeys: { appSecret: "im:a1:appSecret" },
      enabled: true, paired: [], requests: [], chats: {}, createdAt: 1,
    };
    await store.save([conn]);
    const loaded = await store.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].sessionId).toBe("s1");
    expect(isConnection({ ...conn, enabled: "yes" })).toBe(false);
  });
});
