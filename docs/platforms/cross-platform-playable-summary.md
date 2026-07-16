# Cross Platform Playable Summary

## 用途

- 快速查看当前 skill 推荐的默认平台顺序
- 理解哪些平台接近 AppLovin 基线，哪些平台必须单独适配
- 在进入某个平台前，先判断应该优先阅读哪份 audit 文档

## 默认平台顺序

1. `AppLovin`
2. `Google Ads`
3. `Meta`
4. `Unity`
5. `Moloco`
6. `Mintegral`
7. `TikTok`
8. `Liftoff` 默认 deferred

## 平台家族划分

### MRAID / 单 HTML 家族

- `AppLovin`
- `Unity`

共同点：

- 单 HTML
- 全资源内联
- 包体 `<= 5MB`
- CTA 基于 `mraid.open()` 或等价 MRAID 桥接

关键差异：

- `Unity` 明确要求 `viewableChange=true` 后再开始内容

### 单 HTML / 非 MRAID 家族

- `Moloco`

共同点：

- 单 HTML
- 全资源内联

关键差异：

- `Moloco` CTA 走 `FbPlayableAd.onCTAClick()`
- 不允许 `mraid.js`
- 不允许 XHR 和在线请求

### ZIP / 广告平台桥接家族

- `Google Ads`
- `Meta`
- `TikTok`

共同点：

- ZIP 交付
- 玩法层可复用 AppLovin 基线
- 真正变化在 CTA、导出结构、静态规则和平台字段

关键差异：

- `Google Ads`：`ExitApi.exit()` + `ad.orientation` / `ad.size`
- `Meta`：`FbPlayableAd.onCTAClick()` + `index.html < 2MB`
- `TikTok`：`config.json` + `openAppStore` + 方向字段识别

### 强生命周期平台

- `Mintegral`
- `Liftoff`

共同点：

- 相比 AppLovin，生命周期模型变化更大

关键差异：

- `Mintegral`：`install / gameReady / gameEnd / gameStart / gameClose / gameRetry`
- `Liftoff`：`ad.html` + `download / complete` 事件模型
