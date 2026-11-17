// 插件占位标（2026-11-17）：目录没有 icon 字段，此前全市场渲染成同一枚蓝色拼图块，
// 卡片无辨识度。改为「id 确定性 hash → 色相 + 首字母」的色块占位（Claude/Codex 商店卡同款语言）。
// 颜色 = --mark-hue（纯数字）进 CSS，s/l 仍由样式表统一定义，主题跟随；Puzzle 备而不用（id 空时）。
import { Puzzle } from "lucide-react";
import type { CSSProperties } from "react";

export function PluginMark(props: { id: string; name: string; variant?: "lg" | "md" }): React.JSX.Element {
  let hash = 0;
  for (let i = 0; i < props.id.length; i++) hash = (hash * 31 + props.id.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const letter = props.name.trim().charAt(0).toUpperCase();
  return (
    <span
      className={"plugin-mark" + (props.variant === undefined ? "" : ` ${props.variant}`)}
      style={{ "--mark-hue": String(hue) } as CSSProperties}
      aria-hidden="true"
    >
      {letter !== "" ? letter : <Puzzle size={16} />}
    </span>
  );
}
