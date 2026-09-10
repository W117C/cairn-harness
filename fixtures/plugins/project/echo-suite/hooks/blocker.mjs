// 明卷 hook：exit 2 阻断路径（stderr 反馈为阻断原因）
console.error("hook-blocker: tool call rejected by plugin hook");
process.exit(2);
