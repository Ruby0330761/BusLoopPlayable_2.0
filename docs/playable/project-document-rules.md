# Project Document Rules

这套 playable 流程能长期跑通，关键不在聊天，而在项目文档持续更新。

首次进入一个新 playable 项目，先读通用流程文档；进入持续推进阶段后，每轮优先读项目文档，再按需回看通用流程文档。

## 哪些文档必须维护

- `docs/project/playable-project-progress.md`
  - 当前阶段、阻塞、平台矩阵、最近结论、下一步
- `docs/project/playable-core-rules.md`
  - 一句话玩法、输入方式、胜负条件、关键限制、可简化项、不做项、源码来源
- `docs/project/playable-resource-status.md`
  - 已收到什么、缺什么、谁提供、哪些是临时资源
- `docs/project/playable-multi-platform-execution-plan.md`
  - 当前平台目标、推进顺序、每个平台的状态与下一步
- `docs/project/platform-manual-validation-checklist.md`
  - 真实平台上传、人工试玩、后台识别结果
- `docs/platforms/*-playable-audit.md`
  - 单个平台的规则、坑点、回归、修复和结论

## 什么时候更新

以下情况都必须更新项目文档：

- 确认了新玩法规则
- 发现了新资源缺口
- 调整了布局、CTA、引导、结束态或关键变量
- 完成了某个平台的真实测试
- 发现了新的平台差异
- 追加了新的静态校验规则
- 改变了当前阶段目标或下一步计划

## 维护规则

- 进度文档记录的是“当前真实状态”，不是只记完成项。
- 平台 audit 文档只写该平台相关的事实，不要把所有内容都堆进去。
- 重要结论必须落文档，不能只停留在对话里。
- 如果文档内容和代码现状不一致，优先修正文档或补上差异说明。
