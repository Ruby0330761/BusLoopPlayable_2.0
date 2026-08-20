# BusLoop Playable 制作交接指南

这份文档面向接手本项目的制作同事，覆盖本地编辑器、参数保存、AppLovin 打包和验收时最容易遗漏的事项。

## 1. 接手后先看哪些文件

- 当前成品和最近状态：`docs/project/playable-project-progress.md`
- 查找代码入口：`docs/project/code-navigation.md`
- 本交接指南：`docs/project/playable-handoff-guide.md`
- AppLovin 规则：`docs/platforms/applovin-playable-audit.md`
- 人工验收：`docs/project/platform-manual-validation-checklist.md`

不要一开始扫描整个工程。先根据 `code-navigation.md` 找到对应模块，再让 AI 读取相关文件和测试。

## 2. 在本地浏览器打开编辑器

在项目根目录执行：

```powershell
npm install
npm run dev
```

`npm install` 只在首次接手、依赖缺失或依赖发生变化时执行。开发服务默认会显示类似下面的地址：

```text
http://127.0.0.1:5173/
```

如果端口已被占用，Vite 会显示新的端口，以终端实际输出为准。用浏览器打开该地址即可看到游戏和场景编辑器。

编辑器参数调整后会自动保存，不需要手动点保存。页面右侧编辑器可以调关卡、传送带布局、相机、背景、车辆、乘客、引导、CTA、商店跳转等参数。

## 3. 编辑器参数实际保存在哪里

这是交接中最重要的一点：

- 编辑器修改首先保存在浏览器 `localStorage` 中，键名是 `bus-loop-scene-tuning-v3`。
- 浏览器里的参数不会自动完整写回 Git 工作区，也不会自动成为最终包参数。
- 关卡选择在开发服务中还会同步写入 `artifacts/selected-level.txt`，但不能因此认为其他参数也已经落盘。
- `localStorage` 与浏览器和页面来源绑定。换浏览器、换主机名或换端口后，可能读不到之前保存的参数。
- “恢复默认参数”会清除本地保存值，使用前先确认是否还需要当前调参结果。

因此，调参完成后不能直接让 AI 执行 build。必须先让 AI 把编辑器当前的完整参数导出并写入项目文件。

浏览器运行时提供了以下调试接口：

```js
window.__busLoop.exportTuning()
```

它会返回当前编辑器完整参数的 JSON 文本。需要将这份内容完整写入：

```text
artifacts/scene-tuning.json
```

然后执行：

```powershell
npm run apply:tuning
```

这个步骤会把导出的参数合并写入 `src/scene-tuning.js`，并把所选关卡同步到 `artifacts/selected-level.txt`。完成这一步后，参数才真正进入生产构建链路。

## 4. 为什么编辑器试玩时不会跳商店

本地编辑器中点击 CTA 或达到跳转计数后不打开商店，通常是正常现象。

当前正式跳转只调用：

```js
window.mraid.open(url)
```

普通本地浏览器没有 AppLovin 广告容器，也就没有 `window.mraid`，所以本地编辑器不会真正跳转。当前代码没有为普通浏览器保留 `window.open` 跳转兜底。

跳转触发链路包括：

- 用户直接点击 CTA。
- 某次有效车辆操作让成功计数达到配置阈值。
- 已经达到阈值后，用户下一次在游戏画布上按下。

AppLovin 还要求 CTA、音频等敏感行为发生在真实用户交互上下文中。因此，通过控制台调用 `window.__busLoop.InstallFullGame()`，或用调试接口直接模拟车辆逻辑，只适合排查状态，不能代替真实点击验收。

结论：本地不跳转不等于最终包有问题，但最终包必须在 AppLovin 官方预览和真实后台中人工点击验证。

## 5. 标准打包流程

### 5.1 让 AI 先固化编辑器参数

建议直接给 AI 下面这段任务：

