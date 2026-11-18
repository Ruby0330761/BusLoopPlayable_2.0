# BusLoopPlayable 项目审查（2026-11-18）

## 结论与范围

项目已形成 Three.js 试玩运行时、关卡/场景编辑器、共享文件服务和七渠道导出的完整链路。现有技术栈能够继续承载增量开发，当前优先级是修复数据写入与交付门禁，再完善性能优化的行为覆盖。

本轮审查当前工作区（含已有未提交改动），检查入口、主要状态与数据流、共享写入、打包校验及新增性能代码；执行测试、隔离编译和定向复现。未逐行审计全部文件，未修改业务代码、默认配置或现有交付包。

## 结构与数据流

| 边界 | 入口与职责 | 主要约束 |
| --- | --- | --- |
| 玩法 | `src/game-model.js`，配合 collision / motion / mechanic-containers | 规则已有较多行为测试，但仍读取全局 `SCENE_TUNING` |
| 渲染与生命周期 | `src/main.js` + `src/scene-view.js` | 负责 WebGL、HUD、音频、输入、平台可见性及关卡切换 |
| 编辑器 | scene-editor / level-layout-editor / level-editor-model | 调参、关卡创作、历史、素材管理；编辑模块按需加载 |
| 服务与持久化 | `vite.config.js` 的 dev/preview middleware | 关卡 JSON、owner sidecar、备份与 revision；浏览器另有 localStorage 草稿 |
| 构建与交付 | generate-active-level → Vite → package-applovin → export-playable-package | 临时工作区隔离构建；桥接器适配七渠道；静态、载荷及运行时门禁 |

生产构建使用窄关卡载荷，开发关卡目录独立；品牌、资源白名单、平台桥接已有明确模块。部署还依赖 Python、FFmpeg 和 Chromium，不能只用 npm 单元测试判断交付可用。

## 已确认问题

### R1 / P1：并发保存会返回与落盘内容不一致的成功结果（既有）

- 位置：`vite.config.js:545`、`:552`、`:573`。
- revision 检查与最终写入之间没有互斥，同一关卡的所有请求共用 `.${levelId}.${process.pid}.tmp`。
- 使用真实 middleware、独立临时 artifacts 目录和本地 HTTP 服务复现：同 owner、同 baseRevision 的两个 PUT，连续四轮均出现一个 200、一个 400/ENOENT，且成功响应中的车辆 x 与最终文件中的 x 不同。例如响应 x=2，文件 x=1。
- 用户会以为自己的改动已保存，实际保存了另一标签页的内容。仅增加临时文件随机名不能解决 revision 检查的竞态。
- 建议：对同关卡的检查、备份、写入做串行化，使用独立临时文件；owner registry 的读改写也应作为相邻范围检查。补真实 HTTP 并发回归。

### R2 / P1：AppLovin 正式检查无法加载规则（既有）

- 位置：`deploy-tools/build-verified-playable-packages/rules/applovin.json:139`，同文件 `APL-AUD-002` 也缺字段。
- 实跑 `check_artifact.py --platform applovin --artifact artifacts/applovin/index.html` 返回 1：`APL-AUD-001 缺少字段 stage`。
- 两条新增规则缺少 loader 要求的元数据，导出器正常路径会在静态门禁失败，无法形成完整交付证据。`--skip-checks` 只能作为调试路径。
- 旧 `npm run check:applovin` 也失败两项。其 `unselected branding Icon omitted` 仍按单图标策略判定，与现有双端图标打包契约不符（`scripts/check-applovin-package.mjs:88`）；`no root-relative asset URLs` 是全文字符串扫描，不能单独证明浏览器产生了外部请求。
- 建议：先修复规则 schema 和检查器契约，再执行正常导出；不能以运行时冒烟通过替代平台静态门禁或真实上传验收。

### R3 / P2：影子实例化漏掉上车乘客（本地未提交改动）

- 位置：`src/scene-view.js:4455`、`:4517`、`:4536`；上车根节点加入 `boardingViews` 的位置为 `:6523`。
- `makeShadow` 在默认实例化模式下隐藏所有乘客的原 mesh；批次只收集 `passengerViews` 和 `queuePassengerViews`，没有收集 `boardingViews`。
- 用实际 `SceneView.prototype.createPassengerVisual` / `syncPassengerShadowBatch` 和 Three.js 对象复现：同一个可见乘客作为 boarding visual 时原 mesh 不可见、batch.count=0；放入 conveyor slot 后 batch.count=1。
- 此外收集器只检查 `visual.children`，豪华乘客的影子位于 `visualOffsetRoot` 内，也不满足这一遍历形状；本轮未额外做该美术的浏览器视觉验收。
- 建议：统一枚举实际乘客根节点及影子载体，覆盖输送带、队列、上车和嵌套特殊乘客；补对象级数量与可见性回归。

### R4 / P2：运行中关闭影子实例化不能回退（本地未提交改动）

- 位置：`src/scene-view.js:4518`、`:4455`。
- 开关变成 0 后直接 return，旧批次仍可见并保持最后一帧的实例；此前隐藏的逐人 mesh 没有恢复。反向从 0 开到 1 也没有统一隐藏已有逐人 mesh。
- 对象级复现：先同步出一个实例，再设置 instanced=0 并隐藏其乘客根节点；旧 batch 仍 visible=true、count=1，原 mesh 仍隐藏。运行时调参通过 `view.setTuning`，没有为此开关重建全部乘客。
- 纠正原记录：“设 0 即回退”只适用于创建对象前的配置，不能描述当前的热切换行为。
- 建议：明确实现两种绘制模式的进入/退出清理，补 1→0、0→1、乘客隐藏及关卡切换回归。

## 验证结果

| 检查 | 本轮结果 |
| --- | --- |
| `node --test test/*.test.js` | 761 pass / 0 fail / 0 skip |
| 生产 Vite 隔离编译 | 通过；主 JS 1,032,290 B；保留既有 chunk-size 提示 |
| `PLAYABLE_REMOTE_EDITOR=1` 隔离编译 | 通过；编辑器按需 chunk 正常生成 |
| 现有 AppLovin 包运行时，`requireAudioLifecycle: true` | 19/19 PASS；产物 2,670,656 B |
| 旧 AppLovin 静态预检 | 两项失败，详见 R2 |
| 正式内置 AppLovin 规则 | 规则加载失败，详见 R2 |
| 并发保存 / 影子状态复现 | R1、R3、R4 已复现 |

编译输出位于临时目录并已清理，未运行会重写生成源码的 npm prebuild，也未重新生成七渠道交付包。现有包的 runtime PASS 不等价于当前源码已完成整条导出验收。未执行真实广告平台上传或本轮真机性能验收。

## 渐进治理建议

- Now：R1 数据写入；R2 正式门禁；R3/R4 影子合批正确性。
- Next：补真实文件服务并发测试、渲染对象生命周期测试及最小正式导出回归。现有部分编辑器测试主要通过源码正则断言，无法覆盖本轮状态缺陷。
- Later：按实际需求逐步拆分 `scene-view.js`（6811 行）、`scene-editor.js`（4768 行）、`main.js`（3732 行）和 `vite.config.js`（2558 行）的职责。优先抽文件持久化边界及渲染子系统，避免只搬文件而保留隐式依赖。
- Rejected（本轮）：更换前端框架、引入数据库/队列、重写玩法核心、继续扩大 instancing 范围。没有必要在这次审查中增加架构复杂度。

Workflow 判断：单次架构审查，不创建 workflow-status.md；本报告记录审查产物与后续建议，不代表已进入修复阶段。
