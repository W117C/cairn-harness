---
name: greet
description: 用固定句式打招呼（明卷 skill：触发后全文进上下文）。
argument-hint: [名字]
---
# Greet Skill

对 $ARGUMENTS 说三声你好：

- 你好，$1！
- Hello, $1!
- こんにちは、$1！

（本行验证缺位参数替换为空串：$9 -> 结束）
