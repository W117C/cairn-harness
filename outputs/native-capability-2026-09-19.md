# 原生件可用性实测捕获（2026-09-19）

跑的是同目录 `native-capability-probe-2026-09-19.js`，加载本仓真实构建产物 `out/renderer/index.html`，
在主进程里 `executeJavaScript` 取值（与 `panels-check` 同一注入方式，不受页面 CSP 影响）。

- 宿主：macOS arm64；Electron **44.2.0**；UA 报 **`Chrome/152.0.7977.76`**
  ——与我从 `Electron Framework` 二进制里读出的版本号**独立吻合**（两条互不相干的证据）。
- **00:34 连跑两次，27 项读数完全一致**（下方即原始 JSON）。
- ⚠️ **复跑不稳定**：00:42 起三次复跑在宿主 load 5+ 时挂住未出结果，且脚本自带的 45s 看门狗也没能终止它
  （卡在原生初始化阶段，定时器压根没轮到跑）。⇒ **本探针必须与 Electron 类门禁串行、且在低负载时跑**；
  挂住 ≠ 能力缺失，别据此推翻结论。下面这份是成功那两次的原始捕获。

## 原始读数（27/27 全 true）

```json
{
 "uaChrome": "Chrome/152.0.7977.76",
 "popoverInProto": true,
 "popoverAttrValue": "auto",
 "popoverTargetElement": true,
 "allowDiscrete": true,
 "startingStyleRule": true,
 "anchorName": true,
 "positionAnchor": true,
 "positionTryFallbacks": true,
 "positionTryOrder": true,
 "anchorSizeFn": true,
 "dialogElement": true,
 "dialogShowModal": true,
 "dialogBackdropRule": true,
 "lightDark": true,
 "fieldSizing": true,
 "containerType": true,
 "containerQueryRule": true,
 "hasSelector": true,
 "contentVisibility": true,
 "startViewTransition": true,
 "colorMix": true,
 "oklch": true,
 "textWrapBalance": true,
 "scopeRule": true,
 "layerRule": true,
 "detailsSupported": true
}
```

## 这份读数结掉了什么

台账 P2 组原先挂着一道**硬闸 T11**：「本组每条开工前先实测 `CSS.supports(...)`，我不替版本号推断背书」。
现在闸已开，且是**在本仓渲染进程里**测的，不再是"由 Chromium 152 推得"：

| P2 条目 | 依赖能力 | 实测 |
| --- | --- | --- |
| T13 浮层 4→1 | `popover` + `popovertarget` + 锚点定位（`anchor-name` / `position-anchor` / `position-try-*` / `anchor-size()`） | **全 true** |
| T13 浮层入场/退场动画 | `@starting-style` + `transition-behavior: allow-discrete` | **全 true** |
| T14 模态 2→1 | `<dialog>` + `showModal()` + `::backdrop` | **全 true** |
| T18 令牌 2 块→1 块 | `light-dark()` | **true**（`color-mix` / `oklch` 亦 true） |
| T19 composer 去测高 JS | `field-sizing: content` | **true** |
| T20 断点→容器查询 | `container-type` + `@container` | **全 true** |
| （额外）`@scope` / `@layer` | 分层与作用域样式 | **均 true**，T18/T20 落地时可选用 |

**未证残余**：以上只证明「平台提供该能力」，**不证明**用它替换后行为等价——
`popover` 的 light-dismiss 与手写 `showPop` 的 outside-click/Esc 语义是否逐条对得上，
属 T13 自己的验收面；且原生件替换会触碰 `panels-check` 的 22 条钩子白名单，仍需先过白名单。
