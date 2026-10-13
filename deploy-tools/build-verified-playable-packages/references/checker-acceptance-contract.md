# Playable Ad Checker 验收契约

## 适用范围

Playable Ad Checker 是 exact final artifact 完成本地 `final-recheck` 后的可选外部补充验证，与官方 Preview、广告后台、代表设备和人工验收一起进入交付待办。未执行 Checker 不阻止本地 ruleset 已通过的候选包进入 `READY_FOR_MANUAL_PLATFORM_ACCEPTANCE`，但报告只能写“本地 ruleset 检查通过，Checker 尚未验证”。日常流程只使用 Checker 页面公开控件和可见 DOM；禁止读取、启动或修改 `/Users/hupo/workspace/project/playable_check`，禁止调用私有接口或绕过页面检查。

## 本地 parity 与前置证明

- `rules/checker-parity-matrix.json` 是七个平台显式 parity 矩阵，字段固定为 `ruleId / checkerNode / localRules / severity / exemptCategory / fixture`，并与 fixtures 一起纳入 ruleset SHA-256。
- UnityAds 的 `UNITY-STA-006` 与当前 Checker S11 对齐，阻断 `fetch(`、`XMLHttpRequest`、`WebSocket(` 字面量。Vite `modulepreload` polyfill 也不豁免，必须从源码、构建配置、模板或打包脚本消除并完整重建。
- 本地 CTA 必须来自浏览器可信 pointer/touch 输入并捕获目标平台真实桥接：AppLovin/UnityAds `mraid.open`、Meta/Moloco `FbPlayableAd.onCTAClick`、Google Ads `ExitApi.exit`、TikTok `openAppStore`、Mintegral `install`。
- Mintegral 本地与 Checker 都必须证明 `gameReady → gameStart → gameEnd` 完整有序。只定义函数、空调用、探针主动调用或调用方布尔值都不算通过。

## observation-v2

队列 `record` 只接受当前浏览器会话生成的单平台 JSON：

```bash
python3 <skill-root>/scripts/checker_ui_queue.py record \
  --queue <checker-ui-queue.json> \
  --platform <platform> \
  --delivery-key <delivery-key> \
  --observation <checker-observation-v2.json> \
  --compact
```

命令行不再接受静态/运行时计数、`ctaCaptured`、`lifecycleCaptured`、warning 自由文本、notice 自由文本或截图路径作为结论。单平台观察使用 `playable-checker-observation-v2`，集合使用 `playable-ad-checker-observations-v2`；字段结构见 [observation-v2 schema](checker-observation-v2.schema.json)。`AVAILABLE` 观察还必须由固定 `scripts/checker_browser_collector.mjs`（`checker-browser-cdp-collector@2`）在真实 Chrome/CDP 会话中生成独立 `externalProvenance`；调用方不得把 provenance 写回 observation 自签，`record` 会要求本次新建的 collector 输出，并将其与当前 attempt、页面可见摘要、截图 SHA 和 exact artifact 重新绑定。collector 还从当前 tab 的真实 DOM 读取每个 static/runtime result node 的 id、PASS/WARNING/FAIL、可见文本和矩形，capture 的 `resultNodes[]` 必须与 observation 逐项一致；diagnostics 镜像、visibleText 摘要或手写 PASS 节点不能替代。record 会在截图回填后由固定队列封存 observation canonical hash，避免 Node/Python 数字序列化差异。没有 external browser provenance 的离线 JSON、`isTrusted=true`、PASS 节点、bridgeCalls 或截图一律不能进入 acceptance；`build_acceptance()` 对最终 PASS 也直接 fail closed。

每项必须绑定并验签：

- 当前 Checker URL、页面标题和可见身份标记；
- 当前 `attemptId`、`platform + deliveryKey`、active tab 与可见页签；
- 页面当前文件名，以及 artifact 绝对路径、bytes、SHA-256；
- 结果稳定标记、静态/运行时逐节点 `id/status/message`、可见文本摘要；
- R2、可信 pointer/touch 输入、平台桥接调用与时间；Mintegral 还需 R5 和三段生命周期调用；
- viewport、active tab、当前文件、静态结果区、运行时结果区的可见矩形；
- 一张真实 PNG 截图的路径、bytes、SHA-256、实际尺寸与像素内容检查。

