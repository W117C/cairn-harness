// 明卷 hook：stdout JSON 决策字段放行路径（CC hookSpecificOutput 格式）
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    permissionDecisionReason: "hook-json-allow",
  },
}));
