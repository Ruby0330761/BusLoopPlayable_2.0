# TikTok Platform Reference

更新时间基线：2026-04-03

## 官方依据

- TikTok Ads Manager Help: Playable ads  
  `https://ads.tiktok.com/help/article/playable-ads`

## 相对 AppLovin 的核心差异

- 交付形态是 `.zip`
- 根目录必须带 `config.json`
- CTA 走 TikTok / Pangle playable SDK，不是 `MRAID`
- 不允许 `mraid.js` 和动态外部请求

## 官方硬约束

- ZIP `< 5MB`
- 根目录主文件必须叫 `index.html`
- 根目录必须有 `config.json`
- 使用官方 playable js-sdk
- CTA 通过 `window.openAppStore()` 或 `window.playableSDK.openAppStore()`
- 不允许 `mraid.js`
- 不允许动态外网资源加载、JS redirect、HTTP 请求

## 实现建议

- 保留 AppLovin 已验证的玩法层。
- 新建 TikTok 专用 ZIP 导出。
- 输出根目录 `index.html + config.json`。
- 平台桥接切到 `openAppStore` 家族接口。
- 在导出和静态校验里强制检查方向字段。

## BusJam 实测提醒

- 首轮问题不是玩法，而是后台 `Display Orientation` 被识别成 `Vertical`。
- 要让后台稳定识别 `Both`，实践上更稳的配置是：
  - `orientation = 0`
  - `playable_orientation = 0`
- 必须用真实后台结果校正 `config.json`，不要只看测试页。

## 最终验收入口

- TikTok / Pangle 测试环境
- 实际广告素材后台

## 判定通过前必须确认

- ZIP 大小合规
- 根目录 `index.html`
- 根目录 `config.json`
- `orientation=0`
- `playable_orientation=0`
- `openAppStore` 桥接已接通
- 后台字段最终识别为 `Both`
