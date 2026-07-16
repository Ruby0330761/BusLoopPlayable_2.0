# Task Plan: BusLoop 核心玩法提炼

## Goal
在保持 `D:\UnityProjects\BusLoop` 只读的前提下，持续完善与 Unity level1 核心行为一致的 Three.js playable，并先完成可人工校准的场景编辑器。

## Current Phase
Phase 26：Unity 相机与双平面投影对齐（in progress）

## Phases

### Phase 1: 规则与范围确认
- [x] 固定只读源工程与输出边界
- [x] 阅读 playable SOP、项目文档和平台差异
- [x] 记录现有假设与待确认问题
- **Status:** complete

### Phase 2: Unity 玩法取证
- [x] 枚举指定关卡文件并解析 level1
- [x] 定位关卡数据结构、车辆逻辑、胜负与交互脚本
- [x] 建立字段与运行时行为的证据链
- **Status:** complete

### Phase 3: 核心玩法建模
- [x] 提炼最小玩法循环、对象、状态与约束
- [x] 固化颜色 ID 映射
- [x] 区分已确认事实、推断与待验证项
- **Status:** complete

### Phase 4: 文档回写与校验
- [x] 更新 playable-core-rules.md
- [x] 更新 progress/resource/plan 等事实来源
- [x] 检查文档相互一致，并核验源工程写入边界
- **Status:** complete

### Phase 5: 原型结构与场景数据提取
- [x] 检查当前工作区与可用前端运行时
- [x] 提取 GameSceneDualQueue 的 spline、候车位和交互参数
- [x] 固化原型数据模型与测试接口
- **Status:** complete

### Phase 6: Three.js 原型实现
- [x] 建立本地可运行的 Three.js 工程
- [x] 实现占位车辆、乘客四人组、闭环 spline 与候车位
- [x] 实现点击阻挡、调度、同色上车、离场、胜负与重开
- **Status:** complete

### Phase 7: 逻辑测试
- [x] 为关卡数据、碰撞、匹配、失败与胜利编写自动化测试
- [x] 修复测试发现的问题
- **Status:** complete

### Phase 8: 浏览器试玩验收
- [x] 尝试本地服务与应用内浏览器，记录策略阻塞和端口占用事实
- [x] 以 7 条模型测试、完整胜利链、语法检查、离线检查和生产构建完成可自动验证部分
- [x] 回写项目文档与交付说明
- **Status:** complete

### Phase 9: GameSceneDualQueue2 场景与资源取证
- [x] 定位 prefab、双传送带入口、车位、背景与材质依赖
- [x] 建立 GUID → Unity 资源路径清单并记录可转换范围
- [x] 对比现有 GameSceneDualQueue 行为差异
- **Status:** complete

### Phase 10: 双入口玩法与场景实现
- [x] 更新关卡/状态模型以支持两个传送带入口
- [x] 接入可用于 Web 的背景、传送带、车位等资源
- [x] 调整相机、灯光、材质与布局，尽可能贴近 Unity 场景
- **Status:** complete

### Phase 11: 构建与验收
- [x] 扩充自动化测试并通过完整胜利链
- [x] 完成生产构建、离线依赖和包体检查
- [x] 更新项目进度、资源状态与人工验收项
- **Status:** complete（浏览器策略阻止自动截图，待用户人工视觉复核）

### Phase 12: 参考图布局与 Loop_02_0 校准
- [x] 使用 Loop_02.png 的 Loop_02_0 Sprite 切片替换错误道路图
- [x] 移除上一版背景图片，改为简洁程序化场地
- [x] 将传送带置于画面上方、车位居中、停车场车辆置于下方
- [x] 构建、逻辑测试并回写视觉差异
- **Status:** complete（待用户在 dev 页面确认实际视觉）

### Phase 13: Unity 原模型与可调场景参数
- [x] 接入 BG_split01 独立背景平面
- [x] 接入 Idle_boy01、11 色材质与人物阴影
- [x] 接入 4/6/10 座车辆、Wheel_001、Arrow_01 与车辆阴影
- [x] 按 Car_P1 prefab 接入停车位模型和材质
- [x] 集中相机角度、模型朝向、传送带与车位位置/大小参数
- [x] 测试、构建、包体检查并回写文档
- **Status:** complete（待用户视觉确认）

### Phase 14: 视觉资源与坐标轴纠正
- [x] 将车位纹理改为 Car_P2，并从产物移除 Car_P.png
- [x] 将唯一背景改为 BG01_split01，并从产物移除 BG_split01
- [x] 移除底部常驻玩法说明
- [x] 箭头旋转 180°，仅停车场车辆生成区域围绕原点逆时针旋转 180°
- [x] 运行测试、构建与产物资源检查
- **Status:** complete（待用户在 dev 页面视觉确认）