计数全部从结果节点派生。`ctaCaptured=true` 只能由当前 R2 PASS、可信输入和匹配桥接共同派生；`lifecycleCaptured=true` 只能由当前 R5 PASS 与三个有序调用共同派生。观察中出现调用方结论字段会直接拒绝。

最终截图必须是可解码、CRC 正确、非隔行 8-bit PNG，且非空白、非纯色、非近纯白；必须包含当前平台/页签、当前文件和稳定结果区域。SHA-256 与 preflight、其他平台、当前平台旧 attempt 或 superseded 历史相同会拒绝。普通 `record` 没有绕过参数。浏览器中断、结果未稳定、截图错误或身份不匹配时，当前 attempt 自动记为 `REJECTED/OBSERVATION_RETRY` 并回到待重录；artifact SHA-256 保持不变。

## 队列流程

```bash
python3 <skill-root>/scripts/checker_ui_queue.py preflight --checker-url <url> --output <instructions.json>
python3 <skill-root>/scripts/checker_ui_queue.py preflight-record \
  --instructions <instructions.json> --status available --final-url <url> \
  --visible-marker <页面可见文案> --evidence <preflight.png> --output <preflight.json>
python3 <skill-root>/scripts/checker_ui_queue.py init \
  --manifest <final-manifest.json> --checker-url <url> --preflight <preflight.json> \
  --timeline <execution-timeline.json> --output <checker-ui-queue.json>
python3 <skill-root>/scripts/checker_ui_queue.py start \
  --queue <checker-ui-queue.json> --platform <platform> --delivery-key <delivery-key> --compact
```

`UNREACHABLE` 不创建上传 attempt，记录为 `externalValidations.checker.status=UNAVAILABLE`，不使本地 final-recheck 失效，也不阻止本地候选 ready。后续平台使用 `enqueue`；受影响平台真实重建后使用 `supersede`，必须绑定新 artifact SHA-256并保留旧 artifact/attempt，其他平台完成记录保持不变。观察重录不使用 `supersede`，必须保持 artifact SHA-256 并创建不同的新 attempt。

队列完成后 `export` 只导出当前 exact artifact 的最新有效结构化观察与 preflight 截图引用，再生成 acceptance：

```bash
python3 <skill-root>/scripts/record_checker_acceptance.py create \
  --manifest <final-candidate-manifest.json> \
  --observations <checker-observations-v2.json> \
  --json-out <checker-acceptance.json> \
  --md-out <checker-acceptance.md>
```

acceptance 使用 `playable-ad-checker-acceptance-v2`，逐平台保留结构化 observation、`observationSha256`、页面截图、自动派生计数/CTA/生命周期、`classification` 与中文结论。验签时会重放派生逻辑，调用方不能改写结果。

## 零 warning 与封闭 notice

可用页签的 failure 必须为 0，warning 必须为 0。唯一可保留的是封闭规则 `COMMON-STA-004`：当前候选清单已记录该本地规则、`deliveryContext.targetOs=android`、当前 artifact 内有合法 Google Play URL 且没有 Apple App Store URL。notice 由脚本从候选清单和 artifact 自动生成，不接受自由文本 `acceptedNotice(s)` 或用户手工确认字段。

CTA、R5、网络 API、外部资源、空白预览、文件结构、方向、交互、控制台及其他 warning 全部不可豁免，必须修复真实生成链或重新取得可信观察。不得注入假 CTA、假生命周期、空调用、Checker 专用分支、吞错代码或手改最终包。

## 结论与返工分类

逐平台 `classification`：

