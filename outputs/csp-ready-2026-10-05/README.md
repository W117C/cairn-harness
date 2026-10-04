# 桌面 renderer 的 CSP ＋ webPreferences.sandbox：ready-to-apply（备于 2026-10-05）

## 为什么备而不是落

`apps/desktop/**` 此刻**整片在飞**（另一会话正改 main/index.ts、renderer、tests 等 14 支）。
按纪律我不抢面。所以按本仓 `d61-fix-ready` / `d57-fix-ready` 先例备成可复核的落地件。

## 这条缺口是谁点的

2026-10-03 技术评审 §7「覆盖缺口」原话：

> 桌面 renderer 的 CSP/XSS 面（`contextIsolation` 与 `nodeIntegration` 已设正确，但**未见 CSP**）

现读复核（2026-10-05）——**属实，而且比原话多一条**：

| 项 | 现状 |
|---|---|
| `contextIsolation: true` | ✅ 已设 |
| `nodeIntegration: false` | ✅ 已设 |
| **CSP** | ❌ 无（`index.html` 里零命中） |
| **`webPreferences.sandbox`** | ❌ 未设（Electron 缺省为关） |

## 补丁两半

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/renderer/index.html` | 加 `<meta http-equiv="Content-Security-Policy">` |
| `apps/desktop/src/main/index.ts` | `webPreferences` 加 `sandbox: true` |

**CSP 取值**：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none';
form-action 'none'; frame-ancestors 'none'`

**为什么 `style-src` 留 `'unsafe-inline'`**：React 的行内 `style` **属性**归它管，去掉会把
界面样式打掉。这是**按现状可达的最严**，不是理论上最严——我宁可写清这一处让步，也不假装它更严。
（`index.html` 自身零内联 `<style>`／`<script>`，所以其余几项可以收到 `'self'`。）

**为什么 `sandbox: true` 是安全的**：preload（`src/preload/index.ts`）只 `import { contextBridge,
ipcRenderer } from "electron"`（沙箱下允许），另两个 import 是 `import type`（类型，编译期擦除）
与 `../main/channels`（被 esbuild `--bundle` 打进 preload.cjs）⇒ **开沙箱不需要它多要任何权限**。

## 备妥时验到什么程度（照实说）

- ✅ 补丁 `git apply --check --cached` 对 **HEAD 版**两处都贴得上；
- ✅ 靠**读代码**确认 preload 的依赖面在沙箱下成立（上面那条推理）；
- ❌ **没跑过**：没建桌面端、没跑 `--filter cairn-desktop test`、没跑冒烟。
  因为两支目标文件都在飞，就地改它们等于把对方的在飞改动卷进来。
  ⇒ 所以**落地门把这三种验证都排在 apply 之后**，那一刻才作数。

## 落地步骤

```sh
node outputs/csp-ready-2026-10-05/apply.mjs            # 只读前置
node outputs/csp-ready-2026-10-05/apply.mjs --apply    # 落 + 建 + 测 + 冒烟
```

**未做的（不假装已做）**：没给这两个改动配判据。CSP 与 sandbox 都是**配置声明**，
可判的行为面在"渲染进程能不能被注入执行"——那需要一条真跑 XSS 的端到端用例，
而桌面端此刻不在 v1 交付面上（ADR 0001 范围裁决）。**这一句是取舍，不是遗漏**：
按 ADR，桌面面的大多数工作都排在 v1 之后，本条是"便宜的先拿掉"。
