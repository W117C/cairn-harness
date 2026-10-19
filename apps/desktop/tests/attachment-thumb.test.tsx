// 附件图片缩略图（2026-10-18 desktop 扩展）：chip 从统一文件图标升级为 40px 缩略图。
// 主进程 nativeImage 解码，仅图片扩展名、≤25MB；失败静默退回原图标（缩略图是识别加速，不是必需面）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("附件缩略图", () => {
  it("协议 / 通道 / 主进程接线齐全", () => {
    const protocol = read("../../../src/main/ipc-protocol.ts");
    const channels = read("../src/main/channels.ts");
    const main = read("../src/main/index.ts");
    expect(protocol).toContain("attachmentThumb(path: string)");
    expect(channels).toContain('attachmentThumb: "agent:attachment-thumb"');
    expect(main).toContain("handleAttachmentThumb(path as string)");
  });

  it("chip 用缩略图，非图片/失败退回图标", () => {
    const composer = read("../src/renderer/components/Composer.tsx");
    expect(composer).toContain("window.agent.attachmentThumb(props.path)");
    expect(composer).toContain('className="ac-thumb"');
    expect(composer).toContain('<AttachIcon path={a.path} kind={a.kind} />');
  });
});
