# 公开标准对照（由真机读数生成）

生成于 2026-11-16T11:03:21.393Z｜总判：**pass**

| 标准 · 条款 | 阈值 | 实测 | 判定 | 来源 |
|---|---|---|---|---|
| WCAG 2.2 · SC 1.4.3 Contrast Minimum | 4.5 ratio | 4.526 | pass | `/Users/ze/alma/worktrees/cairn/superior-starfish/outputs/wallpaper-deep-2026-11-16/readings.json` |
| CSP Level 3 · 越权取图必须被 CSP 拦下 | 1 violations | 1 | pass | `/Users/ze/alma/worktrees/cairn/superior-starfish/outputs/wallpaper-deep-2026-11-16/readings.json` |
| CSP Level 3 · 硬化指令（object-src / base-uri / form-action） | 3 directives | 3 | pass | `/Users/ze/alma/worktrees/cairn/superior-starfish/outputs/wallpaper-deep-2026-11-16/readings.json` |
| CSP Level 3 · script-src 不含 unsafe-inline | 0 occurrences | 0 | pass | `/Users/ze/alma/worktrees/cairn/superior-starfish/outputs/wallpaper-deep-2026-11-16/readings.json` |
| CSP Level 3 · frame-src 放开面（只 https:，无 data:/blob:/http:） | 1 ok | 1 | pass | `/Users/ze/alma/worktrees/cairn/superior-starfish/outputs/wallpaper-deep-2026-11-16/readings.json` |
| Electron 安全清单 · contextIsolation / 无 nodeIntegration / sandbox / 无 node 全局 | 4 checks | 4 | pass | `/Users/ze/alma/worktrees/cairn/superior-starfish/outputs/wallpaper-deep-2026-11-16/readings.json` |
| WCAG 2.2 · SC 2.1.1 Keyboard（只用键盘选壁纸） | 1 flows | 1 | pass | `/Users/ze/alma/worktrees/cairn/superior-starfish/outputs/wallpaper-deep-2026-11-16/readings.json` |
| OWASP Top 10 2021 · A09 敏感值不得进日志（脱敏后残留） | 0 occurrences | 0 | pass | `scripts/standard-report.ts` |
| 本方对表 · 评分面 covered 比例（对表自己声明的阈值） | 0.96 ratio | 1 | pass | `fixtures/parity/checklist.json` |
