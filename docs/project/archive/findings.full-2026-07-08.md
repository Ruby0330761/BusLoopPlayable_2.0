# Findings

## 2026-07-07 Vehicle/Passenger Color Texture Sampling

- `Bus_001.prefab`, `Van_001.prefab`, and `Car_001.prefab` in `D:/UnityProjects/BusLoop/Assets/BusJam/Game/Prefabs/Car_0307` use color materials that bind the same Car_0307/Idle color textures with `_MainTex` scale `{x:1,y:1}` and offset `{x:0,y:0}`.
- Vehicle visuals should keep the full Unity color atlas so authored window/light/body regions render from model UVs.
- Passenger visuals are not runtime-tinted from a single swatch in the Unity game. PassengerPool.Borrow(color) loads AssetUtils.GetPassengerAddress(color), i.e. passenger_{matchColor}.prefab; each ordinary passenger prefab variants Idle_boy01_1 and overrides MeshRenderer.m_Materials[0] to a color-specific Assets/BusJam/Game/Materials/Idle_New/Idle_*.mat.
- The ordinary passenger material _MainTex sources are full character textures, not sampled swatches: blue uses Idle_boy02_blue.png by inheritance, green Idle_boy03_green.png, pink Idle_girl01_pink.png, purple Idle_girl02_Purple.png, red Idle_boy01_red.png, yellow Idle_girl02_yellow.png, orange Idle_boy02_orange.png, lightblue Idle_girl01_light blue.png, brown Idle_boy03_brown.png, darkgreen Idle_boy01_dark green.png, and darkblue Idle_boy01_dark blue.png.
- Passenger color still is not just the raw full texture. The Unity materials use VertexAnimtion/Runtime/AnimSimpleLit.shader, where the sampled _MainTex is multiplied by _BaseCol lighting and also added through _EmissionCol. Web parity should keep the full Idle texture and apply the per-color _BaseCol/_EmissionCol values.

## 2026-07-07 Level12 Layout Import

- `D:/备份/改文件名临时文件�?level12.asset` is the active layout source for the current playable level: `id: 0`, `mapScale: 1.0012542`, `sceneName: GameSceneDualQueue2`, `passengerMethod: 4`.
- The asset contains 94 visible vehicles. Vehicle seat totals by color exactly match the fixed passenger queue totals: `{0:68,1:34,2:18,3:22,4:12,5:198,6:20,7:52,8:14}`.
- The asset contains two fixed passenger queues with 219 groups each. The web level now keeps these queues separately instead of flattening them into one shared source.
- The asset's `vehicleDepthes` section provides authored blocker data for 90 vehicles. The current web model treats these lists as the active blockers for each vehicle; initial movable vehicles are `1, 4, 34, 51`.

## 2026-07-07 Passenger Entrance Motion Parity

- Web `BusLoopGame` already creates `entryMotion` for every group entering the conveyor; the parity gap was in `SceneView`, which only used the full queue-entry path for `initialFill` groups.
- The existing initial-fill visual path is the desired behavior; non-initial entering groups should reuse it instead of falling back to the shorter straight-line interpolation from queue entry to belt slot.

## 2026-07-07 GameSceneDualQueue2 Lighting Parity

- `GameSceneDualQueue2.prefab` contains a `Directional Light` with color white, intensity 1, local position `{x:0,y:3,z:0}`, Euler hint `{x:62.5,y:-34,z:-4.5}`, soft shadow type 2, and shadow strength 0.7.
- Web should use this authored directional light config instead of the earlier warm high-intensity hardcoded sun.
- Web now has a Three.js real-time shadow path: renderer shadow maps, DirectionalLight shadow camera, a ShadowMaterial receiver plane, and configurable vehicle/passenger casters. Existing fake shadow textures remain available for parity and can be tuned independently.
- The real-time shadow receiver defaults cover about X `-9..9` and Z `-10.4..13.6`; enable the receiver debug overlay in the editor to see and tune the receiver plane range.
- Three.js directional shadow visibility depends on the shadow camera volume, not only the receiver plane footprint. The web light now focuses the shadow camera on the receiver center and backs the light away along the Unity-authored direction so casters and receiver fit the same shadow volume.
- If shadows are still hard to identify, enable the test shadow caster in the editor. If the test caster shadows but vehicles do not, the remaining issue is caster geometry/depth material rather than light/receiver setup.
- Passenger VAT animation uses a custom visible-material vertex path; if animated real-time passenger shadows need exact pose parity, add a matching custom depth/shadow material in a later pass.

## 2026-07-07 Vehicle Effect Prefab Parity

- Effect_Hit uses ParticleHit_2/Circle_01_Add, ParticleHit_1/Round_02_Add, and ParticleHit/Round_01_Add; web should spawn it once at vehicle-collision-contact.
- Effect_SmokeTrail uses ParticleTrail/Round_01_Alp as a looping 25/s moving-vehicle trail.
- Bus_FakeShadow is present in the web scene; parity requires Bus_FakeShadow.png left-half UVs and 0.8 opacity, not the global vehicle shadow opacity.

## 2026-07-07 Vehicle Arrow Prefab Parity

- `Bus_001.prefab` treats Arrow as part of the vehicle visual hierarchy; web hit clips should move the bus model and arrow under one shared hit root.
- Arrow outline parity is approximated by adding a scaled dark outline mesh behind the white Arrow_01 geometry.

## 2026-07-07 Current Task Findings

- `vehiclePath` currently controls only click-to-station entry paths.
- Departing vehicles currently use hardcoded `buildOutStationPoints(target)` plus a forward segment to `{ x: 4.2, z: forwardStart.z }`.
- Full-load wait currently uses `LEVEL_1.boardingDepartureDelay` directly in `BusLoopGame.update`.
- Count board rendering is in `SceneView.updateSeatCountBoard`; it currently redraws from `vehicle.boardedGroups` immediately, so counts jump by row size.
- Conveyor passengers use reusable views whose `visible` flag starts from the Three.js default until the first update; this may expose uninitialized white passengers before real queue/slot data arrives.

## 2026-07-07 Unity Conveyor Initial Fill Parity

- Unity ConveyorBelt advances spline percent from actual path distance: initial fill uses BusJamMovingConfig.Current.passengerSpeed, normal belt motion uses conveyorSpeed, both divided by spline length. Web should not use the old hardcoded 0.045 percent step.
- Unity PassengerQueue.TryDequeueCanAboard only supplies a passenger once the queue head is in the station/ready state. During initial fill, empty slots that reach an entry before the queue head is ready are clamped to just before the entry with InitialEntryOffsetPercent = 0.0001 until a passenger can be supplied.