### Phase 15: 车辆生成区域旋转作用域纠正
- [x] 恢复传送带、乘客路径和车位的上一版坐标与朝向
- [x] 将 180° 布局参数收敛到 vehicleArea
- [x] 保持 Arrow_01 的独立 180° 修正
- [x] 测试与生产构建
- **Status:** complete（待用户视觉确认）

### Phase 16: 车辆布局参考图校正
- [x] 对照编号确认 level1 原始 x/z 已符合参考图相对关系
- [x] 撤销车辆生成区域额外 180° 旋转
- [x] 保留 Arrow_01 独立 180° 朝向修正
- [x] 测试与生产构建
- **Status:** complete（待用户视觉确认）

### Phase 17: 车辆区域上下镜像
- [x] 对比当前图与目标图，确认左右不变、上下反转
- [x] 仅对车辆生成区域执行 Z 轴镜像
- [x] 同步镜像车辆初始朝向
- [x] 测试与生产构建
- **Status:** complete（待用户视觉确认）

### Phase 18: 四人乘客组单排布局
- [x] 将乘客组由 2×2 改为四人同排
- [x] 测试与生产构建
- **Status:** complete（待用户视觉确认）

### Phase 19: 乘客行走与上车动画
- [x] 追踪 Unity VertexAnimation、clip 和上车状态链
- [x] 从只读 Unity 资源导出 471 顶点 VAT 网格与 RGBAHalf 动画贴图
- [x] Three.js 接入 Passenger_Move / Passenger_Idle shader
- [x] 四人按 0.05 秒间隔、3.8 速度逐个走向车辆
- [x] 满载车辆等待最后一组动画完成后离场
- [x] 测试、语法检查和生产构建
- **Status:** complete（待用户视觉确认）

### Phase 20: 全部乘客右转 90°
- [x] 统一调整乘客模型朝向参数
- [x] 测试与生产构建
- **Status:** complete（待用户视觉确认）

### Phase 21: 单人模型局部旋转纠正
- [x] 恢复乘客组根节点原朝向
- [x] 每个小人模型局部右转 90°
- [x] 测试与生产构建
- **Status:** complete（待用户视觉确认）

### Phase 22: 单人模型改为左转 90°
- [x] 将局部朝向从 +90° 改为 -90°
- [x] 测试与生产构建
- **Status:** complete（待用户视觉确认）

### Phase 23: Unity 正式汽车动效取证与接入
- [x] 追踪车辆驶入停车位的状态、路径、曲线、时长与朝向
- [x] 追踪车辆满载驶离的状态、路径、曲线、时长与朝向
- [x] 追踪受阻点击时撞击方前进/回退的碰撞点计算与时间曲线
- [x] 追踪被撞车辆的响应动效及对应模型/动画资源
- [x] 将确认后的 Unity 行为映射到 Three.js，禁止添加无源码依据的效果
- [x] 扩展测试并完成生产构建
- [x] 回写项目文档与人工验收清单
- **Status:** completed

### Phase 24: 实时场景编辑器与窗口自适应
- [x] 传送带图片坐标可视化调节
- [x] 中间循环曲线及左右队列曲线各自支持坐标与 X/Z 尺寸调节，小人保持整条曲线均分
- [x] 车位坐标、间距和角度可视化调节
- [x] 车辆模型大小可视化调节
- [x] 编辑器、预览和 QA API 共用 `SCENE_TUNING`
- [x] 画布与相机适配宽屏、竖屏和小尺寸窗口
- [x] 19/19 自动测试、生产构建与 1280×720 / 390×844 浏览器验证
- [x] 项目事实文档与人工验收清单回写
- **Status:** complete（待用户人工确认）

### Phase 25: 编辑器尺寸补全与视觉锚点修正
- [x] 传送带图片支持宽度/深度调节
- [x] 车位模型支持 X/Z 尺寸调节并实时预览
- [x] 背景严格使用原图 2100×3382 比例，调整相机防止裁切
- [x] 修复乘客模型与影子共用视觉根节点和旋转锚点
- [x] 增加回归测试并完成桌面/窄屏浏览器视觉检查
- [x] 回写项目事实文档
- **Status:** complete（待用户人工确认）

### Phase 26: Unity 相机与双平面投影对齐
- [x] Web 相机由正交改为可调透视相机
- [x] 玩法对象保持世界水平面，背景改为相机子级独立面
- [x] 固化 Unity Camera_2 的位置、55° 俯角、FOV 与背景局部距离证据
- [x] 按 Unity 乘客 prefab 校正人物/Shadow_01 共用根变换
- [x] 保持响应式视口适配并补回归测试
- [ ] 浏览器复核透视、人物脚下阴影和桌面/窄屏布局
- **Status:** in_progress



