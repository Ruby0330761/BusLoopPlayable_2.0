# Playable Project Progress

## 2026-07-07 realtime shadow removal

- Removed the Three.js realtime shadow-map path, including the shadow receiver/debug caster scene objects, realtime shadow mesh flags, tuning defaults, and editor controls.
- Kept authored fake shadows for passengers and vehicles as the only runtime shadow layer.
- Verification: `node --check src/scene-view.js`, `src/scene-tuning.js`, `src/scene-editor.js`, and `test/game-model.test.js`; elevated targeted `node --test --test-name-pattern "Unity visual assets|editor sizing" test/game-model.test.js` passed; elevated `npm.cmd run build` passed with the existing large chunk warning.

## 2026-07-07 passenger hex tuning performance

- Optimized Passenger Material hex editing: color fields no longer use high-frequency range sliders or color input events.
- Passenger material-only tuning now refreshes VAT materials without reinitializing queues or running full scene layout tuning.
- Verification: node --check src/scene-editor.js, src/scene-view.js, src/main.js, test/game-model.test.js; elevated targeted node --test --test-name-pattern "editor sizing" test/game-model.test.js passed.

## 2026-07-07 Bus and Van fake shadow restore

- Restored visible fake shadows for Van and Bus by sizing each vehicle shadow template from the matching vehicle model depth instead of forcing all shadows to depth 1.
- Removed the extra Bus shadow texture half-repeat so the FBX-authored UVs sample the intended shadow texture area like Car and Van.
- Verification: `node --check src/scene-view.js`; `node --check test/game-model.test.js`; elevated targeted `node --test --test-name-pattern "Unity visual assets|editor sizing" test/game-model.test.js` passed; elevated `npm.cmd run build` passed with the existing large chunk warning.

## 2026-07-07 passenger material tuning controls

- Added editor controls for passenger material base color, emission color, base strength, emission strength, brightness, roughness, and metalness.
- Passenger VAT materials now refresh these tuning values for existing conveyor, queue, and boarding passengers when the web editor changes.
- Kept passengers on full Unity Idle textures and vehicles on full Unity vehicle atlases.
- Verification: node --check src/scene-view.js, src/scene-tuning.js, src/scene-editor.js, src/main.js, and test/game-model.test.js passed.

## 2026-07-07 bottom operation toast removal

- Removed the transient bottom operation message UI for blocked buses, vehicle moves, and full-load departures while keeping gameplay events, audio, and the end panel intact.
- Verification: `node --check src/main.js`; targeted `rg` confirmed the old toast strings and `showMessage` hook are gone.

## 2026-07-07 passenger swatch and Map Scale editor control

- Kept vehicle materials on the full Unity color atlas so Bus/Van/Car subregions retain their authored window/light/body colors.
- Split passenger materials to sample the fixed upper-left swatch from each color atlas, matching the requested solid passenger color behavior.
- Renamed the existing `vehicleArea.positionUnitScale` editor control to `Map Scale` so the web panel exposes level map scaling directly.
- Verification: `node --check src/scene-view.js`, `node --check src/scene-editor.js`, `node --check test/game-model.test.js`, and a targeted source assertion passed.

## 2026-07-07 vehicle and passenger color swatch parity

- Checked Unity `Bus_001.prefab`, `Van_001.prefab`, and `Car_001.prefab`: color variants use the shared Car_0307/Idle color textures without material UV offset.
- Updated web vehicle and passenger materials to sample a fixed upper-left swatch from each Unity color texture instead of using the full character texture UVs.
- Updated fallback color constants to match the sampled Unity swatch pixels.
- Verification: `node --check src/scene-view.js`, `node --check src/level-data.js`, and `node --check test/game-model.test.js` passed. `node --test test/game-model.test.js` was blocked by the sandbox `spawn EPERM`; escalation could not be approved by the auto-review service.
## 2026-07-07 level12 layout replacement

- Replaced the active level's vehicle layout and dual fixed passenger queues with `D:/备份/改文件名临时文件�?level12.asset` data: 94 vehicles and 438 passenger groups split across two 219-entry queues.
- Added the asset's `vehicleDepthes` blocker data to the web level config and made `BusLoopGame.getBlockers` prefer authored blockers when present. Initial movable vehicles now match the imported depth config: `1, 4, 34, 51`.
- Updated level/game-model tests away from the old 6-vehicle assumptions and onto level12 data integrity, queue counts, depth blockers, dispatch, boarding, and departure scenarios.
- Verification: `node --check src/level-data.js`, `src/game-model.js`, `src/scene-tuning.js`, `src/scene-view.js`, `test/game-model.test.js`; targeted `node --input-type=module` assertions for level counts, color totals, queue lengths, depth blockers, entry motion metadata, dispatch, boarding, and departure. `node --test test/game-model.test.js` could not run in the sandbox because the Node test runner hit `spawn EPERM`; escalation was unavailable.