> 读取当前本地编辑器正在使用的完整参数，通过 `window.__busLoop.exportTuning()` 导出，完整写入 `artifacts/scene-tuning.json`。检查所选关卡、背景、传送带布局、引导目标、CTA 和商店跳转阈值，然后执行 `npm run apply:tuning`，确认 `src/scene-tuning.js`、`artifacts/scene-tuning.json` 和 `artifacts/selected-level.txt` 一致。不要直接使用旧参数打包。

如果 AI 无法访问正在调参的那个浏览器会话，需要由调参人提供导出的 JSON。不要让 AI 根据截图猜参数，也不要只口述其中几项后覆盖整份配置。

### 5.2 构建并生成 AppLovin 单 HTML

参数落盘并核对后依次执行：

```powershell
npm run build
npm run package:applovin
npm run check:applovin
```

说明：

- `npm run build` 会先生成当前选中关卡的窄生产数据，再执行 Vite 构建。
- `npm run package:applovin` 会把脚本、样式和资源内联为单个 HTML。
- `npm run check:applovin` 会检查单文件、包体、外部资源、MRAID CTA 等静态要求。
- 最终默认产物是 `artifacts/applovin/index.html`。
- 每次重新打包都会覆盖 `index.html`。需要保留多个版本时，必须先复制为带关卡、背景或日期的明确文件名。

## 6. 打包前必须核对的参数

至少让 AI 逐项报告以下值，不能只说“已经同步”：

- `level.selected`：最终关卡。
- `conveyorLayout.selected`：传送带布局。
- `background.asset`：最终背景资源，确认使用优化后的交付图。
- `vehicleGuideHand`：是否启用、关卡范围、目标车辆 ID。
- `firstClickGuide`：是否启用、关卡范围、目标车辆 ID、蒙层时长。
- `cta.enabled` 和 CTA 位置、尺寸。
- `installGate.successfulOperationThreshold`：多少次有效车辆操作后触发跳转。
- 地图、车辆模型、相机、路径边界等本轮实际调整项。

还要确认生成后的生产数据只包含需要的关卡和资源，尤其是背景图片。不要把未选中的高清背景或其他关卡一起塞进最终包。

## 7. 验收顺序

推荐顺序：

1. 在编辑器中检查画面和基础玩法。
2. 对最终构建产物做浏览器检查，不要只检查 dev server。
3. 运行 AppLovin 静态检查，确认单 HTML 且不超过 5,000,000 字节。
4. 上传 AppLovin 官方预览，检查加载、玩法、CTA、音频、结束态和横竖屏适配。
5. 上传真实广告后台并人工试玩。
6. 确认测试的确实是最新文件，最好记录文件大小和 SHA-256。

官方预览入口：

```text
https://p.applov.in/playablePreview?create=1&qr=1
```

静态检查通过只代表包结构基本合规，不能代替真实平台上传和人工试玩。

## 8. 常见问题

### 编辑器里明明改了，打出来还是旧参数

通常是只改了浏览器 `localStorage`，没有导出 `scene-tuning.json` 和执行 `npm run apply:tuning`。也可能是 AI 在另一个端口或浏览器会话中读取了不同的本地缓存。

### 切换关卡后能记住，其他参数却没有进入最终包

开发服务会单独持久化关卡选择，因此容易产生“全部参数都保存了”的错觉。仍然要导出完整 tuning JSON。

### 本地 CTA 没反应

先确认代码计数和 CTA 状态，再到 AppLovin MRAID 容器内验证真实跳转。本地浏览器没有 `mraid.open()` 是预期情况。

### 静态检查通过，手机上仍然不跳转

检查上传文件是否为最新 `index.html`，确认实际点击路径达到了跳转阈值，并在真实用户点击中触发。记录设备系统、上传文件大小/哈希、成功计数和 CTA 点击结果，再决定是否需要平台专项修复。

## 9. 当前交接基线

截至 2026-08-20，项目最近记录的 AppLovin 基线是 Level12、Sakura 背景、引导车辆 34、商店跳转阈值 10。`artifacts/applovin/index.html` 为 4,197,570 字节，静态检查已通过；AppLovin 官方预览、真实后台上传和设备试玩仍属于外部人工验收。
