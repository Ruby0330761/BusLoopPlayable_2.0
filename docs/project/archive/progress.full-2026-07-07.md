# Progress Log

## Session: 2026-07-06 Phase 25

### 编辑器尺寸补全与视觉锚点修正
- **Status:** complete（待用户人工确认）
- Actions taken:
  - 传送带图片补充 X/Z 尺寸控件；车位补充 X/Z 尺寸控件。
  - 读取本地 PNG 头确认背景为 2100×3382，按原比例推导世界深度并调整相机 fitHeight。
  - 使用 personPivot 保留人物模型归一化位移；人物与影子挂在同一 visualRoot。
  - 新增背景尺寸、编辑器尺寸字段和人物锚点结构回归测试。
  - 浏览器验证左右队列大幅偏移、传送带宽度和车位尺寸实时变化。
  - 桌面和 390×844 窄屏均无页面溢出。
- Verification:
  - `node --test` 20/20；Vite build 成功。

## Session: 2026-07-06

### Phase 24: 实时场景编辑器与窗口自适应
- **Status:** complete（待用户人工确认调参范围）
- Actions taken:
  - 新增 `scene-editor.js`，提供 19 个实时控件与恢复默认参数功能。
  - 新增 `scene-layout.js`，集中实现曲线变换和正交相机宽高适配计算。
  - 中间循环曲线与传送带图片解耦；左右队列曲线分别可调；车位和车辆大小进入同一编辑器。
  - 页面改为自适应画布 + 可折叠侧栏，手机端默认收起并使用面板内部滚动。
  - 新增 3 项布局算法测试；最终 19/19 测试通过，生产构建成功。
  - 浏览器完成 1280×720 与 390×844 验证，页面根节点均无溢出。
  - 实测中间循环曲线 X 尺寸 1.25 可即时同步到滑杆、数值框与场景画面。
- Files created/modified:
  - `src/scene-editor.js`、`src/scene-layout.js`、`test/scene-layout.test.js`
  - `src/main.js`、`src/scene-view.js`、`src/scene-tuning.js`、`src/styles.css`、`index.html`、`README.md`

## Session: 2026-07-02

### Phase 1: 规则与范围确认
- **Status:** complete
- Actions taken:
  - 确认 Unity 源工程只读、产物仅写当前工作区。
  - 记录用户指定的关卡路径与颜色 ID 映射。
  - 初始化文件化分析计划。
  - 按项目规则阅读 SOP、平台差异与项目事实文档。
- Files created/modified:
  - `task_plan.md`（created）
  - `findings.md`（created）
  - `progress.md`（created）

### Phase 2: Unity 玩法取证
- **Status:** complete
- Actions taken:
  - 全工程入口扫描超时后改用定向扫描。
  - 解析 level1 的 6 辆车、60 条固定乘客组序列与容器数据。
  - 定位点击、碰撞、候车位、传送带、上车、胜负判定源码。
- Files created/modified:
  - `task_plan.md`（updated）
  - `findings.md`（updated）
  - `progress.md`（updated）

### Phase 3: 核心玩法建模
- **Status:** complete
- Actions taken:
  - 提炼“点车解堵 → 候车位 → 同色四人组自动上车 → 满载离场”的循环。
  - 区分 60 个逻辑组与 240 个可见角色。
  - 固化用户给出的 0–10 颜色映射。
- Files created/modified:
  - `findings.md`（updated）

### Phase 4: 文档回写与校验
- **Status:** complete
- Actions taken:
  - 完整更新核心规则、项目进度、资源状态与多平台阶段计划。
  - 用 level1 原始 YAML 复核车辆数、逻辑组数、可见人数与颜色总量。
  - 核验源仓库 Git 状态；发现并记录运行中的 Unity 进程造成的并发变化，不做回滚。
- Files created/modified:
  - `docs/project/playable-core-rules.md`（updated）
  - `docs/project/playable-project-progress.md`（updated）
  - `docs/project/playable-resource-status.md`（updated）
  - `docs/project/playable-multi-platform-execution-plan.md`（updated）
  - `task_plan.md`、`findings.md`、`progress.md`（updated）

