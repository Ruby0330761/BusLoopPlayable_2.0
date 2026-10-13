# 修复策略

## 分类

- `RESOURCE_FIX`：引用缺失、白名单外载荷、最终内容 hash 重复载荷、资源失真或包体超预算。
- `TOOLCHAIN_FIX`：工具缺失、版本/哈希漂移、许可证不明、需要联网或输出不可复现。
- `PACKAGE_FIX`：文件类型、ZIP 根目录、命名、backup、meta、垃圾文件、HTML 尾部和压缩格式。
- `PLATFORM_FIX`：CTA、平台 API、MRAID、生命周期、方向、响应式和跨平台残留。
- `SOURCE_FIX`：JavaScript 异常、动态资源、Google/Meta 动态图片的容器安全映射、音频门控、自动跳转、玩法结束态和共享源码问题。
- `CHECKER_ARTIFACT_REWORK`：结构化 Checker 观察证明当前 artifact 的静态/运行时规则、CTA 或生命周期真实失败。
- `CHECKER_OBSERVATION_RETRY`：当前文件、页签、结果节点、可信输入、桥接明细或截图证据缺失/矛盾，尚不能判断 artifact；本地候选资格保持有效。
- `CHECKER_EXTERNAL_BLOCK`：Checker 不可达、目标页签缺失或页面可见工具故障，无法由修改 artifact 消除；记录外部提醒，不阻止本地候选 ready。
- `MANUAL_ONLY`：真实容器 UI、后台识别、官方 Preview、真机性能和商店真实跳转。

## 修复顺序

1. 根据规则 ID 和证据定位生成链路。
2. 优先修改最窄的责任层。
3. 完整执行目标平台构建命令。
4. 重新运行静态和运行时检查。
5. 文件变化后废弃旧报告。
6. 共享源码变化时先回归 AppLovin，再回归受影响平台。
7. final-recheck 全部有效后即可生成待平台验收候选包；用户选择执行 Checker 时，失败 attempt 保留，修复后的新 artifact 使用新本地批次和新 Checker 记录。

所有 warning 均进入真实生成链修复，不得用人工理由关闭。唯一例外是 Android 单端投放缺少 iOS App Store 地址时的 `COMMON-STA-004`，必须已配置有效 Google Play 地址并记录用户确认。React 错误帮助 URL 和 W3C namespace 不是网络请求，但若它们以原始 HTTP(S) 字面量触发 checker，应在构建器中做语义等价编码；网络 API、资源 URL 和 tracking URL 不允许以此方式隐藏。

Playable Ad Checker 的可信 warning、失败、CTA 真实失败和生命周期真实失败不得人工关闭。稳定、完整、绑定当前 artifact 的静态/运行时失败归入 `CHECKER_ARTIFACT_REWORK`：修真实生成链、重建、final-recheck；如继续 Checker，以新 SHA `supersede`。身份、操作或截图证据不足归入 `CHECKER_OBSERVATION_RETRY`：保持 artifact SHA 不变，拒绝旧 attempt；如继续 Checker则用新 attempt 重录，否则在交付报告记录 `PENDING`。缺页签/不可达归入 `CHECKER_EXTERNAL_BLOCK`，不修改 artifact并记录 `UNAVAILABLE` 外部提醒。禁止为了页面绿灯注入假 CTA、空生命周期、额外自动调用或 Checker 专用分支。

Google/Meta 的动态图片 blocker 应优先定位平台 asset projector/adapter：把运行时实际消费的图片键映射为 data URI，或生成并由探针证明 Blob URL，再完整重建。PNG 已在 ZIP、本地 HTTP 能加载、仅隐藏破图框或延迟换皮都不能关闭问题；禁止直接改最终 `index.html` 或 ZIP。

`RESOURCE_FIX` 只要会改变资源候选字节、引用白名单或参数范围，就先生成增量 Gate A。需要写回 playable 工作资源时还必须重新生成 Gate B；旧覆盖确认不能复用。未引用项目资源不得删除，最终重复载荷必须修构建链。`TOOLCHAIN_FIX` 默认暂停；不得自动安装、升级、联网获取或静默替换工具。

## 停止条件

`CHECKER_REWORK_REQUIRED` 不是停止条件。只要可信 Checker 证据已证明当前 artifact 的真实缺陷，且存在安全、明确、在授权范围内的源码/adapter/模板/构建修复路径，就必须修复、重建和重新 final-recheck；不得因 Checker 可选而只生成失败报告后结束。`CHECKER_OBSERVATION_RETRY` 与 `CHECKER_BLOCKED_EXTERNAL` 可以结束 Checker 分支并保留本地候选 ready，但必须如实记录 `PENDING|UNAVAILABLE`，不得宣称 Checker 通过。

任何 Checker 分支状态都不得通过遗漏报告参数来降级既有事实。`CHECKER_IN_PROGRESS` 先机器分类；已记录的 `PASS / PENDING / UNAVAILABLE` 必须原样进入交付报告，不能改写为 `NOT_RUN`。这项真实性要求不使观察重录或外部不可用阻塞本地候选资格。

出现以下任一情况时标记 `BLOCKED`：

- 缺少真实构建入口、必要配置或修改权限。
- 内置 ruleset 损坏或无法验证。
- 同一问题连续复检无变化，且没有新的安全修复证据。
- 修复需要改变玩法、素材或产品决策，超出用户授权。
- 问题只能由真实平台或真机确认。

## 禁止行为

- 手改最终 HTML、bundle 或 ZIP 伪造通过。
- 注入空 `gameEnd`、假 `install`、假 CTA 或假埋点。
- 覆盖 `console.error`、吞异常或篡改报告。
- 用 warning 代替 blocker，通过命名变化绕过规则。
- 把 `UNREFERENCED` 解释为项目级无用，或实现 DELETE/清理模式。
