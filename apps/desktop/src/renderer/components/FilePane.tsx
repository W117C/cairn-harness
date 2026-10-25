import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronRight, FileText, Folder } from "lucide-react";
import type { DirEntryView } from "../../../../../src/main/workspace-fs";

/** 快速打开的目标路径 → 需要预展开的祖先目录（不含文件本身）。
 *  纯函数，判卷可直接钉；命令面板的文件快速打开与 FilePane 的树展开共用这一把尺。 */
export function ancestorDirsOf(path: string): string[] {
  const parts = path.split("/").filter((part) => part !== "");
  const dirs: string[] = [];
  for (let i = 1; i < parts.length; i += 1) dirs.push(parts.slice(0, i).join("/"));
  return dirs;
}

/** 文件窗格（v5 只读浏览）：左树懒加载 + 下方文本预览（帽/二进制由通道侧拒，界面如实呈现）。
 *  `openTarget`：命令面板快速打开的信号——展开父目录、加载尚未取过的目录、打开预览并聚焦行。 */
export function FilePane(props: {
  onPathMenu?: (rel: string, kind: "file" | "directory", x: number, y: number) => void;
  openTarget?: { path: string; seq: number };
}): React.JSX.Element {
  type DirNode = { entries: DirEntryView[]; truncated: boolean } | { error: string };
  const [dirs, setDirs] = useState<Record<string, DirNode>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set([""]));
  const [preview, setPreview] = useState<{ path: string; loading: boolean; text?: string; truncated?: boolean; error?: string } | null>(null);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  // 请求归属（2026-10-21）：同一目录/预览的旧响应晚到，不能覆盖新请求的结果。
  const dirSeq = useRef(new Map<string, number>());
  const previewSeq = useRef(0);
  const root = dirs[""];
  const firstPath = root !== undefined && "entries" in root ? root.entries[0]?.name : undefined;

  const loadDir = (rel: string): void => {
    const seq = (dirSeq.current.get(rel) ?? 0) + 1;
    dirSeq.current.set(rel, seq);
    setDirs((prev) => {
      const next = { ...prev };
      delete next[rel];
      return next;
    });
    void window.agent.workspaceListDir(rel).then((r) => {
      if (dirSeq.current.get(rel) !== seq) return;
      setDirs((prev) => ({
        ...prev,
        [rel]: r === undefined
          ? { error: "通道无应答" }
          : r.ok
            ? { entries: r.entries, truncated: r.truncated }
            : { error: r.error },
      }));
    }).catch((err: unknown) => {
      if (dirSeq.current.get(rel) !== seq) return;
      setDirs((prev) => ({ ...prev, [rel]: { error: err instanceof Error ? err.message : String(err) } }));
    });
  };
  // 首次挂载拉根目录（懒加载树的唯一根；子层展开时才拉）。
  useEffect(() => { loadDir(""); }, []);

  // 命令面板快速打开：把父目录一路展开、把还没取过的目录补拉，再打开文件预览。
  // 只随 target 对象（seq）变化，不随 dirs/函数身份重跑；旧请求有各自序号守卫。
  useEffect(() => {
    const target = props.openTarget;
    if (target === undefined) return;
    const parents = ancestorDirsOf(target.path);
    if (parents.length > 0) {
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const parent of parents) next.add(parent);
        return next;
      });
      for (const parent of parents) {
        if (dirs[parent] === undefined) loadDir(parent);
      }
    }
    openFile(target.path);
    setFocusPath(target.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.openTarget]);

  const child = (rel: string, name: string): string => (rel === "" ? name : `${rel}/${name}`);
  const toggleDir = (rel: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) {
        next.delete(rel);
      } else { next.add(rel); if (dirs[rel] === undefined) loadDir(rel); }
      return next;
    });
  };
  const openFile = (rel: string): void => {
    const seq = previewSeq.current + 1;
    previewSeq.current = seq;
    setPreview({ path: rel, loading: true });
    void window.agent.workspaceReadText(rel).then((r) => {
      if (previewSeq.current !== seq) return;
      setPreview(r === undefined
        ? { path: rel, loading: false, error: "通道无应答" }
        : r.ok
          ? { path: rel, loading: false, text: r.text, truncated: r.truncated }
          : { path: rel, loading: false, error: r.error });
    }).catch((err: unknown) => {
      if (previewSeq.current !== seq) return;
      setPreview({ path: rel, loading: false, error: err instanceof Error ? err.message : String(err) });
    });
  };

  // 树键盘（2026-10-21）：↑/↓ 行间移动，Home/End 首尾，→ 展开/进子行，← 收起/回父行；
  // Enter/Space 交给原生 button，避免双触发。roving tabindex 只保留一个 Tab 停点。
  const onTreeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(".fp-row")];
    const active = document.activeElement;
    const idx = active instanceof HTMLElement ? rows.indexOf(active) : -1;
    if (idx < 0) return;
    const row = rows[idx];
    if (row === undefined) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const target = e.key === "Home" ? rows[0]
        : e.key === "End" ? rows[rows.length - 1]
        : e.key === "ArrowDown" ? rows[idx + 1]
        : rows[idx - 1];
      target?.focus();
      return;
    }
    if (e.key === "ArrowRight" && row.dataset.kind === "dir") {
      e.preventDefault();
      if (row.getAttribute("aria-expanded") !== "true") row.click();
      // 空、加载中或失败目录没有子行；右键只能进入它自己的直属子行。
      else if (rows[idx + 1]?.dataset.parent === row.dataset.path) rows[idx + 1]?.focus();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (row.dataset.kind === "dir" && row.getAttribute("aria-expanded") === "true") {
        row.click();
        return;
      }
      rows.find((r) => r.dataset.path === row.dataset.parent)?.focus();
    }
  };

  const renderDir = (rel: string, depth: number): React.ReactNode => {
    const node = dirs[rel];
    if (node === undefined) return <div className="fp-note">读取中…</div>;
    if ("error" in node) {
      return (
        <div className="fp-note err" role="alert">
          <span>{node.error}</span>
          <button className="mini-btn" onClick={() => { loadDir(rel); }}>重试</button>
        </div>
      );
    }
    return (
      <>
        {node.truncated && (
          <div className="fp-note warn" role="status">
            目录过大，已截断：只显示前 {String(node.entries.length)} 项
          </div>
        )}
        {node.entries.length === 0
          ? <div className="fp-note">{rel === "" ? "工作区为空" : "空目录"}</div>
          : node.entries.map((e) => {
            const p = child(rel, e.name);
            if (e.kind === "dir") {
              const open = expanded.has(p);
              return (
                <Fragment key={p}>
                  <button
                    className={"fp-row dir" + (open ? " open" : "")}
                    style={{ paddingLeft: 6 + depth * 13 }}
                    role="treeitem"
                    aria-level={depth + 1}
                    aria-expanded={open}
                    data-path={p}
                    data-parent={rel}
                    data-kind="dir"
                    tabIndex={focusPath === p || (focusPath === null && p === firstPath) ? 0 : -1}
                    onFocus={() => { setFocusPath(p); }}
                    onClick={(ev) => { ev.currentTarget.focus(); toggleDir(p); }}
                    onContextMenu={(ev) => { ev.preventDefault(); props.onPathMenu?.(p, "directory", ev.clientX, ev.clientY); }}
                  >
                    <ChevronRight size={10} className="fp-chev" aria-hidden="true" />
                    <Folder size={12} aria-hidden="true" />
                    <span className="fp-name">{e.name}</span>
                  </button>
                  {open && renderDir(p, depth + 1)}
                </Fragment>
              );
            }
            return (
              <button
                key={p}
                className={"fp-row file" + (preview?.path === p ? " on" : "")}
                style={{ paddingLeft: 6 + depth * 13 + 13 }}
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={preview?.path === p}
                data-path={p}
                data-parent={rel}
                data-kind="file"
                tabIndex={focusPath === p || (focusPath === null && p === firstPath) ? 0 : -1}
                onFocus={() => { setFocusPath(p); }}
                onClick={(ev) => { ev.currentTarget.focus(); openFile(p); }}
                onContextMenu={(ev) => { ev.preventDefault(); props.onPathMenu?.(p, "file", ev.clientX, ev.clientY); }}
              >
                <FileText size={12} aria-hidden="true" />
                <span className="fp-name">{e.name}</span>
                {e.size !== null && <span className="fp-size num">{e.size}</span>}
              </button>
            );
          })}
      </>
    );
  };

  return (
    <div className="file-pane">
      <div className="file-tree" role="tree" aria-label="文件树" onKeyDown={onTreeKeyDown}>{renderDir("", 0)}</div>
      <div className="file-preview">
        {preview === null && <div className="fp-note">点文件预览（只读；写入由 agent 走审批）</div>}
        {preview !== null && (
          <div className="fp-preview-head">
            <div className="fp-preview-path" title={preview.path}>{preview.path}</div>
            <span className="fp-readonly">只读</span>
          </div>
        )}
        {preview !== null && preview.loading && <div className="fp-note">读取中…</div>}
        {preview !== null && !preview.loading && preview.error !== undefined && (
          <div className="fp-note err" role="alert">
            <span>{preview.error}</span>
            <button className="mini-btn" onClick={() => { openFile(preview.path); }}>重试</button>
          </div>
        )}
        {preview !== null && !preview.loading && preview.text !== undefined && (
          <>
            {preview.truncated === true && <div className="fp-note warn">已截断（超 512 KiB 帽）</div>}
            <pre className="fp-text">{preview.text}</pre>
          </>
        )}
      </div>
    </div>
  );
}

