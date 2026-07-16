# CLAUDE.md

<!-- build-playable-ads:start -->
# Playable Ads Working Rules

这是一套安装到当前 playable 工程根目录的长期规则。后续即使不再显式调用 skill，Codex / Claude 也应持续遵守这里的流程推进项目。

## 你现在在做什么

当前工程默认按“资源解耦、编辑器优先、AppLovin 基线、人工验收优先、静态校验补漏、最后混淆”的 playable SOP 推进。

你的核心职责不是一次性把试玩页写完，而是持续维护这几个事实来源：

- `docs/project/playable-project-progress.md`
- `docs/project/playable-core-rules.md`
- `docs/project/playable-resource-status.md`
- `docs/project/playable-multi-platform-execution-plan.md`
- `docs/project/platform-manual-validation-checklist.md`
- `docs/platforms/*.md`

## 文档分工

这些文档分三类，不是同一用途。

- 通用流程文档
  - 作用：告诉你这套 playable SOP 怎么做、为什么这么做。
  - 特点：跨项目通用，偏方法论，不记录当前项目事实。
- 项目文档
  - 作用：记录当前项目现在做到哪、缺什么、下一步做什么。
  - 特点：只服务当前项目，是每轮都要先读的事实来源。
- 平台文档
  - 作用：记录跨平台差异和单个平台的硬约束、坑点、验收重点。
  - 特点：进入平台阶段或处理某个平台问题时重点读。

## 首次进入项目先读什么

第一次接手这个 playable 工程，先按这个顺序读：

1. `docs/playable/playable-sop.md`
2. `docs/playable/platform-delivery.md`
3. `docs/playable/project-document-rules.md`
4. `docs/playable/busjam-practice-timeline.md`
5. `docs/platforms/platform-deltas.md`

然后再读当前项目文档：

1. `docs/project/playable-project-progress.md`
2. `docs/project/playable-core-rules.md`
3. `docs/project/playable-resource-status.md`
4. `docs/project/playable-multi-platform-execution-plan.md`
5. 当前目标平台对应的 `docs/platforms/*-playable-audit.md`

## 后续每轮继续工作先读什么

不是第一次接手，而是已经在这个项目里持续推进了，那每轮先读项目文档：

1. `docs/project/playable-project-progress.md`
2. `docs/project/playable-core-rules.md`
3. `docs/project/playable-resource-status.md`
4. `docs/project/playable-multi-platform-execution-plan.md`
5. 当前目标平台对应的 `docs/platforms/*-playable-audit.md`

如果对流程顺序、平台策略、文档维护规则忘了，再回头补读：

- `docs/playable/playable-sop.md`
- `docs/playable/platform-delivery.md`
- `docs/playable/project-document-rules.md`

## 7 步 SOP

1. 提炼玩法规则与限制。
2. 资源解耦并记录缺口。
3. 先做编辑器。
4. 先做 AppLovin 基线包。
5. 基于 AppLovin 扩其他平台。
6. 全平台人工验收并回写。
7. 最后做静态校验与 hardening / 混淆。

## 不能破的规则

- 不要在玩法规则没写清楚前先做最终试玩页。
- 不要默认自动抽取 Unity 美术、音频和配表。
- 不要把“本地能跑”当成“平台可交付”。
- 不要跳过真实平台上传与人工试玩。
- 不要让关键结论只留在对话里不回写文档。
- 不要在平台链路未稳定前提前接重型混淆。

## 浏览器自动化

以下情况优先考虑浏览器自动化：

- 视觉布局问题
- 点击路径或 CTA 问题
- 最终包交互异常
- 音频触发时机异常
- 需要截图、录像或控制台证据

优先测最终构建产物，不要只看 editor 或 dev server。
默认优先用 `Browser Use`，具体看 `docs/playable/browser-automation.md`。

## 文档更新

每完成一个阶段、每发现一个平台差异、每确认一个资源缺口、每完成一次真实测试，都要更新项目文档。

最少要维护：

- `docs/project/playable-project-progress.md`
- `docs/project/playable-core-rules.md`
- `docs/project/playable-resource-status.md`
- `docs/project/playable-multi-platform-execution-plan.md`
- `docs/project/platform-manual-validation-checklist.md`

## 文档索引

- 通用流程文档：
  - `docs/playable/playable-sop.md`
  - `docs/playable/platform-delivery.md`
  - `docs/playable/project-document-rules.md`
  - `docs/playable/browser-automation.md`
  - `docs/playable/busjam-practice-timeline.md`
- 项目文档：
  - `docs/project/playable-project-progress.md`
  - `docs/project/playable-core-rules.md`
  - `docs/project/playable-resource-status.md`
  - `docs/project/playable-multi-platform-execution-plan.md`
  - `docs/project/platform-manual-validation-checklist.md`
- 平台文档：
  - `docs/platforms/platform-deltas.md`
  - `docs/platforms/cross-platform-playable-summary.md`
  - 各平台 `*-playable-audit.md`
<!-- build-playable-ads:end -->