### Phase 5: 原型结构与场景数据提取
- **Status:** complete
- Actions taken:
  - 接收新目标：构建不用原 3D 模型的功能一致 Three.js 原型。
  - 重新读取文件化计划与浏览器验收规则。
  - 确认可用 Node/pnpm，定位 Paths.prefab spline 与 ParkingSpots.prefab。
  - 固化 level1 数据、颜色表、19 点闭合 spline 和浏览器 QA 接口。

### Phase 6: Three.js 原型实现
- **Status:** complete
- Actions taken:
  - 建立 Vite + Three.js 原型。
  - 实现几何占位车辆、四人组、闭环传送带、8 候车位与完整玩法状态机。
- Files created/modified:
  - `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`
  - `index.html`、`src/*.js`、`src/styles.css`

### Phase 7: 逻辑测试
- **Status:** complete
- Actions taken:
  - 覆盖关卡计数、初始阻挡、解锁、同色上车、满载离场和死锁失败。
  - `pnpm test` 7/7 通过，含完整胜利链；`pnpm build` 成功。
- Files created/modified:
  - `test/game-model.test.js`

### Phase 8: 浏览器试玩验收
- **Status:** complete（视觉试玩受策略阻塞，已明确记录）
- Actions taken:
  - 尝试应用内浏览器加载本地原型，导航被现有策略拒绝。
  - 发现 4173 端口是另一个标题不同的页面，不计为本项目验证且未终止该进程。
  - 完成 JS 语法、无外链、生产包与完整胜利链验证。
- Files created/modified:
  - `README.md`、`.gitignore`
  - `docs/project/playable-project-progress.md`
  - `docs/project/playable-resource-status.md`
- Files created/modified:
  - `task_plan.md`、`findings.md`、`progress.md`（updated）

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| level1 车辆计数 | Unity YAML | 6 | 6 | ✓ |
| 固定乘客逻辑组 | Unity YAML | 60 | 60 | ✓ |
| 可见乘客换算 | 60 × GroupSize 4 | 240 | 240 | ✓ |
| 颜色总量 | fixed sequence | Blue 20 / Red 20 / Yellow 20 | 0=20 / 4=20 / 5=20 | ✓ |
| 文档一致性 | rg 核心参数 | 规则、进度、资源、阶段计划一致 | 一致 | ✓ |
| 模型逻辑 | `pnpm test` | 全部通过 | 7/7 通过 | ✓ |
| 完整胜利链 | 84→85→86→88→89→90，推进 140 秒 | won / 0 组剩余 | 符合 | ✓ |
| 生产构建 | `pnpm build` | 成功 | 成功，约 526 KB | ✓ |
| JS 语法 | `node --check src/*.js` | 无错误 | 通过 | ✓ |
| 运行时网络 | 检索 src/index | 无外部 URL | 无外部 URL | ✓ |
| 浏览器视觉试玩 | 应用内浏览器 | 页面可加载 | 被用户策略拒绝 | BLOCKED |
| DualQueue2 双入口 | 推进 1 秒 | 两入口均向共享闭环进人 | entryIndex 0/1 均出现 | ✓ |
| DualQueue2 生产构建 | pnpm build | 成功且小于 5 MB | 3,006,560 bytes | ✓ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-07-02 | Windows apply_patch helper 取消/挂起 | 1-2 | 改用本机 Codex apply-patch 子命令 |
| 2026-07-02 | Unity 全工程入口扫描 120 秒超时 | 1 | 改为定向扫描 |
| 2026-07-02 | `VehicleContainerType.cs` 首次路径猜错 | 1 | 按 rg 实际结果读取 |
| 2026-07-02 15:24 | 源仓库 Git 状态发生并发变化 | 1 | 确认运行中 Unity 进程；未向源目录写入或回滚 |
| 2026-07-02 | pnpm ERR_PNPM_IGNORED_BUILDS（esbuild） | 1 | 仅允许 esbuild 构建脚本后重装 |
| 2026-07-02 | pnpm 11 忽略 package.json 的 pnpm.onlyBuiltDependencies | 2 | 将配置迁移到 pnpm-workspace.yaml |
| 2026-07-02 | pnpm 11 已移除 onlyBuiltDependencies | 3 | 按官方文档改用 allowBuilds.esbuild=true |
| 2026-07-02 | pnpm-workspace.yaml duplicated mapping key | 1 | 删除 pnpm 自动添加的占位 allowBuilds |
| 2026-07-02 | 车辆到站/离站测试仍处于 moving-to-spot | 1 | 使用 0.05 秒固定帧推进至 0.8 秒 |
| 2026-07-02 | Start-Process pnpm.cmd 报 PATH/Path 重复键 | 1 | 使用 Node 直接启动 Vite |
| 2026-07-02 | 应用内浏览器拒绝访问 127.0.0.1:4173 | 1 | 遵守限制，不使用替代浏览器或地址规避 |
| 2026-07-02 | 4173 已被另一个标题不同的页面占用 | 1 | 不计为本原型验证，不终止未知进程 |
| 2026-07-03 | 当前目录不是 Git 工作树，git diff --stat 不可用 | 1 | 改用计划文件、文件清单和构建结果追踪 |
| 2026-07-03 | pnpm 非交互模式请求重建依赖并挂起 | 1 | 终止后使用 pnpm install --offline 从缓存恢复 |
| 2026-07-03 | 浏览器策略拒绝 file URL | 1 | 不绕过，人工视觉复核待办 |

