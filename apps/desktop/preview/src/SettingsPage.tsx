import { Badge, Button, Select, Switch, Text, TextField } from "@radix-ui/themes";
import { Book, Brain, Clock, Key, Layers, Plus, Search, Settings as SettingsIcon, Shield, Target, Timer, X } from "lucide-react";
import { useState } from "react";

type AppState = ReturnType<typeof import("./appState").useAppState>;

const NAV = [
  { group: "个人", items: ["常规", "外观", "通知"] },
  { group: "工作区", items: ["模型与 Provider", "权限与安全", "行为与成本"] },
  { group: "数据与集成", items: ["记忆与数据", "自动化任务", "插件与扩展"] },
  { group: "系统", items: ["键盘快捷键", "关于与更新"] },
];

const ICONS: Record<string, JSX.Element> = {
  常规: <SettingsIcon size={14} />,
  外观: <Layers size={14} />,
  通知: <Clock size={14} />,
  "模型与 Provider": <Key size={14} />,
  "权限与安全": <Shield size={14} />,
  "行为与成本": <Brain size={14} />,
  "记忆与数据": <Book size={14} />,
  自动化任务: <Timer size={14} />,
  "插件与扩展": <Plus size={14} />,
  键盘快捷键: <Target size={14} />,
  "关于与更新": <SettingsIcon size={14} />,
};

export function SettingsPage(props: { app: AppState; onBack: () => void; root?: boolean }) {
  const a = props.app;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  return (
    <div className={"settings-shell" + (props.root === true ? " root" : "")}>
      <nav className="ss-nav">
        <div className="ss-title">设置</div>
        <TextField.Root
          size="2"
          placeholder="搜索设置"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginBottom: 12 }}
        >
          <TextField.Slot>
            <Search size={13} />
          </TextField.Slot>
        </TextField.Root>
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="ss-group-label">{g.group}</div>
            {g.items
              .filter((it) => it.toLowerCase().includes(q))
              .map((it) => (
                <button
                  key={it}
                  className={"ss-item" + (a.settingsSection === it ? " on" : "")}
                  onClick={() => a.setSettingsSection(it)}
                >
                  {ICONS[it]}
                  <span>{it}</span>
                </button>
              ))}
          </div>
        ))}
        <button className="ss-item" onClick={props.onBack} style={{ marginTop: 16 }}>
          <X size={14} />
          <span>返回对话</span>
        </button>
      </nav>

      <div className="ss-body" style={{ overflow: "auto" }}>
        {a.settingsSection === "常规" && (
          <>
            <Text size="5" weight="bold" as="div">
              常规
            </Text>
            <Text size="1" color="gray" as="p" style={{ margin: "4px 0 18px" }}>
              默认权限、工作区与窗口行为。改动即时生效。
            </Text>
            <div className="frame" style={{ padding: 0, border: 0, boxShadow: "none" }}>
              <div className="ss-row">
                <span>
                  <b>默认权限档</b>
                  <small>新会话的起始档位。</small>
                </span>
                <Select.Root size="2" value={a.mode} onValueChange={a.setMode}>
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
                  <b>界面语言</b>
                  <small>当前值：{a.language}</small>
                </span>
                <Select.Root size="2" value={a.language} onValueChange={a.setLanguage}>
                  <Select.Trigger />
                  <Select.Content>
                    <Select.Item value="中文">中文</Select.Item>
                    <Select.Item value="English">English</Select.Item>
                  </Select.Content>
                </Select.Root>
              </div>
            </div>
          </>
        )}

        {a.settingsSection === "外观" && (
          <>
            <Text size="5" weight="bold" as="div">
              外观
            </Text>
            <Text size="1" color="gray" as="p" style={{ margin: "4px 0 18px" }}>
              主题在顶部控制条切换；这里保留分区以便对齐原型。
            </Text>
            <div className="frame">
              <div className="ss-row">
                <span>
                  <b>主题</b>
                  <small>浅色 / 深色，用右上控制条切换。</small>
                </span>
                <Badge color="gray">顶部控制条</Badge>
              </div>
            </div>
          </>
        )}

        {a.settingsSection === "权限与安全" && (
          <>
            <Text size="5" weight="bold" as="div">
              权限与安全
            </Text>
            <Text size="1" color="gray" as="p" style={{ margin: "4px 0 18px" }}>
              开关状态会保存到 localStorage。
            </Text>
            <div className="frame" style={{ padding: 0, border: 0, boxShadow: "none" }}>
              <div className="ss-row">
                <span>
                  <b>方案门缺省</b>
                  <small>新对话默认要求先批准方案才能写入。</small>
                </span>
                <Switch size="1" checked={a.planGate} onCheckedChange={a.setPlanGate} />
              </div>
              <div className="ss-row">
                <span>
                  <b>完整访问权限</b>
                  <small>不绕过全局 deny、路径白名单或外发审批。</small>
                </span>
                <Switch size="1" checked={a.fullAccess} onCheckedChange={a.setFullAccess} />
              </div>
            </div>
          </>
        )}

        {a.settingsSection === "行为与成本" && (
          <>
            <Text size="5" weight="bold" as="div">
              行为与成本
            </Text>
            <Text size="1" color="gray" as="p" style={{ margin: "4px 0 18px" }}>
              持久化开关，改动后下一轮生效。
            </Text>
            <div className="frame" style={{ padding: 0, border: 0, boxShadow: "none" }}>
              <div className="ss-row">
                <span>
                  <b>自动验证</b>
                  <small>改完自动跑 verify 收束。</small>
                </span>
                <Switch size="1" checked={a.autoVerify} onCheckedChange={a.setAutoVerify} />
              </div>
              <div className="ss-row">
                <span>
                  <b>动作融合</b>
                  <small>编辑与验证并步执行。</small>
                </span>
                <Switch size="1" checked={a.actionFusion} onCheckedChange={a.setActionFusion} />
              </div>
            </div>
          </>
        )}

        {!["常规", "外观", "权限与安全", "行为与成本"].includes(a.settingsSection) && (
          <>
            <Text size="5" weight="bold" as="div">
              {a.settingsSection}
            </Text>
            <Text size="1" color="gray" as="p" style={{ margin: "4px 0 18px" }}>
              预览里这一分区只落导航与容器，控件沿用同一套组件。
            </Text>
            <div className="frame">
              <Button size="1" variant="soft" onClick={() => a.notify(`${a.settingsSection}：预览占位`)}>
                触发一次回执
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
