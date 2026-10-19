// 事件里的绝对路径 → 工作区相对路径（2026-10-18）。
// 为什么需要：附件芯片要调 workspacePathAction（只收相对路径），而真机上复现过
// /tmp/…（事件）与 /private/tmp/…（项目记录）的同一处路径前缀不等 ⇒ 误判「不在工作区内」。
// 归一口径：反斜杠统一、盘符小写、去掉同一个 macOS /private 前缀；越界返回 null。
export function relInWorkspace(workspace: string | null, path: string): string | null {
  if (workspace === null || workspace.trim() === "") return null;
  const norm = (p: string): string => {
    let q = p.replace(/\\/g, "/");
    q = q.length > 1 ? q.replace(/\/+$/, "") : q;
    if (/^[A-Za-z]:/.test(q)) q = q[0]!.toLowerCase() + q.slice(1);
    return q.startsWith("/private/") ? q.slice("/private".length) : q;
  };
  const nw = norm(workspace);
  const np = norm(path);
  if (np === nw) return ".";
  if (!np.startsWith(nw + "/")) return null;
  return np.slice(nw.length + 1);
}