## Session: 2026-07-03

### Phase 9: GameSceneDualQueue2 场景与资源取证
- **Status:** complete
- Actions taken:
  - 接收新目标：改用 GameSceneDualQueue2.prefab，实现两个传送带入口并接入其背景、传送带、车位等原工程资源。
  - 保持 Unity 工程只读，所有复制、转换和代码变更仅写当前工作区。
  - 确认真实结构为双队列入口汇入单闭环传送带，容量为 24+24→32，出口区间 60.5%–78%。
  - 解析并复制背景、道路、传送带和车位所需的最小资源集到 public/assets/unity。
  - 提取闭环与左右入口 spline 控制点。

### Phase 10: 双入口玩法与场景实现
- **Status:** complete
- Actions taken:
  - 将 level1 运行时切换为 GameSceneDualQueue2 参数：双 24 容量入口、共享 32 槽闭环、60.5%–78% 出口区。
  - 实现左右队列缓冲、两个入口按 spline 进环、队列补位与共享闭环上车。
  - 接入原背景、左右道路、环形道路 PNG 与 Car_P.fbx 停车位模型。
  - 使用 DualQueue2 的 19+20+20 个 spline 点重建闭环与左右入口布局。

### Phase 11: 构建与验收
- **Status:** complete（自动验证完成，待人工视觉复核）
- Actions taken:
  - pnpm test 8/8 通过，新增双入口同时进人测试。
  - pnpm build 成功，dist 总大小 3,006,560 bytes。
  - JS 语法检查通过，运行时无外部 URL。
  - 浏览器策略拒绝本地 file URL，未改地址或浏览器规避。

### Phase 12: 参考图布局与 Loop_02_0 校准
- **Status:** complete（待用户视觉确认）
- Actions taken:
  - 根据用户提供的 Unity 运行截图确认上一版屏幕纵向布局相反。
  - 确认 Loop_02_0 是 Loop_02.png 内的 Sprite 切片，而不是独立 PNG 文件。
  - 运行时改为读取 Loop_02.png，并按 Unity meta 的 2100×1243 区域设置 UV。
  - 删除旧背景、Loop_Road_02 与左右道路图片，改用程序化浅蓝网格场地。
  - 通过相机投影校验确认入口/闭环、车位、停车场车辆的屏幕顺序为上→中→下。
  - pnpm test 8/8、pnpm build 和 JS 语法检查通过；dist 约 1.85 MB。

