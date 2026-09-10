// 明卷 hook：超时强杀路径（5 秒睡眠 vs hooks.json timeout: 1 → SIGKILL）
await new Promise((resolve) => setTimeout(resolve, 5000));
process.stdout.write("slow hook finished (should never print)");
