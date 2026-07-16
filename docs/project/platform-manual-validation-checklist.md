# Platform Manual Validation Checklist

## Effect_Ribbon visual check

- Trigger a vehicle to fill and leave a parking spot.
- Confirm Effect_Ribbon fires once when the vehicle leaves.
- Confirm ribbon particles use varied sub-images from Ribbon_01 rather than the full 3x3 atlas as one sprite.
- Confirm smoke particles appear with the ribbon burst.
- Compare ParticleRibbon / ParticleSmoke initial size and fade-out speed against the Unity reference recording or Inspector values.
- Compare ParticleRibbon / ParticleSmoke movement range after spawn against Unity.
- Compare ParticleRibbon / ParticleSmoke speed-over-lifetime / deceleration curve against Unity.
## 2026-07-06 车辆行驶路径显示与形态调参验收

- [ ] 打开“车辆行驶路径 / 显示路径”后，可点击车辆到第一个空车位的预测路径线可见。
- [ ] 关闭“显示路径”后，预测路径线立即隐藏，车辆正常点击和移动不受影响。
- [ ] 调整“边界左/右 X、边界上/下 Z”后，预测路径的矩形绕行边界实时变化，车辆实际开出路线与显示线一致。
- [ ] 调整“转弯半径、入弯控制、出弯控制”后，路径转角圆滑程度实时变化，且不影响满载车辆从车位离开的路径。
- [ ] 打开“显示被挡车”后，被阻挡车辆路径以更低透明度显示；关闭后只显示当前可出车辆路径。
