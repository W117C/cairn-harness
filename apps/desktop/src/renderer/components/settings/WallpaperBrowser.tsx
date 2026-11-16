// 应用内壁纸选择器（v73）：输目录 / 点目录往下走 / 点文件应用。
//
// 为什么不用原生面板：无辅助功能权限的机器上原生面板的**点选不可自动化**，
// 而「知道路径却要翻半天面板」本来就是常见的抱怨；这条路径还能被判据真点。
import { useCallback, useEffect, useState } from "react";
import { settingsStrings as STR } from "../../strings-settings";

interface Entry { name: string; path: string; kind: "dir" | "file" }

export function WallpaperBrowser(props: {
  /** 点中文件后交给上层（上层跑校验并写设置）。 */
  onPickPath: (path: string) => void;
  /** 判卷缝：直接给一份列目录结果（生产走 wallpaperBrowse）。 */
  initial?: { dir: string; parent: string | null; entries: Entry[] };
}): React.JSX.Element {
  const [dir, setDir] = useState(props.initial?.dir ?? "");
  const [typed, setTyped] = useState(props.initial?.dir ?? "");
  const [parent, setParent] = useState<string | null>(props.initial?.parent ?? null);
  const [entries, setEntries] = useState<Entry[]>(props.initial?.entries ?? []);
  const [issue, setIssue] = useState<string | null>(null);

  const load = useCallback(async (target?: string): Promise<void> => {
    try {
      const result = await window.agent.wallpaperBrowse(target);
      if (result.ok !== true || result.entries === undefined || result.dir === undefined) {
        setIssue(result.error ?? STR.general.wallpaperBrowseFailed);
        return;
      }
      setDir(result.dir);
      setTyped(result.dir);
      setParent(result.parent ?? null);
      setEntries(result.entries);
      setIssue(null);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { if (props.initial === undefined) void load(); }, [load, props.initial]);

  return (
    <div className="cw-browser" data-wallpaper-browser="true">
      <div className="cw-browser-bar">
        <input
          className="ss-input cw-browser-dir"
          aria-label={STR.general.wallpaperBrowseDir}
          placeholder={STR.general.wallpaperBrowseDir}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void load(typed); }}
        />
        <button type="button" className="mini-btn" disabled={parent === null}
          onClick={() => { if (parent !== null) void load(parent); }}>
          {STR.general.wallpaperBrowseUp}
        </button>
        <button type="button" className="mini-btn" onClick={() => { void load(typed); }}>
          {STR.general.wallpaperBrowseGo}
        </button>
      </div>
      {issue !== null && <span className="ss-static cw-browser-issue">{issue}</span>}
      <div className="cw-browser-list" data-dir={dir}>
        {entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            className={`cw-browser-row ${entry.kind}`}
            title={entry.path}
            onClick={() => { if (entry.kind === "dir") void load(entry.path); else props.onPickPath(entry.path); }}
          >
            {entry.kind === "dir" ? "▸ " : ""}{entry.name}
          </button>
        ))}
        {entries.length === 0 && <span className="ss-static">{STR.general.wallpaperBrowseEmpty}</span>}
      </div>
    </div>
  );
}
