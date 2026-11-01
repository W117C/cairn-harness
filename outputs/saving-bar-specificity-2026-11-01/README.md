# 「保存中常显」那条规则从来没生效过 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 怎么发现的

第 960 页的冒烟普查里 `state-smoke` 红了一条：「请求未完成时操作条保持可见，移开鼠标也能看到保存状态」。
本轮先用探针把现场量出来（不改产品、只看）：

```
PROBE {"btn":true,"saving":"true","opacity":"0","transition":"0.06s"}
```

`data-saving="true"` **已经在元素上了**，`opacity` 却是 0——说明「保存中常显」那条 CSS 没命中。

## 根因：specificity

| 规则 | 文件 | specificity |
|---|---|---|
| `.row-actions[data-saving="true"] { opacity: 1 }` | `styles.css` | (0,2,0) |
| `body[data-dsh-claude-style] .row .row-actions[data-cds="MessageActions"] { opacity: 0 }` | `cds-components.css` | **(0,4,1)** |

claude 风格那组选择器更具体、且在后加载——所以「保存中常显」**从来没生效过**：点完赞/踩、请求还在飞时把鼠标移开，操作条照样淡出，用户看不到「保存中」。

## 改法

在 `cds-components.css` 里补一条同族但更高的：

```css
body[data-dsh-claude-style] .row .row-actions[data-cds="MessageActions"][data-saving="true"] {
  opacity: 1;
  transition: opacity var(--dur-fast) var(--ease-out);
}
```

## 读数（都是真跑）

| 面 | 改前 | 改后 |
|---|---|---|
| 探针 `opacity`（saving=true 时） | **0** | **1** |
| `state-smoke` | 1 FAIL（第 51 行那条） | **11 PASS / 0 FAIL，exit 0** |
| 桌面套件 | — | **310 文件 / 2085 条全绿**，exit 0（含 boundary 绿） |

## 边界

- 只补「保存中」这一档的可见性；淡入淡出的时序（`--dur-fast` / `--dur-snap`）一个没动。
- 条件选择器写在 `cds-components.css` 而不是 `styles.css`：继承同一组（0,4,1）前缀才能压过那条 `opacity: 0`。
- 这条只影响 **claude 风格**（`body[data-dsh-claude-style]`）；默认风格下 `styles.css` 那条本来就能生效——探针跑的是 claude 风格，所以只有它红。
