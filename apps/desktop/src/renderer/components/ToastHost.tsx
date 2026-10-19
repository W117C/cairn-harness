import { useEffect, useState } from "react";
import { subscribeToastHost } from "../toast";

type ToasterComponent = (typeof import("sonner"))["Toaster"];

/** 首次提示请求后才挂载 sonner；空提示路径不下载、不解析 Toast 样式与状态机。 */
export function ToastHost(): React.JSX.Element | null {
  const [toaster, setToaster] = useState<{ Component: ToasterComponent } | null>(null);
  useEffect(() => subscribeToastHost((module) => setToaster({ Component: module.Toaster })), []);
  if (toaster === null) return null;
  const Toaster = toaster.Component;
  return <Toaster position="bottom-right" gap={8} />;
}
