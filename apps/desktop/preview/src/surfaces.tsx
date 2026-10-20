import { Badge, Button, IconButton, ScrollArea, SegmentedControl, Select, Switch, Text, TextField, Tooltip } from "@radix-ui/themes";
import { Command } from "cmdk";
import { ArrowUp, ChevronDown, Plus, Search, Settings as SettingsIcon, Shield, Sparkles } from "lucide-react";
import { useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

export function CommandPalette() {
  return (
    <div className="cmd-panel">
      <Command label="命令面板">
        <Command.Input className="cmd-input" placeholder="输入 / 或 ⌘K 搜索命令…" />
        <Command.List className="cmd-list">
          <Command.Empty>没有匹配的命令</Command.Empty>
          <Command.Group heading="指令">
            <Command.Item className="cmd-item" onSelect={() => undefined}>
              /compact <span className="kbd" style={{ marginLeft: "auto" }}>压缩上下文</span>
            </Command.Item>
            <Command.Item className="cmd-item" onSelect={() => undefined}>
              /goal <span className="kbd" style={{ marginLeft: "auto" }}>设定目标</span>
            </Command.Item>
            <Command.Item className="cmd-item" onSelect={() => undefined}>
              /fork <span className="kbd" style={{ marginLeft: "auto" }}>从这里分叉</span>
            </Command.Item>
          </Command.Group>
          <Command.Group heading="添加">
            <Command.Item className="cmd-item" onSelect={() => undefined}>
              文件引用
            </Command.Item>
            <Command.Item className="cmd-item" onSelect={() => undefined}>
              目标
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}

export function ComposerPreview() {
  const [queued, setQueued] = useState(true);
  return (
    <div>
      {queued && (
        <div className="queue-strip">
          排队中 · 本轮结束后自动发送 —— 这条是产品语义提示，不是组件库控件。
        </div>
      )}
      <div className="composer">
        <textarea placeholder="要做什么？说目标和边界就行" />
        <div className="composer-bar">
          <IconButton size="2" variant="ghost" aria-label="添加">
            <Plus size={14} />
          </IconButton>
          <Button size="1" variant="ghost">
            <Shield size={13} /> 默认 <ChevronDown size={13} />
          </Button>
          <Button size="1" variant="ghost">
            <Sparkles size={13} /> DeepSeek-V3.2 · 128k <ChevronDown size={13} />
          </Button>
          <Tooltip content="上下文占用 · 点开看明细">
            <span className="kbd" style={{ marginLeft: "auto" }}>
              62
            </span>
          </Tooltip>
          <IconButton size="2" aria-label="发送" style={{ marginLeft: 8, background: "var(--accent)", color: "var(--accent-ink)" }}>
            <ArrowUp size={14} />
          </IconButton>
        </div>
      </div>
      <div className="stack" style={{ marginTop: 12 }}>
        <Button size="1" variant="soft" onClick={() => setQueued((v) => !v)}>
          切换队列提示
        </Button>
      </div>
    </div>
  );
}

export function SidebarPreview() {
  const rows = [
    { title: "把第 404 页那 5 根锚点杀掉", sub: "10-06", kind: "" },
    { title: "给 verify 尺补 cause 归属", sub: "正在跑 · 2 分钟", kind: "run", on: true },
    { title: "路由开关进 CLI 面", sub: "等你拍板 · 41 秒", kind: "wait" },
    { title: "清理孤儿 worktree", sub: "验证红 · 2 条断言", kind: "bad" },
  ];
  return (
    <div className="frame" style={{ background: "var(--side-bg)" }}>
      <div className="label">会话列表（Radix 只提供滚动与浮层；行是产品组件）</div>
      <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: 240 }}>
        <div className="grid">
          {rows.map((r) => (
            <div key={r.title} className={"side-row" + (r.on ? " on" : "")}>
              <span className={"dot " + r.kind} />
              <span>
                <div className="side-title">{r.title}</div>
                <div className="side-sub">{r.sub}</div>
              </span>
              <Badge color={r.kind === "bad" ? "red" : r.kind === "wait" ? "amber" : "gray"}>
                {r.kind === "bad" ? "红" : r.kind === "wait" ? "等待" : r.kind === "run" ? "运行中" : "空闲"}
              </Badge>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

const SETTINGS_NAV = [
  { group: "个人", items: ["常规", "外观", "通知"] },
  { group: "工作区", items: ["模型与 Provider", "权限与安全", "行为与成本"] },
  { group: "数据与集成", items: ["记忆与数据", "自动化任务", "插件与扩展"] },
  { group: "系统", items: ["键盘快捷键", "关于与更新"] },
];

export function SettingsPreview() {
  const [section, setSection] = useState("常规");
  return (
    <div className="settings-shell">
      <nav className="ss-nav">
        <div className="ss-title">设置</div>
        <TextField.Root size="2" placeholder="搜索设置" style={{ marginBottom: 12 }}>
          <TextField.Slot>
            <Search size={13} />
          </TextField.Slot>
        </TextField.Root>
        {SETTINGS_NAV.map((g) => (
          <div key={g.group}>
            <div className="ss-group-label">{g.group}</div>
            {g.items.map((it) => (
              <button key={it} className={"ss-item" + (section === it ? " on" : "")} onClick={() => setSection(it)}>
                <SettingsIcon size={14} />
                <span>{it}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="ss-body">
        <Text size="5" weight="bold" as="div">
          常规
        </Text>
        <Text size="1" color="gray" as="p" style={{ margin: "4px 0 18px" }}>
          默认权限、工作区与窗口行为。改动即时保存，下一轮任务生效。
        </Text>
        <div className="frame" style={{ padding: 0, border: 0, boxShadow: "none" }}>
          <div className="ss-row">
            <span>
              <b>默认权限档</b>
              <small>新会话的起始档位；命中全局 deny 时仍直接拒绝。</small>
            </span>
            <Select.Root size="2" defaultValue="默认">
              <Select.Trigger />
              <Select.Content>
                <Select.Item value="只读">只读</Select.Item>
                <Select.Item value="默认">默认</Select.Item>
                <Select.Item value="引导">引导</Select.Item>
                <Select.Item value="自动">自动</Select.Item>
              </Select.Content>
            </Select.Root>
          </div>
          <div className="ss-row">
            <span>
              <b>方案门缺省</b>
              <small>新对话默认要求先批准方案才能写入。</small>
            </span>
            <Switch size="1" />
          </div>
          <div className="ss-row">
            <span>
              <b>完整访问权限</b>
              <small>自动档只降低提问频率，不会越过全局 deny、路径白名单或外发审批。</small>
            </span>
            <Switch size="1" />
          </div>
          <div className="ss-row">
            <span>
              <b>无项目任务文件夹</b>
              <small>项目外启动的任务默认存储数据的位置。</small>
            </span>
            <Button size="1" variant="soft">
              更改
            </Button>
          </div>
          <div className="ss-row">
            <span>
              <b>界面语言</b>
              <small>应用界面语言。</small>
            </span>
            <SegmentedControl.Root size="1" defaultValue="中文">
              <SegmentedControl.Item value="中文">中文</SegmentedControl.Item>
              <SegmentedControl.Item value="English">English</SegmentedControl.Item>
            </SegmentedControl.Root>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ThreeColumnPreview() {
  return (
    <Group orientation="horizontal" className="three-col">
      <Panel defaultSize={22} minSize={15}>
        <div>任务栏</div>
      </Panel>
      <Separator style={{ width: 1, background: "var(--hairline)" }} />
      <Panel minSize={35}>
        <div>对话主区</div>
      </Panel>
      <Separator style={{ width: 1, background: "var(--hairline)" }} />
      <Panel defaultSize={28} minSize={15}>
        <div>右栏（辅助对话 / 审查 / 终端）</div>
      </Panel>
    </Group>
  );
}
