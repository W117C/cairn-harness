# WindowVibrancy 研究记录（2026-10-21）

## 1. 我们在 v3 里看到了什么

v3 的 IPC 通道面有 `claude.windowVibrancy` 命名空间，四条：

- `WindowVibrancy_showUnderSidebar`
- `WindowVibrancy_tintUnderSidebar`
- `WindowVibrancy_clearTintUnderSidebar`
- `WindowVibrancy_clear`

静态提取只能证明这些名字存在，不能证明视觉参数、触发时机或当前账号是否启用。asar 里没有对应的
CSS 类；聊天正文与侧栏是远端 claude.ai，本地壳只负责窗口容器。因此不能从这四条推出「侧栏必须
是毛玻璃」的结论。

## 2. 隔离原型

用一个独立 Electron 窗口验证 macOS `vibrancy: "sidebar"` 在当前机器上的实际表现：

- 窗口：900×600，`show:false`，`vibrancy:"sidebar"`，`visualEffectState:"active"`，
  `backgroundColor:"#00000000"`，`offscreen:true`。
- 页面：左侧 260px 半透明侧栏（`rgba(250,249,245,.55)`），右侧不透明内容区。
- 用 `webContents.capturePage()` 取图，保存为同目录的 `vibrancy-proto.png`。
- 读数：侧栏呈现浅色材质、内容区保持不透明；`capturePage` 在离屏窗口可用，不依赖屏幕录制。

## 3. 为什么没有直接改产品

- 原型只证明「Electron 的 vibrancy 能出来」，没有证明「Claude v3 的侧栏就是这样」；
- 2026-10-21 用隔离 userData 起真实主窗口做了一次亮色单点采样：侧栏底 rgb(251,251,249)、
  正文 rgb(20,20,19)，对比约 17.8:1；暗色开/关两组侧栏采样同为 rgb(20,20,19)，
  screencapture 看不出材质差异 ⇒ 仍不能证明 vibrancy 生效，也缺桌面底切换读数。
- 同一轮还试过去掉 `backgroundColor` 只留 `transparent`/`vibrancy`：暗色侧栏采样仍是
  `rgb(20,20,19)`，与保留背景色无差；已回退，说明问题不在这一项。
- 同一轮启动日志：窗口配置 `backgroundColor:"#00000000"`，`win.getBackgroundColor()` 返回
  `#000000`；这可能只是 Electron 对透明窗口读数的归一化，也可能是 alpha 未保留，
  **不能单独据此断言 broken**。但截图层面无可见差异，实验开关仍不能宣传成可用。
- Cairn 主窗口当前是整窗不透明，改成透明窗要同时审：首帧底色、暗色对比度、侧栏 hover/选中态、
  窗口阴影、全屏/多显示器、popout 窗口参数；
- 这是一条需要 owner 裁决的视觉路线，不应该在未确认前把默认外观改成半透明。

## 4. 如果要做，最小落地顺序

1. 已加 macOS-only 环境变量开关（默认关）：`CAIRN_WINDOW_VIBRANCY=sidebar|1`（2026-10-21，
   见 `apps/desktop/src/main/window-vibrancy.ts`）；正式设置项仍未做；
2. 主窗口 `vibrancy:"sidebar"` + `transparent:true` + 透明 `html/body/#root`；
3. 只让 `.side` 透出材质，内容区与 composer 保持不透明；
4. 暗色、浅色、高对比三档逐张截图；对比度不达标的文字不硬上（当前 side 底 75%，
   按 token 算 text-400/500 最差约 4.7:1；真机仍未验）；
5. 设置变更需重建窗口或 `setVibrancy`，同时验证 popout 与首帧占位。

## 5. 边界

- 原型不是 Claude 的真实外观，不作为「已对齐」证据；
- 本轮没有改产品代码；
- 仍受 v3 拒绝 `--remote-debugging-port` 与关闭 accessibility 的限制，真机几何未取得。