## 2026-07-07 passenger entrance motion parity

- Reused the existing initial-fill entrance visual path for every group with `entryMotion`, including groups spawned after initial fill.
- Removed the non-initial straight-line entrance branch so later groups visually generate from the queue/entrance path like initial-fill groups.
- Verification: `node --check src/scene-view.js`; `node --check test/game-model.test.js`; direct `BusLoopGame` scenario confirmed post-initial-fill refill keeps `entryMotion.initialFill: false`. `node --test test/game-model.test.js` could not run in the sandbox because the Node test runner hit `spawn EPERM`, and escalation was unavailable.

## 2026-07-07 initial queue fill investigation

- Compared web initial-fill behavior against Unity `ConveyorBelt.cs` and identified likely parity gaps around initial-fill clamping, queue visibility, and entering-slot motion.
- Reverted the first visual-only attempt because showing every queue passenger during initial fill caused runtime responsiveness problems in the web preview.
- Next action: implement a lower-risk model-level parity fix for Unity's initial-fill clamp/hold behavior instead of increasing first-frame visible passenger load.

## 2026-07-07 core gameplay audio hookup

- Added Unity-configured core SFX for vehicle collision, normal passenger boarding, and full vehicle departure.
- Copied the referenced Unity clips into `public/assets/unity/audio/` and wired playback through `src/audio-controller.js`.
- Passenger-up plays from the three Unity random variants when each visual passenger reaches the vehicle; collision/full sounds follow model events.
- Verification: `node --check src/audio-controller.js`, `src/main.js`, `src/scene-view.js`, `src/level-data.js`; `node --test test/game-model.test.js`; `npm.cmd run build` passed. Test/build required escalation because sandboxed Node child process spawn failed with `EPERM`. Build keeps the existing >500 kB chunk warning.

## 2026-07-07 vehicle arrow outline color control

- Exposed `vehicleArrow.outlineColor` in scene tuning and the editor so vehicle arrow outline color can be adjusted.
- Arrow outline material now updates both the template and all cloned vehicle arrow visuals when tuning changes.
- Added a visible `EdgesGeometry` outline layer because the original enlarged duplicate mesh could be hidden by the white arrow body on the flat arrow model.
- Added color picker controls for editor color fields while keeping numeric Hex input.
- Verification: `node --check src/scene-view.js`, `src/scene-tuning.js`, `src/scene-editor.js`; `node --test test/game-model.test.js` passed.

## 2026-07-07 realtime shadow visibility fix

- Recentered the Three.js DirectionalLight shadow camera on the receiver plane instead of the Unity-authored light position, then backed the light away along the authored direction using `shadowLightDistance`.
- Increased default shadow camera far distance to 80 and default receiver opacity to 0.75 so real-time shadows are much easier to identify while tuning.
- Added editor controls for shadow color, receiver depth test, shadow light distance, and a visible test shadow caster.
- Verification: `node --check src/scene-view.js`, `src/scene-tuning.js`, `src/scene-editor.js`; `node --test test/game-model.test.js`; `npm.cmd run build` passed with the existing >500 kB chunk warning.

## 2026-07-07 boarding vehicle scale pulse

- Added a vehicle scale pulse when each boarding passenger reaches the parking spot center: vehicles scale up then return to their current base scale.
- Exposed editor tuning under vehicle controls: `vehicleBoardingPulse.scale` and `vehicleBoardingPulse.speed`.
- Updated the stale realtime shadow receiver opacity test expectation to the current default `0.75`.
- Verification: `node --check src/scene-view.js`, `src/scene-tuning.js`, `src/scene-editor.js`; `node --test test/game-model.test.js`; `npm.cmd run build` passed with the existing >500 kB chunk warning.

## 2026-07-07 realtime shadow receiver debug overlay

- Expanded the default real-time shadow receiver to cover the main gameplay area: approximately X `-9..9` and Z `-10.4..13.6`.
- Increased the default shadow camera size to 24 so it covers the larger receiver plane.
- Added editor controls to show a translucent receiver debug overlay, including debug color and opacity.
- Verification: `node --check src/scene-view.js`, `src/scene-tuning.js`, `src/scene-editor.js`; `node --test test/game-model.test.js`; `npm.cmd run build` passed with the existing >500 kB chunk warning.

## 2026-07-07 realtime shadow map controls

