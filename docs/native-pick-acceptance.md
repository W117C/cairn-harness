# 原生面板点选：人工验收（唯一自动化判不到的一跳）

## 为什么有这份文档

`wallpaper.native-click` 这一格**自动化判不到**：Electron 没有「替人点面板」的 API，
`osascript` 的 UI 自动化在本机又拿不到辅助功能权限（实测超时）。

但这一跳不能就这么消失，所以：

- 对表里它记 `out` 且写明理由（不是 `covered`，不许当没这回事）；
- 仓库里有一条**一条命令跑完**的验收脚本，把结果打成读数落盘。

## 怎么跑

```bash
cd apps/desktop
ELECTRON_OVERRIDE_DIST_PATH=<path-to-electron-dist> \
  npx electron scripts/native-pick-accept.cjs outputs/native-pick-accept
```

脚本会：开一个真窗口 → 弹**真系统面板** → 等你点一个文件（或取消，最多 60 秒）。

## 判读

| 读数 | 含义 |
|---|---|
| `PASS(selected)` | 面板真的把路径交回来了（`path` 非空）——这一跳验过 |
| `PASS(canceled)` | 取消 → `canceled: true`（取消是合法结果，不是错误） |
| `TIMEOUT` | 60 秒没人操作：**没验到**，不等于通过 |
| `FAIL(empty)` | 面板返回了空（既没选中也没取消）——异常 |

结果落在 `outputs/native-pick-accept/native-pick-accept.json`。

等不及 60 秒可以缩短：`CAIRN_NATIVE_PICK_WAIT_MS=5000`（改成 5 秒）。
自测记录器本身（不点任何东西）：用 3 秒跑一次，应得到 `TIMEOUT` 且 JSON 落盘——那说明「记录在、判读在」，只是这一跳还没人验。

## 已经自动判到的部分（别重复验）

| 臂 | 判据位置 | 证到什么 |
|---|---|---|
| 面板调起 | `scripts/wallpaper-csp-smoke.cjs` ⑬ | Promise 被面板攥住 ≥1s，关窗才结算 |
| 取消语义 | 同上 | `canceled: true` 且无 `error` |
| 选中之后 | 同上 ⑬b（点选替身臂） | 真决策壳 + 真校验：选中 ⇒ `ok/kind/path`；非白名单 ⇒ 拒 |
| 应用内选择器 | `wallpaper-browse.test.ts` / `wallpaper-browser.test.tsx` / 冒烟 ⑧b | 真点击选文件 ⇒ 真校验并应用 |