| 分类 | 条件 | 下一动作 |
|---|---|---|
| `PASS` | 页签存在；零 failure；零 warning 或仅封闭商店 notice；R2/桥接/可信输入通过；Mintegral R5 有序通过 | 继续汇总 |
| `ARTIFACT_REWORK` | 静态/运行时确定性 warning/failure，或可信完整操作后 R2/R5 明确失败 | `CHECKER_REWORK_REQUIRED`；修真实生成链、重建、final-recheck、`supersede` 新 SHA |
| `OBSERVATION_RETRY` | 当前文件/页签/结果节点/截图/可信输入/桥接详情缺失或互相矛盾 | `CHECKER_OBSERVATION_RETRY`；本地候选资格保留，相同 artifact 可用新 attempt 补录 |
| `EXTERNAL_CHECKER_BLOCK` | Checker 不可达、目标页签不存在或可见页面工具故障 | `CHECKER_BLOCKED_EXTERNAL`；本地候选资格保留，写入外部补测提醒 |

同一批次优先级为 `ARTIFACT_REWORK > OBSERVATION_RETRY > EXTERNAL_CHECKER_BLOCK > PASS`。acceptance 总体结论仍只允许 `PASS / REWORK_REQUIRED / OBSERVATION_RETRY / BLOCKED_EXTERNAL / INCOMPLETE`；不再存在 `AVAILABLE_TABS_PASS`。缺页签不是 Checker 通过，TikTok 无页签必须如实记录 `BLOCKED_EXTERNAL`，但报告器将其映射为不阻塞本地候选的 `UNAVAILABLE`。

只有用户主动进入 Checker 分支时，运行清单才进入 `CHECKER_IN_PROGRESS`，再用：

```bash
python3 <skill-root>/scripts/run_manifest.py record-checker-outcome \
  --manifest <run-manifest.json> \
  --checker-acceptance <checker-acceptance.json> \
  --checker-markdown <checker-acceptance.md>
```

命令根据验签结果自动写入 `CHECKER_ACCEPTANCE_RECORDED / CHECKER_REWORK_REQUIRED / CHECKER_OBSERVATION_RETRY / CHECKER_BLOCKED_EXTERNAL`，调用方不能选状态。`CHECKER_IN_PROGRESS` 必须先完成该机器分类，不能直接进入 ready。总体 `PASS` 作为补充证据；`OBSERVATION_RETRY / BLOCKED_EXTERNAL` 可在交付报告准确记录 `PENDING / UNAVAILABLE` 后进入本地 ready；只有 `CHECKER_REWORK_REQUIRED` 会阻止本地候选资格。

## 可信 artifact 问题不得绕过

`CHECKER_REWORK_REQUIRED` 是必须处理的返工态。`CHECKER_OBSERVATION_RETRY` 只表示补充观察无效，不推断 artifact 有问题；可以保留本地候选 ready，也可以继续补录：

1. artifact 问题：修复真实生成链，重建受影响平台，完成新 final-recheck，以不同 SHA `supersede`，其他平台记录保持有效，再回 `CHECKER_IN_PROGRESS`。
2. 观察问题：旧 attempt 记为拒绝/取消，artifact SHA 不变；如继续 Checker，创建不同的新 attempt，再回 `CHECKER_IN_PROGRESS`。不继续时在报告中记录 `PENDING`，不得宣称 Checker 通过。
3. 不可达或缺页签：记录 `UNAVAILABLE` 并提醒后续补测，或直接进入对应官方 Preview/广告后台验证；不得伪造成 PASS。

任一 artifact 字节变化都会使该平台旧 Checker 观察失效；若旧观察已证明 artifact 缺陷，受影响平台的交付资格同时失效。旧证据只保留审计，不得复用为当前通过。

报告器把 Checker 分支统一映射为 `externalValidations.checker.status`：未执行为 `NOT_RUN`，观察中/需重录为 `PENDING`，可信通过为 `PASS`，可信 artifact 缺陷为 `ISSUES_FOUND`，不可达/缺页签为 `UNAVAILABLE`。只有 `ISSUES_FOUND` 阻止 `READY_FOR_MANUAL_PLATFORM_ACCEPTANCE`；但运行清单已经记录 Checker 事实时，ready 验签还必须拒绝把 `PASS / PENDING / UNAVAILABLE` 降级或遗漏为 `NOT_RUN`。
