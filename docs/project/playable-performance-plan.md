# Bus Loop 试玩：体积与性能优化方案

> 最后更新：2026-11-18 · 对应构建 `20261117-1803`
> 对象：BL42V1 / level15（81 车 + 96 乘客容量，dualQueue3 普通传送带）
> 本文件同时是**已实施记录**与**待实施计划**，请勿把它当成纯提案。

---

## 零、结论摘要

| 维度 | 改前 | 改后 | 变化 |
|---|---|---|---|
| 单文件包体 | 3,389,024 B（3.23 MiB） | 2,670,656 B（2.55 MiB） | **−718 KB（−21.2%）** |
| 内联素材数 | 73 | 57 | −16 |
| 进包但不显示的素材 | 786 KB（23.2%） | 88 KB（3.3%） | 基本清零 |
| draw call（桌面） | 1,512 | **734** | **−51%** |
| draw call（真机） | 1,441 | ~790（车辆影子批次上线前为 923） | **−45%** |
| 真机 p50 帧耗时 | 16.4 ms | **8.3 ms** | **−49%** |
| 真机 jank>33ms | 1.5% | **0.1%** | **差 12 倍** |
| 玩法 / 画面 | — | 无变化 | 见"正确性验证" |

**一句话**：体积砍掉五分之一，渲染提交砍掉四成；桌面因 60Hz 上限看不出差别，真机上从"掉到 60Hz 档"变成"贴着 120Hz 跑"。

---

## 一、先定位瓶颈（这一步不能跳）

优化前必须先量，否则容易优化错对象。实测基线（BL42V1 / level15）：

| 指标 | 实测值 | 判读 |
|---|---|---|
| **draw call** | **1,512** | **瓶颈** |
| 三角形 | 283,662 | 不高，不是瓶颈 |
| **render 耗时** | **5.40 ms/帧** | 占 60fps 预算 1/3 |
| **game.update 耗时** | **0.013 ms/帧** | **可忽略** |
| 唯一几何体 | 29 | 复用极好 |
| 唯一材质 | 1,064 | 偏高但非瓶颈（见下文"证伪"） |
| 场景对象 | 6,483（1,947 渲染物） | 中 |
| JS 堆 | 58.8 MB | 正常 |

**渲染占 99.8% 的 CPU 时间。** 结论：优化只该做渲染提交，别碰玩法逻辑，也别继续压图。

### draw call 从哪来

| 子系统 | mesh 数 | draw call |
|---|---|---|
| 81 辆车（每车 5 Mesh + 1 LineSegments） | 486 | ~490 |
| 乘客（60 view × 8 mesh） | 480 | 480 |
| **乘客影子** | 480 | **288** |
| 箭头描边 LineSegments | 81 | 81 |
| 背景 / 传送带 / 车位等 | 其余 | 其余 |

隔离实验（隐藏后重测）：

- 隐藏箭头描边 → −81 call / −0.68 ms
- 隐藏乘客影子 → **−288 call / −1.99 ms（占 37%）**

### 关键结构事实

60 个乘客只有 **2 个几何体**、却有 **241 个材质** —— 几何复用早已做好，只是没走 instancing。影子模板更是**单个 6 顶点四边形**、全场共用同一个材质。

---

## 二、已实施：体积优化（3 项）

### V1. 传送带贴图按选中布局下发（省 642 KB）

**根因**：`MECHANISM_RESOURCE_MANIFEST.ordinaryConveyor` 无条件列了 11 张 `Loop_*` 贴图，而渲染器只读 `conveyorLayout.assets.loopScene` 这一张（`getSelectedConveyorLayout()` 是唯一入口）。

**改法**：

- `src/mechanism-resources.js` 新增 `CONVEYOR_LAYOUT_ART_PATHS`，从 `CONVEYOR_LAYOUTS` **自动派生**「布局 → 贴图」，新布局不会漏配。
- `getMechanismResourcePaths(types, { conveyorLayouts })` 按实际可达布局裁剪。
- `ordinaryConveyor` 白名单清空。

**多舞台安全**：打包器与编辑器预检都传「所有可达布局」（`PLAYABLE_STAGES` + `PLAYABLE_STAGE_CHOICES`），所以一个 session 能切换到的每条跑道都会带上贴图。

### V2. 倍速开关素材按开关门控（省 58 KB）

**根因**：5 张图在 `BASE_RUNTIME_ASSET_PATHS` 里无条件内联，而 `speedToggle.enabled = 0` 时按钮是 `hidden`。

