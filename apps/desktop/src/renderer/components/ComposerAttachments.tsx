// 附件 chip（第 1097 页从 Composer.tsx 拆出：Composer 已 1191/1200 行帽）。
// 这里只放附件展示与发送前剥字段：类型、缩略图、chip 打开/揭文件/移除；状态仍由 Composer 持有。
import { useEffect, useState } from "react";
import { FileText, Folder, Image as ImageIcon, Shield, X } from "lucide-react";
import type { RunAttachmentReference } from "../../../../../src/main/ipc-protocol";
import { relInWorkspace } from "../workspace-rel";
import { toast } from "../toast";
import { STR } from "../strings";
import { baseNameOf, fileIconKind, formatSize } from "./composer-helpers";

/** 渲染层附件条目：RunAttachmentReference + 展示字段（size 拿不到不显；outside = 项目外挂盾牌）。 */
export interface AttachmentItem extends RunAttachmentReference {
  size?: number;
  outside?: boolean;
}

/** 发送前剥离渲染字段（判卷锚：onSend 仍收 RunAttachmentReference 形状）。 */
export function stripRenderFields(list: readonly AttachmentItem[]): RunAttachmentReference[] {
  return list.map((a) => ({ path: a.path, kind: a.kind, explicit: a.explicit }));
}

/** 附件 chip 的图标位（2026-10-18）：图片附件走主进程取 40px 缩略图（data URL）；
 *  失败/非图片退回原图标——缩略图是识别加速，不是必需面，静默降级。 */
export function AttachIcon(props: { path: string; kind: "file" | "directory" }): React.JSX.Element {
  const isImage = props.kind === "file" && fileIconKind(props.path) === "image";
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage) return;
    let alive = true;
    void window.agent.attachmentThumb(props.path).then((r) => {
      if (alive && r.ok && r.dataUrl !== undefined) setThumb(r.dataUrl);
    }, () => undefined);
    return () => { alive = false; };
  }, [props.path, isImage]);
  if (props.kind === "directory") return <Folder size={11} />;
  if (thumb !== null) return <img className="ac-thumb" src={thumb} alt="" />;
  return fileIconKind(props.path) === "image" ? <ImageIcon size={11} /> : <FileText size={11} />;
}

export function ComposerAttachmentChip(props: {
  item: AttachmentItem;
  wsPath: string | null;
  onRemove: () => void;
}): React.JSX.Element {
  const { item: a, wsPath } = props;
  const inWorkspace = (p: string): boolean => relInWorkspace(wsPath, p) !== null;
  const rel = relInWorkspace(wsPath, a.path);
  const open = (): void => {
    if (rel !== null) {
      // 与产物行/项目列表同口径（第 952/1073 页）：打开失败要说出来，不许丢结果。
      void window.agent.workspacePathAction(rel, "open").then(
        (r) => { if (!r.ok) toast.error(r.error ?? STR.composer.attachOpenFail); },
        (err: unknown) => { toast.error(err instanceof Error ? err.message : String(err)); },
      );
      return;
    }
    // 项目外：打开可能危险，只显示位置（revealInFinder）；揭不开同样要说出来。
    void window.agent.revealInFinder(a.path).then(
      (r) => { if (!r.ok) toast.error(r.error ?? STR.composer.attachRevealFail); },
      (err: unknown) => { toast.error(err instanceof Error ? err.message : String(err)); },
    );
  };
  return (
    <span className="attach-chip">
      <button
        type="button"
        className="ac-main"
        title={a.outside === true ? STR.composer.attachOutsideTip : STR.composer.attachOpenTip.replace("{path}", a.path)}
        onClick={open}
      >
        <span className="ac-ico" aria-hidden="true">
          <AttachIcon path={a.path} kind={a.kind} />
        </span>
        <span className="ac-name">{baseNameOf(a.path)}</span>
        {a.size !== undefined && <span className="ac-size num">{STR.composer.fileSize.replace("{n}", formatSize(a.size))}</span>}
        {!inWorkspace(a.path) && (
          <span className="ac-shield" title={STR.composer.attachOutsideTip}><Shield size={10} /></span>
        )}
      </button>
      <button
        type="button"
        className="x"
        aria-label={STR.composer.attachRemove.replace("{path}", a.path)}
        onClick={props.onRemove}
      ><X size={10} /></button>
    </span>
  );
}
