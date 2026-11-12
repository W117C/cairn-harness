// 第 1112 页：workbench 启动面（设置首读 + 项目模板目录）拆出。
// 失败口径不变：设置读失败进会话错误条；模板拉不到落空表，入口禁用而不是点不动的按钮。
import { useEffect, useState } from "react";
import type { PermissionMode } from "../../../../../src/main/ipc-protocol";
import type { ThemePref } from "../theme";
import type { TextSizeSetting, UiSizeSetting } from "../../../../../src/main/settings";
import { readOrError } from "../read-result";
import { STR } from "../strings";

interface WorkbenchTemplate {
  id: string;
  name: string;
  description: string;
  runKind: "static" | "vite";
}

export function useWorkbenchBootstrap(sinks: {
  setMode: (mode: PermissionMode) => void;
  setThemePref: (theme: ThemePref) => void;
  setCtrlTabCycle: (value: boolean) => void;
  setTextSize: (value: TextSizeSetting) => void;
  setUiSize: (value: UiSizeSetting) => void;
  setLastError: (message: string) => void;
}): { templates: WorkbenchTemplate[] } {
  const { setMode, setThemePref, setCtrlTabCycle, setTextSize, setUiSize, setLastError } = sinks;
  const [templates, setTemplates] = useState<WorkbenchTemplate[]>([]);
  // 载入设置：打开即进主界面（不拿向导拦在门口）。
  useEffect(() => {
    void readOrError(() => window.agent.getSettings()).then((r) => {
      if (!r.ok) { setLastError(STR.errors.settingsLoadFailedPrefix + r.error); return; }
      const s = r.value;
      setMode(s.mode);
      setThemePref(s.theme);
      setCtrlTabCycle(s.ctrlTabCycle);
      setTextSize(s.textSize);
      setUiSize(s.uiSize);
    });
  }, [setLastError, setMode, setThemePref, setCtrlTabCycle, setTextSize, setUiSize]);
  // v6 模板目录：入口下拉的数据面（拉不到 = 空表，入口禁用而不是摆一个点不动的按钮）。
  useEffect(() => {
    void window.agent.projectTemplates().then(
      (list) => { setTemplates(list.map((t) => ({ ...t, runKind: t.runKind as "static" | "vite" }))); },
      () => { setTemplates([]); },
    );
  }, []);
  return { templates };
}
