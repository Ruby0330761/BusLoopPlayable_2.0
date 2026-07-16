# Meta Platform Reference

更新时间基线：2026-04-03

## 官方依据

- Meta for Developers: Playable Ad  
  `https://developers.facebook.com/docs/app-ads/formats/playable-ad`

## 相对 AppLovin 的核心差异

- CTA 不是 `mraid.open()`，而是 `FbPlayableAd.onCTAClick()`。
- 即使是 ZIP，`index.html` 也必须严格小于 `2MB`。
- 明确禁止 JavaScript redirect。
- 音频兼容比 AppLovin 更敏感。

## 官方硬约束

- ZIP `<= 5MB`
- ZIP 内文件数 `< 100`
- 单 HTML 或 ZIP 内 `index.html < 2MB`
- CTA 使用 `FbPlayableAd.onCTAClick()`
- 不允许 JS redirect
- Playable 仅支持 `App Installs` 目标

## 实现建议

- 玩法层尽量复用 AppLovin 基线。
- 导出层改成 Meta ZIP。
- 明确把 CTA 切到 `FbPlayableAd.onCTAClick()`。
- 不要依赖 `window.location`、meta refresh 等跳转方式。
- 一旦 Meta 预览或后台出现“无音频”，优先考虑切到更保守的 DOM `HTMLAudioElement` 后端。

## BusJam 实测提醒

- 首轮问题不是结构，而是音频。
- 仅把 `audio/ogg` 改成 `audio/mpeg` 不一定够；如果容器仍无声，优先把 Meta 音频播放链路改成 DOM 音频后端。
- 必须确认平台实际加载的是新包，不要被缓存误导。

## 最终验收入口

- `https://developers.facebook.com/tools/playable-preview/`
- 实际广告素材后台

## 判定通过前必须确认

- `index.html < 2MB`
- ZIP 大小和文件数合规
- `FbPlayableAd.onCTAClick()` 已接通
- 无 JS redirect
- 真实预览和后台里 BGM / 音效均正常
