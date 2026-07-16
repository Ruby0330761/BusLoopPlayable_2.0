# Google Ads Platform Reference

更新时间基线：2026-04-03

## 官方依据

- Google Ads Help: About HTML5 / Playable ads for App campaigns  
  `https://support.google.com/google-ads/answer/9981650?hl=en`

## 相对 AppLovin 的核心差异

- 交付不是单 HTML，而是 `.zip`。
- CTA 不是 `mraid.open()`，而是 `ExitApi.exit()`。
- 需要在 `<head>` 里声明 `ad.orientation` 或 `ad.size`。
- 平台预览运行在 sandboxed iframe 里，点击不真正跳出可能是正常表现。

## 官方硬约束

- 上传形态是 `.zip`
- ZIP `<= 5MB`
- 文件数 `<= 512`
- 所有代码和资源都必须通过 ZIP 内相对路径引用
- CTA 自己处理时必须接入 `exitapi.js` 并调用 `ExitApi.exit()`
- 音频不能早于用户交互

## 实现建议

- 保留 AppLovin 已验证的玩法层和节奏。
- 仅改导出包装：
  - ZIP 交付
  - 注入 `exitapi.js`
  - CTA 分支切到 `ExitApi.exit()`
  - 补充方向与尺寸元信息
- 允许官方 `exitapi.js`，但不要因为 Google 允许一个白名单脚本就放宽其他外链。

## BusJam 实测提醒

- Google 预览里 CTA 不真正跳出，不应直接判定为失败。
- 需要结合 validator、官方预览和实际素材后台一起判断。
- 不要把当前实现里的某个具体文件拆分方式误当成平台硬规则；真正重要的是 ZIP、相对路径、元信息和 `ExitApi`。

## 最终验收入口

- `https://h5validator.appspot.com/adwords/asset`
- Google Ads 预览链路
- 实际广告素材后台

## 判定通过前必须确认

- ZIP 体积与文件数合规
- `ExitApi.exit()` 真正接通
- 方向与尺寸元信息存在
- 玩法、音频、CTA、结束态在预览和后台链路都无异常