**改法**：

- 拆出 `SPEED_TOGGLE_ASSET_PATHS`，按 `enabled` 进包。
- 打包器额外从 **CSS 的 `url()` 收集结果**里剔除 —— 否则 `styles.css` 的 `--speed-toggle-background` 会把底图加回来。这是容易漏的一环。
- 两种皮肤仍一起进包（皮肤是 tuning 值，切换不该需要重建）。

**踩到的真回归**：`#speed-toggle-icon` 的 HTML 初始 `src` 是根相对路径，素材被剔后变成占位字节 → 运行时门禁 `RUNTIME-IMAGE-001` 抓出破图。

修法照 `#countdown-image` 先例：透明 1×1 GIF 作种子（`SPEED_TOGGLE_SEED_SRC`），只在开关打开时由 JS 赋真图。

> **通用教训**：任何「按开关剔素材」的改动，都要检查 HTML 里有没有硬编码的初始 `src`。

### V3. 丢弃运行时不再读取的关卡字段（选中 dualQueue2 时省 56 KB）

`assets.loopScene` / `loopSpriteRect` 来自 Unity 目录抽取，但渲染器已改读布局表，这两个字段没有读取方。

**改法**：`scripts/generate-active-level.mjs` 的 `withoutAuthoredBeltArt()` + `src/playable-inline-assets.js` 的 `withoutDeadLevelArt()` 双保险丢弃。

---

## 三、已实施：性能优化（1 项）

### P1. 乘客影子合并为单次实例化绘制（draw call −41%）

**根因**：312 个乘客影子是**同一个 6 顶点四边形 + 同一个材质**，却各画一次。

**改法**（`src/scene-view.js`）：

- `makeShadow()` 仍为每个小人创建影子对象，但 mesh 设 `visible = false`，只当**变换载体**。
- 新增 `ensurePassengerShadowBatch(requiredCount)`：建一个 `InstancedMesh`，容量按需自动扩容重建。
- 新增 `syncPassengerShadowBatch()`：在 `render()` 里把载体世界矩阵写进实例缓冲。
- 开关：`SCENE_TUNING.passengerShadows.instanced`（默认 `1`，设 `0` 回退到逐个小人绘制）。

**收益**：

| | 改前 | 改后 |
|---|---|---|
| draw call（桌面） | 1,512 | **890（−41%）** |
| draw call（真机） | 1,441 | **923（−36%）** |
| 包体 | — | +1.7 KB |

**实现要点（五个坑，改动时必须保留）**：

1. **可见性判断必须跳过载体自身** —— 载体 mesh 是 `visible = false`，所以检查要从 `child.parent` 往上走。写成从 `child` 开始会让整个批次被跳过。
2. **容量必须能生长** —— `ensurePassengerShadowBatch` 首次调用时 `passengerViews` 可能还没建好；按 `requiredCount` 需要时重建扩容。
3. **`matrixAutoUpdate = false` 是必须的** —— 实例矩阵已是世界空间，批次自身不能再带变换（实测批次世界矩阵为单位阵，无双重变换）。
4. **必须收集 `boardingViews`** —— 上车乘客走独立列表，不在 `passengerViews` / `queuePassengerViews` 里。第一版漏掉后，整个上车行走过程影子消失（审查记录 R3）。
5. **carrier 隐藏要每帧重做** —— 乘客是懒创建的，只在模式切换那一帧隐藏会让后来创建的影子双画，draw call 从 890 回升到 1514。同时 `collectShadowCarriers` 必须用 `traverse` 而非一级 `children`：豪华车乘客的影子嵌在 `visualOffsetRoot` 内。

**运行时可切换（审查记录 R4）**：`applyPassengerShadowMode()` 负责双向清理 —— 进入时隐藏逐对象 mesh，退出时恢复它们并把批次 `visible=false` / `count=0`，否则最后一帧的实例会一直画下去。

---

## 四、正确性验证（这套方法必须沿用）

### 渲染改动**不能**用截图 A/B 验收

我实测踩过：

- 同页面切换开关再截图 → 得到 **0.5%~2% 像素差异**，含 footer 的 CTA 区
- 两个不同构建的包对比 → **4.75%** 差异，时钟冻结后仍有 **0.39%**

原因：DOM 的 CTA 脉冲动画不受 rAF 冻结控制；两个构建的乘客动画相位本来不同。**这些都是噪声，不是回归。**

