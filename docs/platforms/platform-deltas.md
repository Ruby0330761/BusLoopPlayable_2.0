# Platform Deltas

先用这张表判断“相对 AppLovin 基线到底要改什么”，再去读对应平台文档。

## Goal

只保留对实现有影响的差异，不做平台百科。

## Google Ads

- 交付：`ZIP`
- 关键点：
  - `<= 5MB`
  - `<= 512 files`
  - `<head>` 需要 `ad.orientation` 或 `ad.size`
  - CTA 走 `ExitApi.exit()`
  - 预览环境可能不真正跳转
  - 读：`google-ads-playable-audit.md`

## Meta

- 交付：`ZIP`
- 关键点：
  - `ZIP <= 5MB`
  - `index.html < 2MB`
  - `<= 100 files`
  - CTA 走 `FbPlayableAd.onCTAClick()`
  - 禁止 JS redirect
  - 音频兼容性更敏感，实践中更保守的 DOM 音频后端更稳
  - 读：`meta-playable-audit.md`

## Moloco

- 交付：单个 `HTML`
- 关键点：
  - `< 5MB`
  - 无 `mraid.js`
  - 无 XHR
  - 无外部网络请求
  - CTA 走 `FbPlayableAd.onCTAClick()`
  - 读：`moloco-playable-audit.md`

## 通用（所有平台）

- **版本尾段**：交付名最后一段是版本标签——`N` 普通 / `B` 带 BGM / `T` 带 TP1326 前贴 / `BT` 两者都有。导出器用 `--bgm`、`--no-bgm`、`--preroll <文件>` 生成，四个变体共用一份调参。出包后要按字节核对（BGM 的 mp3、前贴的 mp4 是否真的内联），不要只看文件名。
- **交付命名 11 段**：`需求-素材-前贴-N-语言-PL-设计师-需求人-渠道-步数-体力`。前贴段后固定一个 `N`，末尾步数/体力无值时写 `N`。Mintegral 只接受字母数字下划线，整名转下划线。
- **BL 与 BFT 都只出一份包**（Android/iOS 合并）：`branding.icon.deviceAssets` 提供两端 icon，运行时按 UA 选 icon 与商店链接。编辑器「Icon 版本」里的 `BL 安卓` / `BL iOS` 只决定预览显示哪张图，导出时两个槽位都会写死，不跟随预览选择（否则选 iOS 预览出的 BL 包会让 Android 玩家看到 iOS 图标）。同一文件必须双 UA 都过 runtime smoke；出包后抽查 Android 应为 JPG icon + Play 链接、iOS 应为 PNG icon + App Store 链接。

## Mintegral

- 交付：`ZIP`
- 关键点：
  - 命名规则严格
  - `install / gameReady / gameEnd / gameStart / gameClose / gameRetry`
  - 不自绘 close 和 loading
  - 非 `js/html` 资源应 base64 化
  - 对 classic 非 module 单 HTML 包更敏感
  - 需要支持 PC 浏览器鼠标操作
  - PlayTurbo 和真实后台都要测
  - 读：`mintegral-playable-audit.md`

## TikTok

- 交付：`ZIP`
- 关键点：
  - 根目录 `index.html`
  - 根目录 `config.json`
  - `orientation=0` 与 `playable_orientation=0` 更稳地识别 `Both`
  - CTA 走 `playableSDK.openAppStore()` 或 `openAppStore()`
  - 无 `mraid.js`
  - 读：`tiktok-playable-audit.md`

## Unity

- 交付：单个 `HTML`
- 关键点：
  - `< 5MB`
  - `mraid.open()`
  - 明确要求 `viewableChange` 后再开始内容
  - 读：`unity-playable-audit.md`

## Liftoff

- 默认 deferred
- 关键点：
  - `ad.html`
  - `download`
  - `complete`
  - 生命周期模型与 MRAID 家族差异大
  - 读：`liftoff-playable-audit.md`

## 从 AppLovin 扩平台的实现原则

- 玩法层尽量不变。
- 优先复用 AppLovin 已验证的运行时核心。
- 把差异收敛在：
  - CTA 桥接
  - 生命周期桥接
  - 导出格式
  - 静态规则
  - 少数平台专用兼容分支，例如 Meta 音频后端

## Universal Rule

- 不按平台复制整套玩法代码。
- 只拆平台桥接、平台导出和平台规则。
