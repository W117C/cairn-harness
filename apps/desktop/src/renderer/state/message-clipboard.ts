// 第 1115 页：消息级剪贴板/附件打开动作从 workbench.ts 拆出。
// 两件事都要求「失败说出来」：附件不在工作区/打开失败要 toast；剪贴板写入失败走 setLastError。
import { useCallback } from "react";
import { relInWorkspace } from "../workspace-rel";
import { toast } from "../toast";
import { STR } from "../strings";

export function useMessageClipboard(
  activeWorkspace: string | null,
  setLastError: (message: string) => void,
): { openAttachment: (path: string) => void; handleCopyText: (text: string) => Promise<boolean> } {
  const openAttachment = useCallback((path: string): void => {
    const rel = relInWorkspace(activeWorkspace, path);
    if (rel === null) {
      toast.error("该附件不在当前工作区内，无法从界面打开");
      return;
    }
    void window.agent.workspacePathAction(rel, "open").then((r) => {
      if (!r.ok) toast.error(r.error ?? "打开失败");
    }, (err: unknown) => {
      toast.error(`打开失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }, [activeWorkspace]);
  const handleCopyText = useCallback((text: string): Promise<boolean> => {
    // 复制给回执（2026-10-17）：此前静默写入剪贴板，按了没反应 → 看不出成功与否。
    // 2026-10-18：回报 boolean，代码块的「已复制」按钮只在真的写进剪贴板后才亮，不再乐观撒谎。
    return navigator.clipboard.writeText(text).then(() => {
      toast.success(STR.toast.copied);
      return true;
    }, (err: unknown) => {
      setLastError(`复制失败：${err instanceof Error ? err.message : String(err)}`);
      return false;
    });
  }, [setLastError]);
  return { openAttachment, handleCopyText };
}
