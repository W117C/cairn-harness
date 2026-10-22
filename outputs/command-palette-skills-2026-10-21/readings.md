# 技能进命令面板 · 真机读数（2026-10-21 批 136）

隔离实例 9364（`/tmp/cairn-skills-ws`，1440×900）。工作区种子：
`.agent/skills/demo/SKILL.md`（project 作用域 ⇒ 待批准）。

## 读数

- 主页未选项目时 `listSkills("")` 为空（activeWorkspace=null，技能属于项目语义）——不摆空组。
- 通过项目 chip 选中 `cairn-skills-ws` 后，⌘K 分组：
  `操作 / 技能 / 会话 / 项目 / 设置`。
- 技能行：`/demo` + 描述「演示技能：把当前项目跑起来并列出入口。」+「待批准」chip；
  `.cp-skill` 行高 40px，两行（invoke/描述）。
- 选中技能：面板关闭，输入框值 `"/demo "`，`document.activeElement` 回到 composer 输入框；
  只填入不发送（与斜杠菜单同一落点）。斜杠菜单未自动展开（injection 不重建 slash 查询），
  但命令已就位，用户可直接补上下文或回车发送。

## 截图

- `skills-group.png`
- `inserted-into-composer.png`
