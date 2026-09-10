// 明卷 hook：exit 0 + stdout 上下文回注（SessionStart / UserPromptSubmit / PostToolUse）
const marker = process.argv[2] ?? "hookctx:unknown";
const root = process.env.PLUGIN_ROOT ? "root-set" : "root-missing";
process.stdout.write(marker + " " + root);
