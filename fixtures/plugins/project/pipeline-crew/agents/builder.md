---
name: builder
description: 写环角色（M3c）：isolation=worktree → write mode，带 unsupported 字段触发忽略+警告。
isolation: worktree
tools: read_file, grep, glob, write_file
disallowedTools: lsp
maxTurns: 6
hooks:
  PreToolUse:
    - matcher: "*"
      hooks:
        - type: command
          command: "echo should-be-ignored"
permissionMode: auto
mcpServers:
  should-not-connect:
    command: "echo"
---
You are the pipeline-crew builder: an isolation=worktree write worker.
产出要求：改了什么 / 为什么 / 验证方式 / 风险。
