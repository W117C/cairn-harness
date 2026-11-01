# 同一条「是不是 JSON 对象」，42 个文件各写了一遍 · 2026-11-01

检查起点 HEAD `f9fc87e8`；本批主体已随 `c0ad6546` 入库，收口的两处在工作树（见文末）。

## 这一批改了什么

`isRecord`（非 null、非数组的 object）此前在 42 个文件里各写一遍：37 份是命名副本
（`isRecord` / `isObject` / `isPlainObject`），另有 6 处直接内联。它是 JSON sidecar、账本、
注册表、ACP/A2A 消息与渲染层存储解析的第一道形状门。

- 新增 `src/is-record.ts`，只放这一条判据；42 个消费面改读同一份。
- `isObject` / `isPlainObject` 两个别名一并收口；内联的六处也改成调用共享判据。
- `src/agent/evidence.ts` 原先漏了 `!Array.isArray`：数组也能通过 `isRecord`，`validateReceipt`
  会把「挂了收据字段的数组」当成合法收据（旧实现复现为 `{ ok: true }`）。统一后按
  schema-mismatch 拒收；正常 `JSON.parse` 路径不受影响。

## 读数（工作树，未提交）

| 判卷面 | 读数 |
|---|---|
| 现读 | 命名定义 **37 → 1**；内联 **6 → 0**；import 同一份 **42 处** |
| 红 1：共享实现去掉数组判定 | **3 红**（数组值域 / 伪造收据 / canonical 文本） |
| 红 2：`evidence.ts` 写回漏数组的旧副本 | **2 红**（伪造收据 / 源码唯一性；点名 `src/agent/evidence.ts`） |
| 绿 | 复原后 **3/3 绿**，两处 sha256 与造红前一致 |
| 定向相关判卷 | **6 文件 / 92 条全绿**（autonomy / evolution-autonomy / project-templates / session-lock ×2 + 本批） |
| 桌面 last-session 判卷 | **2 文件 / 11 条全绿** |
| 两端 typecheck | 0 / 0 |
| 核心套件 | 见 `core.log` |
| 桌面套件 | 见 `desktop.log` |
| docs-check | 见 `docs-check.log` |

## 文件

- `red-1-arrays.log` / `red-2-local-copy.log` / `green.log`：造红与复原后的原文。
- `core.log` / `desktop.log` / `typecheck-root.log` / `typecheck-desktop.log` / `docs-check.log`。
- `scope.txt`：共享实现、判卷与 42 个消费面的清单。

## 边界

- 只搬判据、不改各消费面的字段校验；`isRecord` 对 Date / 类实例的口径保持 `true`（只排除
  null、数组与原始值），与除 `evidence.ts` 外的旧副本一致。
- `apps/desktop/release/` 里的打包副本是构建产物，没手改；重建会随源码更新。
- 没有批量替换所有 `typeof x === "object"`（有些是联合类型/字段探针，不是同一条值域判据）。
- 未跑 `gates` / `head-cert` / `mutate-verify`；本批主体（共享实现、41 个消费面、scripts
  两份与四处内联）在 `c0ad6546`，最后收口的 `last-session` 内联与判据增补在工作树。
