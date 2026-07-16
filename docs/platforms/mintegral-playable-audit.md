# Mintegral Platform Reference

更新时间基线：2026-04-03

## 依据来源

- Mintegral Help Center: Creative Management Guide  
  `https://helpcenter.mintegral.com/en/docs/creative-management`
- Mintegral Help Center: Playable Ad Guide  
  `https://helpcenter.mintegral.com/en/docs/playable-ad-guide`
- PlayTurbo / Mindworks 测试规范文档  
  `https://www.playturbo.cn/review/doc`
- PlayTurbo 测试规范 PDF  
  `https://www.playturbo.cn/_nuxt/doc/cn-doc.2641614.pdf`

Mintegral 公开文档偏概览，PlayTurbo / Mindworks 的测试规则更接近真实执行标准。本 skill 默认同时参考两者。

## 相对 AppLovin 的核心差异

- CTA 不是 `mraid.open()`，而是 `window.install()`。
- 需要一整套生命周期桥接：
  - `window.gameReady()`
  - `window.gameEnd()`
  - `gameStart()`
  - `gameClose()`
  - 可选 `window.gameRetry()`
- 平台自己处理 close 和 loading，不要自绘。
- 命名、打包结构、classic HTML、无在线依赖等要求更严格。

## 实际硬约束

- 交付支持 `URL` 或 `ZIP`
- ZIP `<= 5MB`
- ZIP 包名、素材文件夹名、HTML 文件名必须一致
- 名称只允许字母、数字、下划线
- HTML 必须包含 `html/head/body`，编码为 `utf-8`
- CTA 要贯穿试玩并调用 `window.install()`
- 资源全部加载完成后调用 `window.gameReady()`
- 结束态调用 `window.gameEnd()`
- 必须暴露 `gameStart()` 与 `gameClose()`
- 支持重试时暴露 `window.gameRetry()`
- 不自定义 close button
- 不自定义 loading
- 支持横竖屏与自由旋转
- 除 `js/html` 外其他资源建议全部 base64 化
- 不允许在线请求资源
- 不要重写全局 `console`
- PC 浏览器鼠标点击 / 拖动也要能完成试玩

## 实现建议

- 不要尝试把 AppLovin 单 HTML 直接原样塞给 Mintegral。
- 先保留玩法层，再做 Mintegral 专用导出器。
- 导出上优先 classic HTML，不要 `type="module"`、`import`、`export`、`import.meta`、`modulepreload`。
- 优先收敛到一个更保守、可在 PlayTurbo 通过的包结构。

## BusJam 实测提醒

- 首轮真正的问题不是玩法，而是 `module / import / 外置依赖` 结构。
- `Storage requirements for assets dependent on codes` 和 `Code exception / CORS Error` 往往指向本地模块链路、外置依赖或结构不合规。
- PlayTurbo 自带灰色手机壳区域，不要误把外层壳误判为试玩黑屏；要看真正的试玩区域是否加载。
- Mintegral 很容易把“过早结束上报”表现成“一点击就跳商店”。

## 最终验收入口

- `https://www.playturbo.com/review`
- 实际广告素材后台

## 判定通过前必须确认

- ZIP 大小合规
- 命名结构合规
- `install / gameReady / gameEnd / gameStart / gameClose / gameRetry` 已接通
- 无 `type="module"` / `import.meta` / `modulepreload`
- 不自绘 close / loading
- PlayTurbo 和真实后台都通过
