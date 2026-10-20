import {
  Badge,
  Button,
  Callout,
  IconButton,
  ScrollArea,
  SegmentedControl,
  Select,
  Switch,
  Tabs,
  Text,
  TextArea,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import {
  ArrowUp,
  ChevronRight,
  ChevronDown,
  Copy,
  GitBranch,
  Layers,
  PanelRight,
  Plus,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Shield,
  Sidebar as SidebarIcon,
  Sparkles,
  Square,
  X,
  Brain,
} from "lucide-react";
import { useState } from "react";
import { SettingsPage } from "./SettingsPage";
import type { QueuedSend, StreamItem } from "./appState";

type AppState = ReturnType<typeof import("./appState").useAppState>;

const KIND_BADGE: Record<string, { text: string; color: "gray" | "amber" | "red" | "green" }> = {
  idle: { text: "空闲", color: "gray" },
  run: { text: "运行中", color: "green" },
  wait: { text: "等待", color: "amber" },
  bad: { text: "红", color: "red" },
};

function MessageActions(props: { text: string; forkable: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="msg-meta">
      <time>12:0{props.forkable ? "1" : "4"}</time>
      <button
        className="msg-action"
        onClick={() => {
          void navigator.clipboard?.writeText(props.text).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        <Copy size={12} /> {copied ? "已复制" : "复制"}
      </button>
      {props.forkable && (
        <>
          <button className="msg-action">
            <GitBranch size={12} /> 从这里分叉
          </button>
          <button className="msg-action">
            <RotateCcw size={12} /> 还原此轮
          </button>
        </>
      )}
    </div>
  );
}

function StreamRow(props: { item: StreamItem }) {
  const it = props.item;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (it.kind === "user") {
    return (
      <div className="msg-user">
        {it.text}
        <MessageActions text={it.text} forkable />
      </div>
    );
  }

  if (it.kind === "tool") {
    return (
      <div className={"tool-cluster" + (open ? " open" : "")}>
        <button className="tc-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <ChevronRight size={12} className="chev" />
          <Layers size={12} style={{ color: "var(--accent)" }} />
          跑了 <b>1</b> 步 <span className="tc-fin">{it.detail}</span>
        </button>
        <div className="tc-body">
          <div className={"tc-step" + (it.ok === false ? " fail" : "")}>
            <span className="tc-icon">
              {it.ok === false ? <X size={12} /> : <span style={{ color: "var(--ok)" }}>✓</span>}
            </span>
            <span>
              <span className="tc-name">{it.tool}</span> <span className="tc-desc">{it.text}</span>
            </span>
            <span className="tc-right">{it.detail}</span>
          </div>
        </div>
      </div>
    );
  }

  if (it.kind === "delivery") {
    return (
      <div className="delivery">
        <div className="delivery-head">
          本轮改了 <b>3</b> 个文件
          <span className="nums">
            <span className="p">＋41</span> <span className="m">−7</span>
          </span>
          <span className="sp">
            <span className="chip ok">已验证</span>
            <span>第 3/3 次</span>
            <ChevronDown size={12} />
          </span>
        </div>
        {open && (
          <div className="delivery-body">
            <div className="delivery-file">
              <span style={{ color: "var(--accent)" }}>▸</span>
              <span className="path">src/agent/verify.ts</span>
              <span className="kind">modified</span>
              <span className="nums">
                <span className="p">＋26</span> <span className="m">−4</span>
              </span>
            </div>
            <div className="delivery-file">
              <span style={{ color: "var(--accent)" }}>▸</span>
              <span className="path">src/events/index.ts</span>
              <span className="kind">modified</span>
              <span className="nums">
                <span className="p">＋12</span> <span className="m">−3</span>
              </span>
            </div>
            <div className="delivery-file">
              <span style={{ color: "var(--accent)" }}>▸</span>
              <span className="path">tests/verify-cause.test.ts</span>
              <span className="kind">created</span>
              <span className="nums">
                <span className="p">＋3</span>
              </span>
            </div>
            <div className="delivery-verify">
              <span style={{ color: "var(--ok)" }}>✓</span>
              <span>验证通过 · 第 3/3 次</span>
              <span className="sp">下一步：改动已验证，可进入审查</span>
            </div>
            <details className="evidence">
              <summary>查看验证证据</summary>
              <pre>pnpm test · exit 0 · 145 passed</pre>
            </details>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="msg-row">
      <div>
        {/* 思考块：有 reasoning 正文才出现，缺席不摆空壳（同 v3-lite 纪律） */}
        {it.thinking !== undefined && it.thinking !== "" && (
          <div className={"think-block" + (open ? " open" : "")}>
            <button className="think-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              <ChevronDown size={12} className="chev" />
              <Brain size={12} style={{ color: "var(--accent)" }} />
              模型思考 · 6s <span className="think-fin">reasoning 正文，不是结论</span>
            </button>
            {open && <div className="think-body">{it.thinking}</div>}
          </div>
        )}
        {it.text}
        <MessageActions text={it.text} forkable />
      </div>
    </div>
  );
}

function QueueStrip(props: { queue: QueuedSend[]; running: boolean; onInterrupt: (i: number) => void; onRemove: (i: number) => void }) {
  if (props.queue.length === 0) return null;
  return (
    <div className="queue-strip">
      <div style={{ marginBottom: 6 }}>
        排队中 · {props.running ? "本轮结束后自动发送" : "等待恢复发送"}
      </div>
      {props.queue.map((q, i) => (
        <div key={q.id} className="stack" style={{ padding: "3px 0" }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {q.text}
          </span>
          {props.running && (
            <Button size="1" variant="soft" onClick={() => props.onInterrupt(i)}>
              打断并发送
            </Button>
          )}
          <IconButton size="1" variant="ghost" aria-label="移出队列" onClick={() => props.onRemove(i)}>
            <X size={11} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

export function AppPage(props: { app: AppState }) {
  const a = props.app;
  const [draft, setDraft] = useState("");

  const submit = () => {
    if (a.send(draft)) setDraft("");
  };

  if (a.settingsOpen) {
    return (
      <div className="preview-shell">
        <SettingsPage root app={a} onBack={() => a.setSettingsOpen(false)} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="titlebar">
        <IconButton size="1" variant="ghost" aria-label="切换任务栏" onClick={() => a.setRailOpen(!a.railOpen)}>
          <SidebarIcon size={14} />
        </IconButton>
        <span className="tb-title">{a.sessions.find((s) => s.id === a.activeId)?.title ?? "Cairn"}</span>
        <span className="right">
          <Badge color={a.isRunning ? "green" : "gray"}>{a.isRunning ? "运行中" : "空闲"}</Badge>
          <IconButton size="1" variant="ghost" aria-label="切换右栏" onClick={() => a.setRpOpen(!a.rpOpen)}>
            <PanelRight size={14} />
          </IconButton>
        </span>
      </header>

      <div className="workspace" data-rail={a.railOpen ? "open" : "closed"} data-rp={a.rpOpen ? "open" : "closed"}>
        <aside className="rail">
          <div style={{ padding: "var(--s-3)" }}>
            <Button size="2" style={{ width: "100%" }}>
              <Plus size={13} /> 新任务
            </Button>
          </div>
          <div style={{ padding: "0 var(--s-3) var(--s-3)" }}>
            <TextField.Root size="1" placeholder="搜任务">
              <TextField.Slot>
                <Search size={12} />
              </TextField.Slot>
            </TextField.Root>
          </div>
          <ScrollArea type="auto" scrollbars="vertical" style={{ minHeight: 0 }}>
            <div style={{ padding: "0 var(--s-2) var(--s-3)" }}>
              {/* 项目组 = 文件夹下的对话；最近组 = 全部对话（含文件夹里的） */}
              {[...new Set(a.sessions.map((s) => s.group))].map((group) => (
                <div key={group}>
                  <div className="rail-group">{group}</div>
                  {a.sessions
                    .filter((s) => s.group === group)
                    .map((s) => (
                      <button
                        key={s.id}
                        className={"side-row" + (s.id === a.activeId ? " on" : "")}
                        onClick={() => a.setActiveId(s.id)}
                      >
                        <div className="side-title">{s.title}</div>
                      </button>
                    ))}
                </div>
              ))}
            </div>
          </ScrollArea>
          <div style={{ padding: "var(--s-2) var(--s-3)" }}>
            <Button size="1" variant="ghost" onClick={() => a.setSettingsOpen(true)}>
              <SettingsIcon size={12} /> 设置
            </Button>
          </div>
        </aside>

        <main className="main-col">
          <ScrollArea type="auto" scrollbars="vertical" className="stream">
            <div className="stream-inner">
              {a.items.map((it, i) => (
                <StreamRow key={`${it.kind}-${String(i)}`} item={it} />
              ))}
              {a.items.length === 0 && (
                <div className="pg-empty" style={{ textAlign: "center", padding: "8vh 0" }}>
                  <Text size="4" weight="bold">
                    今天要修点什么？
                  </Text>
                  <Text size="1" color="gray" as="p">
                    描述任务，agent 在工作区里读代码、改代码、跑测试、交付结果。
                  </Text>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="composer-zone">
            <div style={{ maxWidth: 820, margin: "0 auto" }}>
              <QueueStrip
                queue={a.queue}
                running={a.isRunning}
                onInterrupt={a.interrupt}
                onRemove={a.removeQueued}
              />
              <div className="composer">
                <TextArea
                  size="2"
                  variant="surface"
                  placeholder={a.isRunning ? "运行中 · 回车入队，⌘↩ 打断并发送" : "要做什么？说目标和边界就行"}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                    if (e.key !== "Enter" || e.shiftKey) return;
                    if (e.metaKey || e.ctrlKey) {
                      e.preventDefault();
                      if (draft.trim() !== "" && a.isRunning) {
                        const n = a.queue.length;
                        a.send(draft);
                        setDraft("");
                        a.interrupt(n);
                      } else {
                        submit();
                      }
                      return;
                    }
                    e.preventDefault();
                    submit();
                  }}
                />
                <div className="composer-bar">
                  <IconButton size="2" variant="ghost" aria-label="添加">
                    <Plus size={14} />
                  </IconButton>
                  <Select.Root size="1" value={a.mode} onValueChange={a.setMode}>
                    <Select.Trigger variant="ghost" />
                    <Select.Content>
                      <Select.Item value="只读">只读</Select.Item>
                      <Select.Item value="默认">默认</Select.Item>
                      <Select.Item value="引导">引导</Select.Item>
                      <Select.Item value="自动">自动</Select.Item>
                    </Select.Content>
                  </Select.Root>
                  <Button size="1" variant="ghost">
                    <Sparkles size={13} /> DeepSeek-V3.2 · 128k <ChevronDown size={12} />
                  </Button>
                  <Tooltip content="上下文占用 · 点开看明细">
                    <span className="ctx-ring">
                      <svg viewBox="0 0 27 27" aria-hidden="true">
                        <circle className="bgc" cx="13.5" cy="13.5" r="11" />
                        <circle
                          className="fgc"
                          cx="13.5"
                          cy="13.5"
                          r="11"
                          strokeDasharray="69.1"
                          strokeDashoffset="26.3"
                        />
                      </svg>
                      <b>62</b>
                    </span>
                  </Tooltip>
                  {a.isRunning ? (
                    <button className="round-btn stop" aria-label="停止输出" title="停止当前输出" onClick={() => a.interrupt()}>
                      <Square size={13} />
                    </button>
                  ) : (
                    <button
                      className="round-btn send"
                      aria-label="发送"
                      title="发送"
                      onClick={submit}
                    >
                      <ArrowUp size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>

        <aside className="right-panel">
          <Tabs.Root value={a.rpTab} onValueChange={a.setRpTab}>
            <Tabs.List size="2">
              <Tabs.Trigger value="辅助对话">辅助对话</Tabs.Trigger>
              <Tabs.Trigger value="审查">审查</Tabs.Trigger>
              <Tabs.Trigger value="终端">终端</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="辅助对话">
              <div className="grid" style={{ padding: "var(--s-3)" }}>
                <Callout.Root size="1">
                  <Callout.Icon>
                    <Shield size={12} />
                  </Callout.Icon>
                  <Callout.Text>只读问一句，不回填主线。</Callout.Text>
                </Callout.Root>
                <TextArea size="1" placeholder="问一句，不动主线" />
                <Button size="1">发送</Button>
              </div>
            </Tabs.Content>
            <Tabs.Content value="审查">
              <div className="grid" style={{ padding: "var(--s-3)" }}>
                <div className="side-row">
                  <span />
                  <span className="side-title">src/agent/verify.ts</span>
                  <span className="side-sub">＋26 −4</span>
                </div>
                <div className="side-row">
                  <span />
                  <span className="side-title">src/events/index.ts</span>
                  <span className="side-sub">＋12 −3</span>
                </div>
                <div className="stack">
                  <Button size="1">接受本轮</Button>
                  <Button size="1" color="red">
                    还原文件
                  </Button>
                </div>
              </div>
            </Tabs.Content>
            <Tabs.Content value="终端">
              <div className="grid" style={{ padding: "var(--s-3)" }}>
                <Text size="1" color="gray">
                  终端仍是待接项，预览不造假输出。
                </Text>
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </aside>
      </div>

      {a.toast !== null && (
        <div
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
            padding: "8px 14px",
            borderRadius: 8,
            background: "var(--surface)",
            border: "1px solid var(--hairline-strong)",
            boxShadow: "var(--shadow-pop)",
            fontSize: "var(--fs-xs)",
          }}
        >
          {a.toast}
        </div>
      )}
    </div>
  );
}
