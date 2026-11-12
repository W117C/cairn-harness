// 第 1109 页：Composer 的＋附件菜单从 1130 行主体拆出（触发器/外点/键盘仍由 Composer 持有）。
// 菜单只负责四入口与最近文件子列表；选择器回调、添加动作由 Composer 注入。
import { ChevronRight, FileText, Image as ImageIcon } from "lucide-react";
import { Popover } from "./Popover";
import { STR } from "../strings";
import { baseNameOf, fileIconKind } from "./composer-helpers";

export function ComposerAttachMenu(props: {
  open: boolean;
  onClose: () => void;
  onPickFiles?: () => Promise<string[] | null>;
  onPickDirectory?: () => Promise<string | null>;
  onPaste: () => void;
  recentRefs: readonly string[];
  recentOpen: boolean;
  onToggleRecent: () => void;
  onAddFile: (path: string) => void;
  onAddDirectory: (path: string) => void;
}): React.JSX.Element {
  return (
    <Popover open={props.open} up role="menu" style={{ minWidth: 270 }}>
      {props.onPickFiles !== undefined && (
        <button
          className="menu-item"
          role="menuitem"
          onClick={() => {
            props.onClose();
            void props.onPickFiles?.().then((files) => {
              if (files === null || files.length === 0) return;
              for (const p of files) props.onAddFile(p);
            }, () => undefined);
          }}
        >
          <span>{STR.composer.attachUpload}</span>
        </button>
      )}
      {props.onPickDirectory !== undefined && (
        <button
          className="menu-item"
          role="menuitem"
          onClick={() => {
            props.onClose();
            void props.onPickDirectory?.().then((dir) => {
              if (dir !== null && dir !== "") props.onAddDirectory(dir);
            }, () => undefined);
          }}
        >
          <span>{STR.composer.attachFolder}</span><span className="sub">{STR.composer.attachFolderSub}</span>
        </button>
      )}
      <button
        className="menu-item"
        role="menuitem"
        onClick={() => { props.onClose(); props.onPaste(); }}
      >
        <span>{STR.composer.attachPaste}</span>
      </button>
      <button
        className="menu-item"
        role="menuitem"
        disabled={props.recentRefs.length === 0}
        title={props.recentRefs.length === 0 ? STR.composer.attachRecentEmpty : undefined}
        onClick={props.onToggleRecent}
      >
        <span>{STR.composer.attachRecent}</span>
        <span className="sub">{String(props.recentRefs.length)}</span>
        <span className="ac-chev" aria-hidden="true"><ChevronRight size={11} /></span>
      </button>
      {props.recentOpen && props.recentRefs.map((p) => (
        <button
          key={p}
          className="menu-item ac-recent"
          role="menuitem"
          title={p}
          onClick={() => props.onAddFile(p)}
        >
          <span className="mi-ico" aria-hidden="true">{fileIconKind(p) === "image" ? <ImageIcon size={12} /> : <FileText size={12} />}</span>
          <span>{baseNameOf(p)}</span>
        </button>
      ))}
    </Popover>
  );
}
