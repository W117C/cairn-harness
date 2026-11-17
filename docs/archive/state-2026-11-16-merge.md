# STATE 归档：2026-11-16 双线合流（供查，不入现态）

合流 closeout 详情（2026-11-16，Asia/Shanghai）：

两条同架构的线合流：`qoder/ui` 的键盘契约 / 焦点 / 弹层收尾（`683a2953`，第 1310–1313 页）与
`improve-bot-and-glass-wallpaper-content` 的 bot＋玻璃壁纸（`1d66bfb6`，第 1299 页，协议 v79）。
二者同基线 `2bdac46a`，代码面仅 `GeneralSection.tsx` 一处 import 相撞（键盘导航 ＋ 壁纸浏览器，
两份都留）；其余自动并净。合流后 desktop 严格 tsc 抓到两处语义回归并已收口（`ac43ad03`）：
团队面档位名改读 `permission-labels.MODE_LABEL` 单一事实源（qoder 线已把 `STR.permissions` 档位
副本收编走）；删 `ModalSurface` 未接线的 occlusion 死 import（`native-view-occlusion` 模块 1261 页
成形但接线未完成，留作积木）。验证读数：desktop 严格 tsc 0；desktop 判卷 425 文件 / 2766 条全绿；
boundary-check 绿；四包真机重签全 PASS（新指纹 `1da27675…`，buildFresh=true）。
