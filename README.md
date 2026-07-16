# Bus Loop Playable Prototype

基于 Unity `Level_Escape_A/level1.asset` 与 `GameSceneDualQueue2.prefab` 的 Three.js 功能原型。人物、车辆、轮子、箭头、阴影和车位均已接入 Unity 原 FBX，传送带使用 `Loop_02_0` Sprite。

## 已实现

- level1 的 6 辆车位置、朝向、ID、颜色和容量
- 与 Unity 一致的车辆前方阻挡 / 逐层解锁
- 8 个候车位
- 来自 DualQueue2 override 的 19 点闭合 spline 与左右各 20 点入口路径
- 两个 24 容量队列入口汇入同一条 32 槽闭环传送带
- 固定 60 个四人组序列：前 30 组进入左队列，后 30 组进入右队列
- Unity `Loop_02.png` 中的 `Loop_02_0` Sprite 切片
- `BG_split01.mat` 对应背景图的独立背景平面
- `Idle_boy01.fbx` 与 Idle_New / Car_New 对应的 0–10 色纹理
- 4/6/10 座对应 `Car_001/Van_001/Bus_001.fbx`，保留独立 `Wheel_001` 网格
- `Arrow_01.fbx`、`Shadow_01.fbx` 与 `Car_P1` 对应停车位模型/材质
- 参考 Unity 竖屏布局：传送带在上、车位居中、车辆停车场在下
- 程序化浅蓝场地，未使用上一版背景图片
- 同色自动上车、10 组满载、自动离场
- Unity 传送带场景的胜利 / 死锁失败判定
- 按住 0.2 秒三倍速
- 重开与稳定 QA 接口 `window.__busLoop`


## 场景编辑器

页面右侧提供实时场景编辑器，可调：

- 传送带图片位置和 X/Z 尺寸，以及中间循环曲线的位置和 X/Z 尺寸
- 左右队列曲线各自的位置和 X/Z 尺寸（小人保持沿整条曲线均分）
- 车位起点、Z 坐标、间距、角度和 X/Z 尺寸
- 背景严格保持源图 `2100×3382` 宽高比
- 车辆模型统一大小

## 运行

```powershell
pnpm install
pnpm dev
```

## 验证

```powershell
pnpm test
pnpm build
```

当前自动化测试包含从初始局面按 `84 → 85 → 86 → 88 → 89 → 90` 完整跑到胜利。

生产构建约 3.04 MB。视觉布局仍需在本地 dev 页面进行一次人工复核。

## 场景调参

默认参数集中在 `src/scene-tuning.js`，也可以在控制台实时调整：

```js
window.__busLoop.setTuning({
  camera: { elevationDegrees: 55 },
  facing: { passengerYawDegrees: 180, vehicleYawOffsetDegrees: 0 },
  conveyorArt: { x: 0, z: -4.18, width: 14, depth: 8.286 },
  parkingSpots: { startX: -3.85, spacing: 1.1, z: 0.92 }
});
```