### Phase 13: Unity 原模型与可调场景参数
- **Status:** complete（待用户视觉确认）
- Actions taken:
  - 确认 Main Camera_2 的俯角为 55°，作为 Web 默认相机参数。
  - 确认 Car/Van/Bus FBX 均包含独立车体网格和 Wheel_001 网格。
  - 确认 Idle_New 与 Car_New 的 0–10 颜色材质共享对应颜色纹理图集。
  - 确认 Car_P1 使用 Car_P.fbx + Car_P1.mat/Car_P.png。
  - 接入 BG_split01 独立背景平面，并将原 PNG 派生为高质量 WebP 控制包体。
  - 接入 Idle_boy01、11 色纹理、Shadow_01、Arrow_01、Car/Van/Bus 与 Car_P。
  - 将人物骨骼网格在加载后静态烘焙，保留原造型并降低运行时骨骼开销。
  - 新增 scene-tuning.js 和 window.__busLoop.setTuning() 调参入口。
  - pnpm test 9/9、全部 7 个 FBX 解析、JS 语法和生产构建通过；dist 3,042,626 bytes。

### Phase 14: 视觉资源与坐标轴纠正
- **Status:** complete（自动验证完成，待用户视觉确认）
- Actions taken:
  - 车位模型保持 Car_P.fbx，材质纹理由 Car_P.png 更正为 Car_P2.png。
  - 独立背景平面改为只读取 BG01_split01.png，并移除旧 BG_split01.webp。
  - 移除底部常驻操作说明；点击成功/失败反馈改为 1.3 秒后自动隐藏。
  - 箭头局部朝向增加 180°；根据后续澄清，180° 布局旋转仅属于停车场车辆生成区域。
  - pnpm test 9/9、生产构建与 JS 语法检查通过；dist 3,690,181 bytes。

### Phase 15: 车辆生成区域旋转作用域纠正
- **Status:** complete（自动验证完成，待用户视觉确认）
- Actions taken:
  - 恢复传送带图片、闭环/入口 spline、乘客和 8 个车位的上一版位置与朝向。
  - 将 180° 参数移入 vehicleArea，仅旋转初始停车场车辆的位置和朝向。
  - 车辆驶向车位时平滑回到原车位朝向；到站与离场不使用车辆生成区域旋转。
  - 保留 Arrow_01 的独立 180° 修正。
  - pnpm test 9/9、生产构建和 JS 语法检查通过。

### Phase 16: 车辆布局参考图校正
- **Status:** complete（自动验证完成，待用户视觉确认）
- Actions taken:
  - 对照用户参考图确认 84/90/89 位于右侧、85/86/88 位于左侧，与 level1 原始 x/z 相对关系一致。
  - 撤销 vehicleArea 的额外 180° 旋转；传送带、车位和乘客路径继续保持不变。
  - Arrow_01 的独立 180° 修正保持不变。
  - pnpm test 9/9、生产构建和 JS 语法检查通过。

### Phase 17: 车辆区域上下镜像
- **Status:** complete（自动验证完成，待用户视觉确认）
- Actions taken:
  - 对照当前图与目标图确认 X 轴左右关系正确，仅画面上下关系相反。
  - vehicleArea 改为 Z 轴镜像，不使用 180° 旋转，因此车辆左右位置保持不变。
  - 初始车辆 yaw 按同一 Z 轴镜像规则转换，使箭头/车头方向与位置一起翻转。
  - 传送带、乘客路径、车位及车辆到站/离场方向不受影响。
  - 坐标核对为右侧 84→90→89、左侧 85→86→88，与目标图一致。
  - pnpm test 9/9、生产构建和 JS 语法检查通过。

### Phase 18: 四人乘客组单排布局
- **Status:** complete（自动验证完成，待用户视觉确认）
- Actions taken:
  - 将每个乘客组的四个模型由 2×2 方阵改为以组中心对称的横向单排。
  - 传送带移动、队列补位和整组上车逻辑保持不变。
  - pnpm test 9/9、生产构建和 JS 语法检查通过。

