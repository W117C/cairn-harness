"""两臂的机制读数：请求数 / 工具调用数 / read_file 是批量还是单份 / 改了几个文件。

为什么要有这一格（第 477 页）：`B12-long-horizon` 的成败只有 0/1 一个数（噪声带 1 个任务），
但**调用形状**是不那么受噪声影响的一个量——「一轮一支读 40 份」与「4 次批量读覆盖 40 份」
在事件流里长得完全不同。
"""
import collections, glob, json, os, sys

def summarize(path: str) -> str:
    rows = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
    calls = [(r.get("name"), r.get("args") or {}) for r in rows if r.get("type") == "tool_call"]
    by = collections.Counter(n for n, _ in calls)
    batch = [a for n, a in calls if n == "read_file" and isinstance(a.get("paths"), list)]
    single = [a for n, a in calls if n == "read_file" and not isinstance(a.get("paths"), list)]
    reads = collections.Counter()
    for r in rows:  # 每请求工具调用数
        if r.get("type") == "tool_call": reads["calls"] += 1
    reqs = sum(1 for r in rows if r.get("type") == "usage")
    return (os.path.basename(os.path.dirname(path)) + "｜请求 " + str(reqs) + "｜工具 " + str(sum(by.values())) +
            " " + json.dumps(dict(by), ensure_ascii=False) +
            "｜read_file：批量 " + str(len(batch)) + " 次(覆盖 " + str(sum(len(a["paths"]) for a in batch)) + " 份)" +
            " / 单份 " + str(len(single)) + " 次")

for p in sys.argv[1:]:
    for f in sorted(glob.glob(p)):
        print(summarize(f))
