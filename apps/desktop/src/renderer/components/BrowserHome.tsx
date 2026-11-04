import { ArrowUpRight, Files, Globe2, Terminal } from "lucide-react";
import type { PaneKind } from "../pane-registry";
import "./browser-home.css";

export function BrowserHome(props: {
  onFocusAddress: () => void;
  onOpenPane?: (kind: PaneKind) => void;
}): React.JSX.Element {
  return (
    <div className="browser-home">
      <Globe2 size={28} strokeWidth={1.5} aria-hidden="true" />
      <h2>打开网页或预览项目</h2>
      <button className="mini-btn" onClick={props.onFocusAddress}>输入网址</button>
      {props.onOpenPane !== undefined && (
        <div className="browser-home-tools" role="group" aria-label="项目工具">
          <button onClick={() => props.onOpenPane?.("file")}>
            <Files size={16} aria-hidden="true" /><span>文件</span><ArrowUpRight size={12} aria-hidden="true" />
          </button>
          <button onClick={() => props.onOpenPane?.("terminal")}>
            <Terminal size={16} aria-hidden="true" /><span>终端</span><ArrowUpRight size={12} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