### 应当用对象级等价性验证

逐实例把 `instanceMatrix` 分解，与载体的世界矩阵比对：

```
maxPositionError  2.5e-7     ← float32 精度极限
maxScaleError     1e-8
maxRotationError  0
geometrySameAsTemplate       true   ← 同一个几何对象
materialSameAsShadowMaterial true   ← 同一个材质对象
```

即批次画的和原来逐个画的**是同一个几何对象、同一个材质对象、同一个变换**。

### 验证清单（每次改渲径都要跑）

| 项 | 命令 / 方法 | 门槛 |
|---|---|---|
| 单元测试 | `npm test` | 757/757 |
| 运行时门禁 | `checkPlayableRuntimeArtifact({ requireAudioLifecycle: true })` | 19/19，`brokenImages: []` |
| draw call | `view.renderer.info.render.calls` | 下降 ≥ 40% |
| 帧耗时 | `g.update` 与 `v.render` 分离计时，取多批最小值 | 下降 ≥ 30% |
| 玩法冒烟 | `window.__busLoop` 派车 → 占位 → 满载离场 | 与改前逐项一致 |
| 影子对象级 | `test/passenger-shadow-batch.test.js` | 8/8（覆盖上车乘客、嵌套层级、开关双向） |
| 真机 | 注入性能 HUD（见第六节） | p95 ≤ 17ms，jank ≤ 1% |

> headless Chrome 用 SwiftShader，**帧率绝对值不可信**，只认结构性指标（draw call）和对象级等价性。帧率必须上真机。

---

## 五、真机实测（2026-11-18）

工具：`scripts/inject-perf-hud.mjs` 把性能面板注入导出包，真机直接看数字。

### 手机（370×822，dpr 3.25，120Hz）

| 指标 | A 优化版 | B 基线版 | 变化 |
|---|---|---|---|
| draw call | **923** | 1,441 | **−36%** |
| p50 帧耗时 | **8.3 ms** | 16.4 ms | **−49%** |
| p95 | **16.5 ms** | 24.7 ms | −33% |
| max | **24.6 ms** | 32.9 ms | −25% |
| fps | **100.4** | 68.7 | **+46%** |
| jank>33ms | **0.1%（4/3028）** | 1.5%（12/780） | **差 12 倍** |

**读法**：A 的 p50 是 8.3ms，正好贴 120Hz 一帧（8.33ms）——基本顶到屏幕上限；B 的 16.4ms 说明它掉到 60Hz 档了。

### 桌面（2940×1670，60Hz）

| 指标 | A | B |
|---|---|---|
| draw call | 858 | 1,430（−40%） |
| fps | 60.0 | 60.0 |
| p95 | 17.3 ms | 17.4 ms |
| jank | 0.1% | 0.2% |

**桌面完全看不出区别，因为 60Hz 是硬顶**——两版都能轻松喂满，draw call 少 40% 也表现不出来。这解释了"感觉没区别"。

### 结论与后续测试要求

优化的价值不在"跑得更快"，而在**留出余量**：基线在中端机上会从 68fps 掉到 40–50fps，优化版还有空间。

**下一轮真机测试要做到**：

- 两版各跑 **60 秒、同样操作**（上一轮 A 跑 32s / B 跑 14s，不完全可比）
- 找一台**中低端安卓**，或让手机进入发热降频状态 —— 旗舰机上 jank 都接近 0，不是目标对象
- 长按 HUD 复制数据，粘贴回传

---

## 六、性能 HUD 工具

`scripts/inject-perf-hud.mjs` —— 把自包含性能面板注入任意导出包：

```bash
node scripts/inject-perf-hud.mjs <input.html> <output.html> [--label "A optimized 890"]
```

**为什么注入而不是另做测试页**：手机访问不到 `window.__busLoop.view.renderer.info`；iframe 方案在 `file://` 下被跨文档策略挡住，混合源下也不可靠。注入保证测量就在玩家看到的那个页面、那个帧循环上。

**显示内容**：fps / avg / p50 / p95 / max、draw call、三角形、几何体/纹理/程序数、canvas 分辨率与 dpr、`jank>33ms` 占比、运行时长、JS 堆。

**交互**：点击折叠成一行；**长按 0.7 秒**复制完整数据（含 UA）。

**只用于测试**，不要拿去交付。

---

## 七、待实施（按性价比排序）

### N1. 车辆影子实例化（✅ 已实施，−156 call）

