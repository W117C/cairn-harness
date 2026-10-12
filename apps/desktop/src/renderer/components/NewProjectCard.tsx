// ③「新建项目」卡片（用户实测反馈：打开桌面端应当能**先建一个以项目名命名的文件夹**再进项目）。
//
// 与「添加已有文件夹」的分工：那个是 píck 一个**已经存在**的目录（既有能力，保留），
// 这个是给还没有项目的人用 —— 填个名字，我们建目录、登记、然后进去。
// 首启引导屏已按用户要求删除，所以这条路径现在是进入项目的**主入口**，不再被一屏向导挡着。
import { useState } from "react";

export function NewProjectCard(props: {
  /** 建好并登记成功后回调（App 据此切工作区、刷新会话）。 */
  onCreated: (path: string) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (name.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await window.agent.createProject({
        name: name.trim(),
        ...(parentDir.trim() !== "" ? { parentDir: parentDir.trim() } : {}),
      });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setName("");
      props.onCreated(r.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="np-card">
      <div className="np-title">新建项目</div>
      <div className="np-desc">按项目名建一个同名文件夹，然后直接进去开始干活。</div>
      <div className="np-row">
        <input
          type="text"
          aria-label="项目名"
          placeholder="项目名（会成为文件夹名）"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
      </div>
      <div className="np-row">
        <input
          type="text"
          aria-label="项目位置"
          placeholder="放在哪（留空 = ~/CairnProjects）"
          value={parentDir}
          disabled={busy}
          onChange={(e) => setParentDir(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <button
          type="button"
          className="mini-btn"
          disabled={busy}
          onClick={() => {
            void window.agent.pickDirectory().then(
              (dir) => {
                if (dir) setParentDir(dir);
              },
              (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
            );
          }}
        >
          选择位置
        </button>
      </div>
      <div className="np-row">
        <button type="button" className="mini-btn primary" disabled={busy || name.trim() === ""} onClick={() => void submit()}>
          {busy ? "正在创建…" : "创建并进入"}
        </button>
      </div>
      {error !== null && <div className="sp-note err">{error}</div>}
    </div>
  );
}
