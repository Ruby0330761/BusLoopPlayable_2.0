# AppLovin 事件注入与锚点映射

`scripts/inject_applovin_events.py` 把 12 个标准事件接到真实运行路径上，不写占位埋点。

## 三类事件的接入方式

| 类别 | 事件 | 接入方式 | 是否可自动 |
|---|---|---|---|
| 生命周期 | `LOADING` `LOADED` `DISPLAYED` | runtime 观察真实 document 状态；`LOADING` 在 runtime 执行时发，`LOADED`/`DISPLAYED` 在 DOM ready 后发 | 是 |
| 首次交互 | `CHALLENGE_STARTED` | 首次真实 `pointerdown`/`touchstart`/`mousedown`/`keydown` | 是 |
| 玩法 | `CHALLENGE_PASS_25/50/75` | 进度函数或计数语句锚点 | 需锚点 |
| 玩法 | `CHALLENGE_SOLVED` / `CHALLENGE_FAILED` | 成功/失败分支各自的函数体 | 需锚点 |
| 玩法 | `CHALLENGE_RETRY` | 重试函数体 | 常见名称可自动 |
| 玩法 | `ENDCARD_SHOWN` | 结束页显示函数体 | 常见名称可自动 |
| 玩法 | `CTA_CLICKED` | `mraid.open` / `ExitApi.exit` / `FbPlayableAd.onCTAClick` 之前 | 唯一命中可自动 |

## 自动锚点

以下模式在**全文唯一命中**时自动注入；命中多处则记入 `ambiguousAnchors` 并要求用事件映射指定第几个。

| 事件 | 模式 | 位置 |
|---|---|---|
| `CTA_CLICKED` | `mraid.open(` | 表达式前 |
| `CTA_CLICKED` | `ExitApi.exit(` | 表达式前 |
| `CTA_CLICKED` | `FbPlayableAd.onCTAClick(` | 表达式前 |
| `ENDCARD_SHOWN` | `function showEndPage\|showEndCard\|showEndLayer\|createEndPage\|gameEnd(...) {` | 函数体开头 |
| `CHALLENGE_RETRY` | `function retry\|restart\|replay\|tryAgain\|resetGame(...) {` | 函数体开头 |

## 事件映射格式

自动锚点覆盖不到时，用 `--event-map` 显式声明。**锚点必须唯一命中**，宁可失败也不猜。

```json
{
  "schemaVersion": "playable-applovin-event-map-v1",
  "events": {
    "CHALLENGE_SOLVED":  {"anchor": "this\\.status\\s*=\\s*['\"]won['\"]", "place": "after"},
    "CHALLENGE_FAILED":  {"anchor": "this\\.status\\s*=\\s*['\"]lost['\"]", "place": "after"},
    "CHALLENGE_PASS_25": {"anchor": "function\\s+onProgress\\s*\\(", "place": "block"},
    "CHALLENGE_PASS_50": {"anchor": "function\\s+onProgress\\s*\\(", "place": "block"},
    "CHALLENGE_PASS_75": {"anchor": "function\\s+onProgress\\s*\\(", "place": "block"}
  }
}
```

字段：

- `anchor`：Python 正则。必须是真实业务代码位置，不能是注释或字符串常量。
- `place`：`expr`（表达式前，用逗号接入同一语句）、`block`（匹配到的 `{` 之后一行）、`after`（匹配语句结束之后）。
- `occurrence`：锚点命中多处时指定第几个，默认 1。

进度类事件共用同一进度函数时，用 `runtime.progress(percent)` 一次接入即可覆盖 25/50/75 三个阈值——映射里分别写三条会让三次调用都落在同一位置，虽然 runtime 内部有幂等保护，但证据会重复。推荐只在真实计算百分比的位置接一次 `progress()`。

## 阻塞语义

以下情况状态为 `BLOCKED`，**不生成产物并返回非零退出码**：

- 任一玩法事件既无自动锚点也无映射命中（记入 `events.unwired`）
- 锚点正则无效、`place` 非法、`occurrence` 越界
- artifact 是 ZIP（事件必须在构建阶段注入后重新打包）
- HTML 缺少 `<head>` 和 `<html>`

已有埋点时返回 `ALREADY_INSTRUMENTED` 且不写输出；只有显式 `--replace` 才重写，用于修正错误埋点。

## 与规则的关系

注入产物必须重新走一遍 `check_artifact.py`、`runtime_check.py` 和载荷扫描，并创建新的 check batch。注入改变了 artifact 字节，注入前的任何报告都不再适用。

`APL-STA-004` 只验证事件名出现，不证明接线正确。真实触发证据来自 `runtime_check.py` 在浏览器里观察到的实际调用序列；两者都要通过。