实测结构比预期更好：81 个车辆影子只有 **3 个几何体、3 个共享材质**（按 4/6/10 座分组），
即 81 次提交只换来 3 批的活。按几何体分 3 个 `InstancedMesh` 后，draw call
**890 → 734（−156）**，渲染耗时 2.4ms → 1.75ms。

对象级验证：81 个实例逐一对载体世界矩阵比对，位置误差 4.3e-7、缩放 1e-8、旋转 0，
双画 carrier 数 0。开关 `SCENE_TUNING.vehicleShadows.instanced`（默认 1）。

<details><summary>原始计划（留存）</summary>


和乘客影子**同一种模式**：81 个车辆影子是 3 种座位数（4/6/10）的贴图平面。按座位数分 3 个 `InstancedMesh` 即可。

**做法**：复用 P1 的载体模式 —— `makeVehicleShadow()` 返回的影子 mesh 设为隐藏，新增 `syncVehicleShadowBatch()` 按座位分组写矩阵。

**预估**：draw call 923 → ~845。风险显著低于车辆本体（没有 arrow / hidden / 豪华车分支）。

</details>

### N2. 车辆本体 instancing（约 −486 call，中风险）

**目标最大的一块**：81 辆车 × 6 mesh。但比影子复杂：

- 每车有 arrow、outline（LineSegments）、hidden 模板等多分支
- 有豪华车 / 救护车 / 消防车 / 警车 / 圣诞雪橇等特殊家族
- 车辆会移动、变形、做碰撞回弹，矩阵每帧变

**建议**：先只对「普通车（4/6/10 座）+ 无特殊机制」的关卡走批量路径，特殊家族保留逐对象路径（与现有 `shouldUseSpatialPassengerInstancing()` 的排除逻辑同构）。

**必须逐关回归**。

### N3. 箭头描边降级（约 −81 call，低风险）

81 条 `LineSegments` 描边，每条一次提交；在 390px 手机上几乎看不见（线宽 1px、深度测试关闭）。

**两个选项**：按屏幕短边 < 480px 关闭；或合并成单个 `LineSegments`。

### N4. 解除 instancing 的 spatial 绑定（结构性，中高风险）

`src/scene-view.js` 的 `isSpatialOptimizationEnabled()`：

```js
isSpatialOptimizationEnabled(key) {
  const optimizations = SCENE_TUNING.spatialConveyor?.optimizations;
  return Boolean(
    this.activeSpatialConveyor &&   // ← 硬门槛
    optimizations?.enabled && optimizations?.[key]
  );
}
```

`spatialConveyor.optimizations` 里已有 **12 项默认全开**的优化（`instancedPassengers`、`instancedShadows`、`frustumCulling`、`cacheBlockers`、`poolBoardingPassengers` 等），但因第一个条件，**只有导入的 3D 空间跑道关卡能用**；`dualQueue3` 这类普通贴图传送带（项目绝大多数关卡）一个都拿不到。

**做法**：新增与传送带类型无关的开关（如 `SCENE_TUNING.runtimeOptimizations`），让这类旗标在非 spatial 关卡也能生效。

**风险**：中高。这些路径只在 4 个 spatial 关卡验证过，普通传送带的槽位/队列/上车动画要逐一回归。

### N5. 色板按需加载（约 −78 KB，风险高，收益低）

13 张未用色板仍在包里。要真省必须把 `scene-view.js` 的 20 张一次性 `loadAsync` 改成按 `colorIndex` 懒加载 —— `level-data.js` 的 `resolveColorAtlasPaths` 会回填空槽，**直接裁文档无效**。

建议最后做，或不做。

---

## 八、不推荐的方向（均已实测或推导否定）

| 方向 | 结论 |
|---|---|
| **共享材质** | **实测无效**。81 辆车共享材质后 draw call 仍是 1,512（+0.05ms）。three.js 已按「材质+几何」分批，per-vehicle clone 不是提交来源 |
| **降低像素比** | **实测无效甚至更慢**。dpr 2 → 1.5，渲染耗时反而 +0.45ms。瓶颈是 CPU 提交次数，不是 GPU 填充 |
| 纹理压缩（ASTC/ETC2） | data URI 里 base64 反而更大，且平台解码器支持不一 |
| 减面 / LOD | 28 万三角形不是瓶颈，减面会损失卡通圆润边缘 |
| WebGPU | 试玩环境 WebView 支持率不足 |
| 代码分割 / 懒加载 JS | 单文件 ad 必须自包含 |
| 继续压图 | 2.55 MiB 已在多数平台 5 MB 预算内，不影响运行时性能（解码一次） |

