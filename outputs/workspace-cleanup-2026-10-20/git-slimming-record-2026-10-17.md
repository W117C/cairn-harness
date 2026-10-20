== 2026-10-17 git 瘦身前后 ==
前: .git 411M / size-pack 393.57 MiB / in-pack 22960 / refs 85（含 refs/codex 21 tree + refs/cline 18 commit）
后: .git  58M / size-pack 55.93 MiB / in-pack 18710 / refs 46
机制: 删除 refs/codex/* (21 个 tree 引用) + refs/cline/* (18 个 commit 引用)，reflog 未动，无历史改写（所有分支 hash 不变）
删除的引用清单: refs-codex-cline-2026-10-17.txt
大 blob（已回收）: graphflow-out sqlite 275.8MB / Electron 202.7MB / Cairn-macOS.zip 156.0MB / graphflow json 99.0MB
