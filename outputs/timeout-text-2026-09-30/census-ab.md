# 第 219 页 · 墙钟文案普查尺的同分母 A/B（2026-09-30）

尺＝`tests/timeout-text-single-source.test.ts` 的普查规则（同一份实现，两侧只差代码）：
取料面＝`src/**/*.ts`，先剥块注释与整行 `//`；**站点**＝出现「超时（」的代码行；**写死**＝那个括号后紧跟数字。

```bash
# 新代码（主树工作树＝本笔）
cd "/Users/ze/Downloads/deepseek harness" && node -e '<同一只普查>'
# 旧代码（上一笔认证树，`e493e24`＝本笔的父提交）
cd "/Users/ze/Downloads/deepseek harness/.worktrees/head-cert-e493e24" && node -e '<同一只普查>'
```

| 侧 | 站点 | 写死 | 写死的是哪两条 |
| --- | --- | --- | --- |
| 旧 `e493e24` | 13 | **2** | `src/tools/glob.ts:28`、`src/tools/run_shell.ts:30` |
| 新（本笔） | 13 | **0** | — |

⇒ **同分母 A/B：2 → 0**（站点数一字未动，说明没有靠"少看几处"换来干净名单；规则 293 的口径）。
站点跨 10 个文件，含早就正确的 `src/agent/verify.ts`、`src/tools/ripgrep.ts`、`src/main/sandbox.ts`、
`src/tools/lsp.ts`、`src/agent/gates.ts`、`src/main/scheduler.ts` 等 ⇒ 这一族的多数成员本来就吃常量，
补齐的是掉队的那两支（同族两种宽度＝迟早漂，第九族第三次命中）。

## 负控（证明"0"是有分辨力的 0）
1. 分母在场：`sites.length ≥ 4` 且**点名**四支所在文件（防不相干的「超时（」凑数）；
2. 合成源里 `"[error: run_shell 超时（60s），已强制终止]"` 必须被读成写死、而 `"…超时（" + String(ms / 1000) + "s）"` 不算；
3. 注释里的「超时（60s）」不算站点 ⇒ 剥注释是真剥。

## 锚点（表长 1044→1046）
`timeout-note-run-shell-rehardcodes-seconds`、`timeout-note-glob-rehardcodes-seconds`——
两条都是"把秒数写回正文"，普查尺当场红。针脚两侧各 `grep -c -F` = 1（唯一命中）。