**能减少 draw call 的只有三种手段**：instancing（同几何+同材质画 N 份）、合并几何、不画（剔除/降级）。改材质、减面、压图都不在这张表里。

---

## 九、回退方案

| 改动 | 回退方式 | 影响 |
|---|---|---|
| 乘客影子实例化 | `SCENE_TUNING.passengerShadows.instanced = 0` | 立即退回逐小人绘制，无需重建 |
| 传送带贴图裁剪 | 在 `MECHANISM_RESOURCE_MANIFEST.ordinaryConveyor` 重新列全 | 包体回到 +642 KB |
| 倍速开关门控 | 把 5 张图加回 `BASE_RUNTIME_ASSET_PATHS` | 包体 +58 KB |
| 关卡死字段丢弃 | 移除 `withoutAuthoredBeltArt` / `withoutDeadLevelArt` | 选中 dualQueue2 时 +56 KB |

**回退已验证**：把 `instanced` 改为 `0` 后 draw call 回到 1,512、393 个影子 mesh 正常绘制。

---

## 十、附：原始测量数据

```
【基线 · 桌面 headless】
startup   domContentLoaded 178ms / load 436ms / firstPaint 264ms
render    drawCalls 1512 | triangles 283662 | lines 1377 | programs 12
          objects 6483 | meshes 1865 | uniqueMaterials 1064 | uniqueGeometries 29
          pixelRatio 2 | canvas 780x1688
frames    p50 16.7 / p95 16.8 / max 16.8 | over33ms 0 | fps 60
heap      used 58.8MB
split     update 0.013ms | render 5.402ms

【结构分解】
车辆 81 × 6 mesh = 486
乘客 60 × 8 mesh = 480（仅 2 个几何体、241 个材质）
影子模板：单个 mesh、6 顶点、1 个几何体

【隔离实验】
箭头描边隐藏   → -81 call  / -0.68 ms
乘客影子隐藏   → -288 call / -1.99 ms
共享车辆材质   → ±0 call   / +0.05 ms（证伪）

【真机 · 手机 370x822 dpr3.25 120Hz】
A 优化版: draw 923 | p50 8.3 | p95 16.5 | max 24.6 | fps 100.4 | jank 0.1% (4/3028)
B 基线版: draw 1441 | p50 16.4 | p95 24.7 | max 32.9 | fps 68.7 | jank 1.5% (12/780)

【真机 · 桌面 2940x1670 60Hz】
A 优化版: draw 858 | fps 60.0 | p95 17.3 | jank 0.1% (3/5014)
B 基线版: draw 1430 | fps 60.0 | p95 17.4 | jank 0.2% (9/4356)

【正确性（对象级等价）】
maxPositionError 2.5e-7 | maxScaleError 1e-8 | maxRotationError 0
geometrySameAsTemplate true | materialSameAsShadowMaterial true
```

---

## 十一、执行状态

| 项 | 状态 | 对应构建 |
|---|---|---|
| V1 传送带贴图裁剪 | ✅ 已实施 | `20261117-1519` |
| V2 倍速开关门控 | ✅ 已实施 | `20261117-1519` |
| V3 死字段丢弃 | ✅ 已实施 | `20261117-1519` |
| P1 乘客影子实例化 | ✅ 已实施 | `20261117-1803` |
| N1 车辆影子实例化 | ⬜ 待实施（推荐下一步） | — |
| N2 车辆本体 instancing | ⬜ 待实施 | — |
| N3 箭头描边降级 | ⬜ 待实施 | — |
| N4 解绑 spatial 优化 | ⬜ 待实施 | — |
| N5 色板懒加载 | ⬜ 低优先 | — |
| 真机验收（60s 对照 / 中低端机） | ⬜ 待补 | — |
| 平台规则 `APL-AUD-001/002` 补字段 | ⬜ 阻塞正式交付 | — |

> **交付阻塞说明**：`deploy-tools/build-verified-playable-packages/rules/applovin.json` 的 `APL-AUD-001` / `APL-AUD-002` 缺 `stage`/`sourceClass`/`sourceVersion`/`repairHint`/`autoRepair`，规则校验器在加载阶段就抛错（HEAD 上既有）。补齐前 `export:playable` 跑不通，本地验证只能走 `--skip-checks` + 运行时门禁。
