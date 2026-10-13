# 平台契约

## 通用规则

- 最终交付类型必须与平台规则一致。
- 禁止垃圾文件、嵌套 ZIP、sourcemap 和非预期外部资源。
- 禁止自动跳转和首次交互误跳；CTA 必须由真实用户意图触发。
- 音频必须由用户手势解锁，并在不可见时暂停。
- 最终文件必须有 viewport、稳定响应式布局，并配置与声明投放目标端一致的商店落地页。单端投放只要求对应地址；双端投放才要求两个地址；目标端未声明时提示人工确认。
- 报告必须绑定内置 ruleset 与 artifact SHA-256。
- 本地运行时 CTA 必须由浏览器可信 pointer/touch 输入触发并观察当前平台 bridge；页面脚本 `click()`、探针直接调用 bridge 或空实现不算通过。逐平台 bridge 与证据字段见 [Checker 验收契约](checker-acceptance-contract.md)。
- 最终字节冻结后必须把 exact final artifact 上传到 Playable Ad Checker 的对应现有页签。页签缺失时记录 `UNAVAILABLE` 和本地终检，不得借用其他平台结果或写成 Checker 通过。

## AppLovin

- 交付单个自包含 HTML，默认不超过 5MB。
- 使用 MRAID ready/viewable gate、双向 `viewableChange` 和 `mraid.open`。
- 使用真实 `window.ALPlayableAnalytics.trackEvent`，事件不能用空实现或字符串占位。
- 禁止外部字体、外部资源和自动跳转。

## UnityAds

- 交付单个 HTML，禁止 ZIP；除平台容器注入的唯一 `mraid.js` 声明外，业务脚本、样式和资源必须全部内联。
- 发布态为单行，严格结束于 `</html>`。
- `<script src="mraid.js"></script>` 或 `<script src="./mraid.js"></script>` 必须且只能出现一次。它是平台容器允许并负责注入的声明，不是需要打进包里的业务外链；其他 URL 不因此获得豁免。
- 监听 `sizeChange`，使用 MRAID ready/viewable gate。
- 禁止 `window.parent`、`window.top`、AppLovin API 和 AI 工具尾部标签。

## Moloco

- 交付单个自包含 HTML。
- CTA 使用 `FbPlayableAd.onCTAClick()`。
- 禁止 `mraid.js`、外部脚本、外部样式、动态网络请求和自动跳转。

## Meta

- 交付 ZIP，根目录必须有 `index.html`。
- ZIP 和解压后总大小不超过 5MB，文件数不超过 100。
- `index.html` 必须小于 2MB，资源引用必须完整。
- CTA 使用 `FbPlayableAd.onCTAClick()`。
- 禁止外部资源和自动跳转。
- 由 `imageAsset` 配置驱动、经 JavaScript 动态创建或换皮的图片不能继续依赖 ZIP 相对路径；必须经平台资源映射转成 `data:image/...` 或可证明的 `blob:` URL。ZIP 内存在 PNG 只证明文件被打包，不证明 Meta iframe/虚拟文件系统能重写这类动态 `src`。

## TikTok

- 交付 ZIP，根目录包含 `index.html`、`index.js`、`style.css`、`config.json`。
- `config.json` 包含合法 `orientation` 与 `playable_orientation`。
- 使用官方 playable SDK 和 `openAppStore`。
- 禁止 `mraid.js`、非白名单外链和自动跳转。
- 正式后台人工测试始终保留。

## Mintegral

- 交付不超过 5MB 的 ZIP，ZIP、目录和主 HTML 使用一致 ASCII 名称。
- 使用 classic/IIFE，禁止 `type="module"`、`import.meta`、`modulepreload` 和顶层模块导入。
- 暴露真实可调用的 `window.install`、`gameReady`、`gameStart`、`gameEnd`、`gameClose`、`gameRetry`。
- 运行时必须观察到完整 `gameReady() → gameStart() → gameEnd()`；仅定义或暴露函数不算通过，任一调用缺失或顺序错误都必须阻断。
- 禁止外链、自动跳转和投放态无关的高风险现代 API 残留。

## Google Ads

- 交付 ZIP，根目录包含 `index.html` 和 `backup.jpg`。
- `index.html` 必须有合法 `ad.size`。
- `index.html` 必须有合法 `ad.orientation`，值只允许 `portrait` 或 `landscape`，并与实际素材方向一致。
- CTA 使用 `ExitApi.exit()` 或允许的 MRAID 等价桥接。
- 仅允许官方 `exitapi.js` 外链；ZIP 基础名不超过 50 个字符。
- 由 `imageAsset` 配置驱动、经 JavaScript 动态创建或换皮的图片必须使用 `data:image/...` 或可证明的 `blob:` URL；不能依赖解压 HTTP 环境中可用、但 Google 预览容器无法重写的 ZIP 相对路径。

## Google Ads / Meta 动态图片共同验收

- 静态规则枚举最终候选中全部字符串字面量 `imageAsset`，并核对相同资源键的容器安全映射；缺少映射或仍映射到相对/根相对/HTTP 地址时为 blocker。
- 运行时探针必须在项目脚本前拦截 `HTMLImageElement.prototype.src` 和 IMG 的 `setAttribute("src", ...)`，保存全部原始赋值、scheme、入口和图片信息；blocker 只核对与最终候选 `imageAsset` 配置集合匹配的赋值，避免把已验证可用的普通 ZIP 图片路径误报为本缺陷。
- 本地解压 ZIP 后通过 HTTP 加载只用于 smoke，不能覆盖上述 blocker。修复必须进入平台 adapter、资源 projector、模板或打包器并完整重建，不得手改最终 ZIP。