### Phase 19: 乘客行走与上车动画
- **Status:** complete（自动验证完成，待用户视觉确认）
- Actions taken:
  - 使用隔离的 Unity batch 工具从只读源资源导出 VAT 对应网格：471 顶点、2007 索引。
  - 将 512×128 RGBAHalf 顶点动画贴图提取为 Web 二进制资源。
  - Three.js MeshStandardMaterial shader 接入 Passenger_Move（约 0.6 秒）和 Passenger_Idle（2 秒）。
  - 传送带乘客播放 Move；排队乘客播放 Idle，并保留原槽位相位错开。
  - 上车时四人以 0.05 秒间隔拆组，以 3.8 单位/秒逐个走向车辆。
  - 满载车辆增加 boarding-final 阶段，等待最后一组乘客视觉到达后再离站。
  - pnpm test 10/10、JS 语法和生产构建通过；dist 4,243,704 bytes。

### Phase 20: 全部乘客右转 90°
- **Status:** complete（自动验证完成，待用户视觉确认）
- Actions taken:
  - passengerYawDegrees 由 180° 调整为 270°。
  - 该统一参数同时作用于传送带、队列和上车移动中的全部乘客模型。
  - pnpm test 10/10、生产构建和 JS 语法检查通过。

### Phase 21: 单人模型局部旋转纠正
- **Status:** complete（自动验证完成，待用户视觉确认）
- Actions taken:
  - passengerYawDegrees 恢复为 180°，保持四人编组及路径朝向不变。
  - 新增 passengerModelYawDegrees=90°，只旋转每个小人模型，不旋转编组根节点和四人站位。
  - pnpm test 10/10、生产构建和 JS 语法检查通过。

### Phase 22: 单人模型改为左转 90°
- **Status:** complete（自动验证完成，待用户视觉确认）
- Actions taken:
  - passengerModelYawDegrees 由 +90° 改为 -90°。
  - 仅改变每个小人模型的局部朝向，编组根节点、同排站位和移动路径不变。
  - pnpm test 10/10、生产构建通过。

### Phase 23: Unity 正式汽车动效取证与接入
- **Status:** in progress
- Actions taken:
  - 接收约束：驶入、驶离、撞击方和被撞方必须严格复现原工程，不自行设计。
  - 开始从车辆状态机、碰撞检测、停车位和移动配置反向追踪参数与资源。

### Phase 26: Unity 相机与双平面投影对齐
- **Status:** in progress（代码与自动校验完成，待人工视觉验收）
- Unity 证据：Main Camera_2 为透视相机，俯角 55°、FOV 4.7°；BG01_split01 是相机子级的独立背景面。
- Web 已改为可调透视相机；玩法对象保持在同一世界水平面；背景按原图宽高比 cover。
- 人物和 Shadow_01 共用单人根节点，位置调整整体带动阴影。
- 21/21 测试通过，Vite 生产构建成功；本地预览地址被浏览器安全策略拒绝，保留人工视觉验收项。
## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | 首个 Three.js 功能原型已完成 |
| Where am I going? | 用户人工试玩确认 → 视觉校准 → 编辑器 / 资源接入 |
| What's the goal? | 完成功能与 Unity level1 一致的无原模型 Three.js 原型 |
| What have I learned? | 见 `findings.md` |
| What have I done? | 已初始化计划并固定范围与颜色映射 |
## 2026-07-03 Phase 23 完成

- 接入 `src/vehicle-motion.js`：Unity AnimationCurve 采样、圆角路径、驶入/驶离配置、碰撞距离/时序、四向 Bus hit clip。
- 更新 `src/game-model.js`：正式 colliding 状态、接触事件、目标车 hit 状态、动态驶入/驶离时长。
- 更新 `src/scene-view.js`：移除临时直线飞行与上抛；按路径弧长/切线驱动车辆；只对 Bus_001 车身应用受击关键帧。
- 新增 3 项车辆动效测试，合计 13/13 通过；`pnpm build` 成功，dist 4,255,415 bytes。
- 浏览器人工视觉验收未执行：本地地址控制此前被安全策略明确拒绝，保留给用户在已启动 dev 页面复核。