- Enabled Three.js real-time shadow maps for the authored Directional Light.
- Added a configurable ShadowMaterial receiver plane plus editor controls for shadow map size, shadow camera size/near/far, bias, normal bias, soft radius, receiver position/size/opacity, vehicle casting, passenger casting, and parking spot receiving.
- Vehicle and passenger meshes now opt into real-time shadow casting while fake shadow meshes are excluded from caster/receiver flags.
- Verification: `node --check src/scene-view.js`, `src/scene-tuning.js`, `src/scene-editor.js`; `node --test test/game-model.test.js`; `npm.cmd run build` passed with the existing >500 kB chunk warning.
- Browser screenshot verification was attempted, but Playwright browser launch is blocked in the sandbox and the normal Node shell lacks the Codex Playwright package.

## 2026-07-07 lighting editor controls and Effect_Hit size tuning

- Exposed Directional Light controls in the scene editor: enabled, color, intensity, position, Euler rotation, shadow type, and shadow strength.
- Added Effect_Hit size tuning for overall scale plus ParticleHit_2, ParticleHit_1, and ParticleHit child particle size scales.
- Saved scene tuning now deep-merges into defaults so older browser tuning does not drop newly added editor fields.
- Verification: `node --check src/main.js`, `src/scene-view.js`, `src/scene-tuning.js`, `src/scene-editor.js`, `src/vehicle-effects.js`; `node --test test/game-model.test.js` and `node --test test/vehicle-effects.test.js` passed.

## 2026-07-07 GameSceneDualQueue2 directional light parity

- Restored the web scene directional light from `GameSceneDualQueue2.prefab`: white color, intensity 1, position `{0,3,0}`, Euler `{62.5,-34,-4.5}`, soft shadow type 2, and shadow strength 0.7 recorded in tuning.
- Replaced the prior hardcoded warm high-intensity sun with tuning-driven Unity light placement.
- Verification: `node --check src/scene-view.js`, `node --check src/scene-tuning.js`, and `node --test test/game-model.test.js` passed.

## 2026-07-07 ParticleRibbon color and opacity fix

- Restored ParticleRibbon cyclic colors so per-particle colors are not overwritten to white during runtime updates.
- Set ParticleRibbon opacity multiplier back to 1 while preserving normal lifetime fade behavior.
- Verification: `node --check src/vehicle-effects.js` and `node --test test/vehicle-effects.test.js` passed.

## 2026-07-07 vehicle hit and smoke trail effects

- Added Effect_Hit parity using ParticleHit, ParticleHit_1, and ParticleHit_2 configs from Unity, including Circle_01/Round_02/Round_01 textures and additive materials.
- Added Effect_SmokeTrail parity for moving vehicles using Round_01_Alp config and 25/s continuous emission.
- Fixed Bus_FakeShadow material to use the left half of Bus_FakeShadow.png at 0.8 opacity.
- Verification: `node --check src/vehicle-effects.js`, `node --check src/scene-view.js`, `node --test test/vehicle-effects.test.js`, and `node --test test/game-model.test.js` passed. Build intentionally skipped per request.

## 2026-07-07 vehicle arrow Unity parity

- Vehicle arrow visuals now include a dark outline layer around the Arrow_01 mesh.
- Vehicle model and arrow are wrapped under a shared hit root during Unity hit clips, so collision wobble moves both together like the prefab hierarchy.
- Verification: `node --check src/scene-view.js`, `npm.cmd test` passed 34/34, and `npm.cmd run build` passed with the existing >500 kB chunk warning.

## 2026-07-07 vehicle departure path and count-board fixes

- Added `SCENE_TUNING.vehicleDeparturePath` and web editor controls for vehicle exit path preview, back distance, turn/target shape, speed, and full-load delay.
- Fixed conveyor/queue passenger placeholders starting visible before the first game snapshot, reducing initial passenger flicker.
- Count boards now decrement per passenger during boarding visuals, so one row boards as 8, 7, 6, 5, 4 instead of jumping 8 to 4.
- Count-board updates now require the vehicle to still occupy that spot, preventing an old departed vehicle from hiding a reused spot's board.
- Verification: `npm.cmd test` passed 34/34; `npm.cmd run build` passed with the existing large chunk warning.
## 2026-07-07 editor text encoding and seat count fix

- Converted the two new Effect_Ribbon editor groups to escaped labels so the web editor renders Chinese consistently.
- Seat count boards now display remaining passenger count from remaining rows times LEVEL_1.groupSize, so the last row shows 4 instead of 1.
- Verification: npm.cmd test passed 33/33.

## 2026-07-06 Effect_Ribbon editor controls

