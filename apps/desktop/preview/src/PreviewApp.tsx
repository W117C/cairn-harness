import { Badge, IconButton, SegmentedControl, Theme } from "@radix-ui/themes";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { ControlGallery } from "./controls";
import { CommandPalette, ComposerPreview, SettingsPreview, SidebarPreview, ThreeColumnPreview } from "./surfaces";
import { AppPage } from "./AppPage";
import { useAppState } from "./appState";

type Mode = "light" | "dark";
type View = "app" | "controls";

export function PreviewApp() {
  const [mode, setMode] = useState<Mode>("light");
  const [view, setView] = useState<View>("app");
  const app = useAppState();

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  return (
    <Theme appearance={mode} accentColor="gray" grayColor="sand" radius="small" scaling="95%">
      <div className="preview-shell">
        <Toaster position="bottom-right" />
      <header className="preview-top">
        <h1>Cairn · 真实组件预览</h1>
        <Badge color="gray">Radix Themes + lucide + cmdk + sonner</Badge>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <SegmentedControl.Root size="2" value={view} onValueChange={(v) => setView(v as View)}>
            <SegmentedControl.Item value="app">完整应用页</SegmentedControl.Item>
            <SegmentedControl.Item value="controls">控件对照</SegmentedControl.Item>
          </SegmentedControl.Root>
          <SegmentedControl.Root
            size="2"
            value={mode}
            onValueChange={(v) => setMode(v as Mode)}
          >
            <SegmentedControl.Item value="light">
              <Sun size={13} /> 浅色
            </SegmentedControl.Item>
            <SegmentedControl.Item value="dark">
              <Moon size={13} /> 深色
            </SegmentedControl.Item>
          </SegmentedControl.Root>
          <IconButton
            size="2"
            variant="soft"
            aria-label="弹一条回执"
            onClick={() => toast.success("发送队列已保存")}
          >
            toast
          </IconButton>
        </div>
      </header>

      {view === "app" ? (
        <AppPage app={app} />
      ) : (
        <div className="preview-body">
          <section className="preview-section">
            <h2>三栏布局（react-resizable-panels）</h2>
            <p>拖动分隔条看真实拉伸行为；这是桌面端三栏的容器面。</p>
            <ThreeColumnPreview />
          </section>

          <section className="preview-section">
            <h2>Composer</h2>
            <p>输入框下方的按钮、选择、发送都是 Radix 组件；队列提示是产品语义。</p>
            <ComposerPreview />
          </section>

          <section className="preview-section">
            <h2>侧栏会话行</h2>
            <p>滚动容器用 Radix ScrollArea；行本身仍是产品组件。</p>
            <SidebarPreview />
          </section>

          <section className="preview-section">
            <h2>设置页（整页）</h2>
            <p>左侧导航 + 右侧分组；Select、Switch、Segmented 全部来自组件库。</p>
            <SettingsPreview />
          </section>

          <section className="preview-section">
            <h2>命令面板（cmdk）</h2>
            <p>slash 菜单与 ⌘K 的真实渲染，键盘上下键可切换。</p>
            <CommandPalette />
          </section>

          <section className="preview-section">
            <h2>控件全状态</h2>
            <p>这一栏是「用了组件之后长什么样」的对照面，和 v3-lite.html 的意图稿并排看。</p>
            <ControlGallery />
          </section>
        </div>
      )}
      </div>
    </Theme>
  );
}
