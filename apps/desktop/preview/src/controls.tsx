import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  Dialog,
  DropdownMenu,
  IconButton,
  Popover,
  RadioGroup,
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
  Book,
  ChevronDown,
  Clock,
  Copy,
  FileDiff,
  Folder,
  Key,
  Layers,
  Loader,
  MoreHorizontal,
  PanelRight,
  Plus,
  Search,
  Settings,
  Shield,
  Sparkles,
  Sun,
  Terminal,
  Timer,
  X,
} from "lucide-react";

export function ControlGallery() {
  return (
    <div className="grid">
      <div className="frame">
        <div className="label">Button / IconButton（默认 · 描边 · 危险 · 禁用）</div>
        <div className="stack">
          <Button size="2">新建任务</Button>
          <Button size="2" variant="soft">
            排队中
          </Button>
          <Button size="2" variant="outline">
            还原文件
          </Button>
          <Button size="2" color="red">
            拒绝
          </Button>
          <Button size="2" disabled>
            禁用
          </Button>
          <Button size="2" loading>
            运行中
          </Button>
          <IconButton size="2" variant="ghost" aria-label="发送">
            <ArrowUp size={14} />
          </IconButton>
          <IconButton size="2" variant="ghost" aria-label="更多动作">
            <MoreHorizontal size={14} />
          </IconButton>
        </div>
      </div>

      <div className="frame">
        <div className="label">输入与选择（TextField · TextArea · Select · Segmented）</div>
        <div className="grid cols-2">
          <TextField.Root size="2" placeholder="搜任务">
            <TextField.Slot>
              <Search size={13} />
            </TextField.Slot>
          </TextField.Root>
          <Select.Root size="2" defaultValue="默认">
            <Select.Trigger />
            <Select.Content>
              <Select.Item value="只读">只读</Select.Item>
              <Select.Item value="默认">默认</Select.Item>
              <Select.Item value="引导">引导</Select.Item>
              <Select.Item value="自动">自动</Select.Item>
            </Select.Content>
          </Select.Root>
          <TextArea size="2" placeholder="要做什么？说目标和边界就行" />
          <SegmentedControl.Root size="2" defaultValue="聊天">
            <SegmentedControl.Item value="聊天">聊天</SegmentedControl.Item>
            <SegmentedControl.Item value="改动">改动</SegmentedControl.Item>
            <SegmentedControl.Item value="验证">验证</SegmentedControl.Item>
          </SegmentedControl.Root>
        </div>
      </div>

      <div className="frame">
        <div className="label">开关与选择组（Switch · Checkbox · RadioGroup）</div>
        <div className="stack">
          <Text size="2" as="label">
            <Switch size="1" defaultChecked /> 自动验证
          </Text>
          <Text size="2" as="label">
            <Switch size="1" /> 动作融合
          </Text>
          <Text size="2" as="label">
            <Checkbox /> 记忆改动范围
          </Text>
          <RadioGroup.Root size="1" defaultValue="once">
            <RadioGroup.Item value="once">只这一次</RadioGroup.Item>
            <RadioGroup.Item value="session">这类会话</RadioGroup.Item>
            <RadioGroup.Item value="always">总是</RadioGroup.Item>
          </RadioGroup.Root>
        </div>
      </div>

      <div className="frame">
        <div className="label">浮层与反馈（Popover · Dialog · Tooltip · DropdownMenu · Badge · Callout）</div>
        <div className="stack">
          <Popover.Root>
            <Popover.Trigger>
              <Button size="2" variant="soft">
                模型 · DeepSeek-V3.2 <ChevronDown size={13} />
              </Button>
            </Popover.Trigger>
            <Popover.Content size="2" style={{ width: 260 }}>
              <div className="grid">
                <Text size="2">DeepSeek-V3.2 · 128k</Text>
                <Text size="1" color="gray">
                  当前默认 · 已配置
                </Text>
                <Button size="1" variant="soft">
                  换模型
                </Button>
              </div>
            </Popover.Content>
          </Popover.Root>

          <Dialog.Root>
            <Dialog.Trigger>
              <Button size="2" variant="outline">
                审批卡（要拍板）
              </Button>
            </Dialog.Trigger>
            <Dialog.Content size="3" style={{ maxWidth: 480 }}>
              <Dialog.Title>要拍板</Dialog.Title>
              <Dialog.Description size="2">
                git worktree remove .agents/wt-77d0 --force
              </Dialog.Description>
              <div className="grid" style={{ marginTop: 12 }}>
                <Callout.Root color="amber" size="1">
                  <Callout.Icon>
                    <Shield size={13} />
                  </Callout.Icon>
                  <Callout.Text>删工作树会丢掉里面未合并的改动，风险 medium。</Callout.Text>
                </Callout.Root>
                <div className="stack">
                  <Button size="2">批准</Button>
                  <Button size="2" color="red">
                    拒绝
                  </Button>
                </div>
              </div>
            </Dialog.Content>
          </Dialog.Root>

          <Tooltip content="上下文占用 · 点开看明细">
            <IconButton size="2" variant="ghost" aria-label="上下文占用">
              <Layers size={14} />
            </IconButton>
          </Tooltip>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <IconButton size="2" variant="ghost" aria-label="更多动作">
                <MoreHorizontal size={14} />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content size="2">
              <DropdownMenu.Item>重命名</DropdownMenu.Item>
              <DropdownMenu.Item>固定</DropdownMenu.Item>
              <DropdownMenu.Item>分叉</DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item color="red">删除</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>

          <Badge color="green">已验证</Badge>
          <Badge color="amber">待接</Badge>
          <Badge color="red">验证未过</Badge>
          <Badge>第 12 轮</Badge>
        </div>
      </div>

      <div className="frame">
        <div className="label">Tabs · ScrollArea（右栏与设置分区的容器面）</div>
        <Tabs.Root defaultValue="审查">
          <Tabs.List size="2">
            <Tabs.Trigger value="辅助对话">辅助对话</Tabs.Trigger>
            <Tabs.Trigger value="审查">审查</Tabs.Trigger>
            <Tabs.Trigger value="终端">终端</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="辅助对话">
            <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: 150 }}>
              <div className="grid" style={{ padding: 8 }}>
                <Text size="2">只读问一句，不回填主线。</Text>
                <Text size="2">只能用读类工具，写与 shell 被禁。</Text>
                <Text size="2">结论要点「提升到主线」才进主会话。</Text>
                <Text size="2">这里是真实 ScrollArea 的滚动容器。</Text>
                <Text size="2">再补几行，方便看滚动条与滚动手感。</Text>
                <Text size="2">长会话应当保持顺滑。</Text>
              </div>
            </ScrollArea>
          </Tabs.Content>
          <Tabs.Content value="审查">
            <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: 150 }}>
              <div className="grid" style={{ padding: 8 }}>
                <Text size="2">src/agent/verify.ts ＋26 −4</Text>
                <Text size="2">src/events/index.ts ＋12 −3</Text>
                <Text size="2">tests/verify-cause.test.ts ＋3</Text>
                <Text size="2">验证通过 · 第 3/3 次</Text>
              </div>
            </ScrollArea>
          </Tabs.Content>
          <Tabs.Content value="终端">
            <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: 150 }}>
              <div className="grid" style={{ padding: 8 }}>
                <Text size="2">$ pnpm --filter cairn-desktop test</Text>
                <Text size="2">终端仍是待接项，原型不造假输出。</Text>
              </div>
            </ScrollArea>
          </Tabs.Content>
        </Tabs.Root>
      </div>

      <div className="frame">
        <div className="label">Card（交付摘要四格的结构面）</div>
        <Card size="2">
          <div className="grid cols-2">
            <div>
              <div className="label">改了什么</div>
              <Text size="2">3 个文件</Text>
            </div>
            <div>
              <div className="label">验证了什么</div>
              <Text size="2">验证通过 · 第 3/3 次</Text>
            </div>
            <div>
              <div className="label">哪些未验证</div>
              <Text size="2">无（当前改动有通过验证）</Text>
            </div>
            <div>
              <div className="label">下一步</div>
              <Text size="2">改动已验证，可进入审查</Text>
            </div>
          </div>
        </Card>
      </div>

      <div className="frame">
        <div className="label">图标（lucide · 统一 14px 网格）</div>
        <div className="stack">
          <Plus size={14} />
          <Search size={14} />
          <Clock size={14} />
          <Timer size={14} />
          <Folder size={14} />
          <Settings size={14} />
          <Shield size={14} />
          <Key size={14} />
          <Sparkles size={14} />
          <FileDiff size={14} />
          <Terminal size={14} />
          <PanelRight size={14} />
          <Copy size={14} />
          <Loader size={14} />
          <X size={14} />
          <Sun size={14} />
          <Book size={14} />
        </div>
      </div>
    </div>
  );
}