- Exposed Effect_Ribbon movement tuning in the web scene editor:
  - �볡�ʴ�����: moveRange, speedStart, speedMidTime, speedMid, speedEnd.
  - �볡��������: moveRange, speedStart, speedMidTime, speedMid, speedEnd.
- VehicleEffects now receives SCENE_TUNING.effects from SceneView and applies editor values when spawning ParticleRibbon / ParticleSmoke.
- Verification:
  - npm.cmd test: 32 passed.
  - npm.cmd run build: passed; Vite still reports the existing >500 kB chunk warning.
# Playable Project Progress

## 2026-07-07 vehicle and passenger color swatch parity

- Checked Unity `Bus_001.prefab`, `Van_001.prefab`, and `Car_001.prefab`: color variants use the shared Car_0307/Idle color textures without material UV offset.
- Updated web vehicle and passenger materials to sample a fixed upper-left swatch from each Unity color texture instead of using the full character texture UVs.
- Updated fallback color constants to match the sampled Unity swatch pixels.
- Verification: `node --check src/scene-view.js`, `node --check src/level-data.js`, and `node --check test/game-model.test.js` passed. `node --test test/game-model.test.js` was blocked by the sandbox `spawn EPERM`; escalation could not be approved by the auto-review service.
## 2026-07-06 Effect_Ribbon movement tuning

- Added explicit movement controls for Effect_Ribbon child particles in src/vehicle-effects.js:
  - ParticleRibbon speedOverLifetime and moveRange.
  - ParticleSmoke speedOverLifetime and moveRange.
- Runtime update now samples each particle's speed curve over normalized lifetime instead of using only a generic drag multiplier.
- Particle positions are clamped to their configured moveRange from spawn origin, giving a tunable movement envelope for Unity parity.
- Verification:
  - npm.cmd test: 30 passed.
  - npm.cmd run build: passed; Vite still reports the existing >500 kB chunk warning.

## 2026-07-06 Effect_Ribbon departure effect

- Updated the vehicle departure Effect_Ribbon implementation in src/vehicle-effects.js.
- Effect_Ribbon now explicitly models its two child particles:
  - ParticleRibbon: uses Ribbon_01 as a 3x3 atlas and cycles the 9 frames per burst.
  - ParticleSmoke: uses Smoke_08 as the smoke particle texture.
- Split particle config fields for the restored items:
  - initialSize
  - fadeOutSpeed
  - sizeOverLifetime
- Verification:
  - npm.cmd test: 29 passed.
  - npm.cmd run build: passed; Vite still reports the existing >500 kB chunk warning.
## 2026-07-06 Vehicle path preview and shape controls

- Added SCENE_TUNING.vehiclePath as the single tuning entry for click-to-station vehicle path debugging and shape control.
- Scene editor now exposes ��������ʻ·���� controls:
  - show/hide path
  - show blocked vehicles
  - line height, opacity, and width
  - turn radius
  - in/out turn controller lengths
  - parking rectangle minX/maxX/minZ/maxZ
- BusLoopGame click-to-station motion and SceneView path preview both read the same vehiclePath tuning, so visualized paths match the route actually used by vehicles.
- This only targets the player-clicked parking-area-to-station path. The full-vehicle station departure path remains on its separate approach/back-out logic.
- Verification: pnpm test passed 31/31; pnpm run build passed with the existing Vite large chunk warning.

## 2026-07-06 Vehicle path preview black-screen fix

- Fixed a startup black screen caused by the new vehicle path preview cleanup running before SceneView initialized its vehiclePathLines array.
- SceneView now initializes vehiclePathLines, lastSnapshot, and lastGame in the constructor before applyTuning runs.
- Verification: node --check src/scene-view.js passed; pnpm test passed 32/32; pnpm run build passed with the existing Vite large chunk warning.

## 2026-07-07 Unity conveyor initial-fill parity

- Compared Unity ConveyorBelt.cs, ConveyorBeltPath.cs, and PassengerQueue.cs against the web queue-to-belt fill sequence.
- Updated web conveyor progress to use actual spline path length and Unity speeds instead of the old hardcoded percent step.
- Added queue-head readiness and initial-fill entry clamp behavior so empty belt slots wait at the entrance until the next queue passenger reaches the head.
- SceneView now exposes current conveyor path length to BusLoopGame, keeping editor curve scale changes synced to model speed.
- Verification: node checks passed for touched files; elevated targeted queue/conveyor tests passed. Full test/game-model.test.js still has unrelated existing vehicle blocker expectation failures around querying blockers while a vehicle is colliding; build verification was blocked because elevated execution was rejected by the current Codex usage limit.