## Key Questions
1. `level1..asset` 的实际文件名/范围是什么，level1 的序列化结构如何？
2. 玩家操作、车辆移动约束、乘客/车位匹配、胜负条件分别由哪些脚本定义？
3. playable 首版必须保留哪些规则，哪些系统可以暂缓？

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Unity 工程严格只读 | 用户明确要求产物留在当前工作区，避免污染源工程 |
| 本轮只做玩法提炼，不实现 three.js | 用户明确限定当前阶段 |
| 结论按“事实/推断/待验证”分层 | 防止从类名或配置字段过度推断实际玩法 |
| level1 的乘客单位同时记录“逻辑组”和“可见角色” | 每条固定序列代表 1 个四人组，避免把 60 条配置误写成仅 60 个角色 |
| playable 首版保留传送带循环与车位决策 | `GameSceneDualQueue` 明确包含 39 槽闭环传送带和 8 个候车位，这是该变体的玩法辨识度 |
| 原型先用几何占位体 | 用户明确暂不使用工程内 3D 模型，先验证功能一致性 |
| 运行时与测试共享纯逻辑模型 | 便于在浏览器之外确定性验证胜负、失败和颜色匹配 |

| 编辑器直接读写 `SCENE_TUNING` | 保持编辑器、预览和后续 playable 数据模型一致 |
| 图片与中间循环行走曲线分开控制 | 支持视觉资源与实际轨迹独立校准 |
| 中间循环围绕中心缩放、侧队列以入口缩放 | 保持循环居中，并尽量维持侧队列与传送带连接 |
| 相机按画布宽高共同求正交可见范围 | 任意窗口比例下同时覆盖场景宽度和高度 |
## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Windows sandbox helper 启动取消/挂起 | 1-2 | 改用本机 Codex 的 apply-patch 子命令执行同一补丁格式 |
| Unity 全工程入口扫描超过 120 秒且无报告 | 1 | 改为指定关卡、GUID、类型名和关键事件的定向扫描 |
| 首次读取 `VehicleContainerType.cs` 路径猜错 | 1 | 使用 `rg` 返回的实际路径读取 |
| 核验时源仓库出现并发 Unity 写入 | 1 | 确认有 Unity 进程约 15:18 启动；本轮未向源目录写入，也未回滚外部改动 |
| pnpm 阻止 esbuild 安装脚本 | 1-3 | 查官方 pnpm 11 文档，已移除 onlyBuiltDependencies，改用 allowBuilds.esbuild=true |
| pnpm-workspace.yaml 出现重复 allowBuilds | 1 | pnpm 自动写入了占位项；删除占位映射，保留显式 true |
| 两个模型测试未跨过 0.1 秒帧钳制 | 1 | 测试按真实帧步进累计 0.8 秒，不绕过运行时保护 |
| Start-Process 启动 pnpm.cmd 时 PATH 键冲突 | 1 | 改为直接用 bundled Node 启动本地 Vite 入口 |
| 应用内浏览器策略拒绝 127.0.0.1:4173 | 1 | 不改地址、不换浏览器规避；以模型测试、语法检查和生产构建完成可自动验证部分 |
| 4173 已由另一个页面占用 | 1 | 标题不是本原型，不计入验证且不终止未知进程 |
| 当前目录不是 Git 工作树，无法运行 git diff 会话追踪 | 1 | 改用计划文件、文件清单与构建结果记录改动 |
| pnpm 非交互依赖重建先清理 node_modules 后无输出 | 1 | 终止挂起进程，使用 pnpm 11 离线缓存完整恢复依赖 |
| 浏览器策略拒绝 file:// 本地资源导航 | 1 | 遵守策略，不换地址或浏览器绕过；保留人工视觉复核项 |
| Node 解析带纹理 FBX 时缺少 document | 1 | 取证脚本临时禁用 TextureLoader，仅解析模型层级与包围盒；运行时仍正常加载纹理 |

| Codex `apply_patch` Windows helper 启动失败，包装器也被拒绝执行 | 1-3 | 保持补丁格式，改用 `git apply` 写入当前工作区 |
| `pnpm` 无 TTY 时拒绝重建 `node_modules` | 1 | 直接使用现有 Node 依赖运行 `node --test` 与 Vite 构建 |
| `Start-Process` 因 PATH/Path 冲突且后台子进程退出 | 1-3 | 使用前台长运行 preview 单元完成浏览器 QA，结束后主动终止 |
| 浏览器 DOM snapshot API 与当前页面后端不兼容 | 1 | 按故障文档改用只读 DOM evaluate、精确 locator 和截图验证 |
| 初次通过 PowerShell 管道写入的动态中文标签变成问号 | 1 | JS 标签改用 Unicode escape；后续 Markdown 补丁显式设置 UTF-8 输出编码 |
## Notes
- 指定颜色映射以用户提供的数据为最高优先级。
- 所有工作产物写入 `D:\WorkPlace\Playable\BusLoopPlayable_new`。
