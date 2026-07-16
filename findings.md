# Findings

## Configurable Success Redirect - 2026-07-15

### Real-device failure comparison

- Exact comparison against `before-second-playable-20260709-153725/applovin-index.html` found no missing gate step: both versions de-duplicate vehicle IDs, increment after `game.clickVehicle(...)` returns `ok`, call `InstallFullGame()` on the threshold-reaching operation, count arrived vehicle states as a fallback, reset the gate, and intercept later canvas presses while finished.
- The intended difference is only the threshold source: old `Au=10` versus current `SCENE_TUNING.installGate.successfulOperationThreshold` defaulting to 40.
- `openStore()` is also structurally unchanged: both versions call only `window.mraid.open(url)` and have no browser fallback, so the next comparison boundary is whether the current vehicle callback still executes synchronously inside a platform-recognized pointer event.
- `artifacts/applovin` currently contains two distinct packages: stale `Bus Fever - Car Jam Escape Playable_applovin_Hard.html` from 2026-07-09 (3,293,249 bytes, SHA256 `7ED436...B392C1B7`) and current `index.html` from 2026-07-15 (3,630,878 bytes, SHA256 `CD8648...ABC8AE6`). The uploaded filename/hash must be confirmed during retest.
- Fixed-index extraction confirmed the supplied working backup and current `index.html` both contain the same active `clickVehicle -> ok -> unique count -> threshold -> InstallFullGame` chain and the same finished-state canvas interception. No logical gate step is missing from current `index.html`.
- The stale `Bus Fever - Car Jam Escape Playable_applovin_Hard.html` does not contain the active `?.ok&&...` success-gate chain, despite still containing `mraid.open`. Uploading that descriptive filename would reproduce “CTA bridge exists but the 40-success redirect never fires.”
- A 50-seed model diagnostic on the current level13 + DualQueue3 content reached 40 or more successes on stronger play paths (best 45) but lost as early as 5 on poor paths. Threshold 40 is technically reachable but close to the level's practical deadlock boundary, unlike the working backup's threshold 10.
- Old and current audio `unlock()` implementations are equivalent, including `AudioContext` creation/resume and preload ordering, so no new audio dependency omission was found before `mraid.open()`.
- Current SceneView and the working backup both synchronously invoke the vehicle callback from a canvas `pointerup`; no user-gesture timing regression was found.
- The newer game-over overlay does cover the canvas, unlike the older end panel behavior, but the active success-click gate calls the store before that overlay path. It is only relevant if the threshold is reached through the asynchronous arrived-state fallback and the following tap lands on the overlay.
- Final-package browser instrumentation used a temporary copy with threshold 1 and a recording MRAID stub. A real canvas click at vehicle 130's projected center produced `GATE_DIAG 1 1 true` and `MRAID_OPEN https://play.google.com/store/apps/details?id=gridplus.busjam.carpuzzle` in the same millisecond.
- The first visual click landed under the animated guide-hand offset and correctly logged `GATE_REJECT blocked`; computing the actual vehicle-center projection was necessary to trigger the valid operation. This demonstrates why visually counted taps can exceed the internal `ok` count.
- Current `index.html` therefore reaches and invokes `mraid.open()` when its internal successful-operation count reaches the threshold. Remaining real-device hypotheses are (1) fewer than 40 actual `ok` operations or (2) the device/platform MRAID bridge rejecting/ignoring the call.

- The supplied backup AppLovin package used `Au=10` and called `InstallFullGame()` on the same successful vehicle click that raised the unique count to the threshold; later canvas clicks also reopened the store while the finished gate remained active.
- Current `src/main.js` retained the same unique-vehicle counter and parked-state fallback, but disabled both entry paths. Restoring those existing paths preserves the prior semantics without introducing another gameplay counter.
- The threshold now lives at `SCENE_TUNING.installGate.successfulOperationThreshold`, defaults to `40`, is normalized to an integer of at least one at runtime, and is exposed in the editor as a 1-200 whole-number control.
- `src/scene-tuning.js` and `artifacts/scene-tuning.json` are synchronized so later editor export/apply/package cycles retain the default.
- The final level13 AppLovin artifact is 3,630,878 bytes and contains both `installGate:{successfulOperationThreshold:40}` and an enabled same-click successful-operation redirect.

## Imported Levels And Collision Parity - 2026-07-15

- The referenced demo worktree is clean; its collision parity implementation is committed source, centered on `src/vehicle-collision.js` plus small `BusLoopGame` integration changes and focused `test/vehicle-collision.test.js` coverage.
- Before this change, the playable used static depth chains for dispatch. Runtime dispatch now uses the demo geometry graph; vehicleDepthes remains provenance/debug evidence.
- All five supplied Unity assets are readable YAML and share `GameSceneDualQueue2`. Each contains complete vehicles, a ground container, legacy `vehicleDepthes`, and `fixedPassengerSequence` entries carrying both `queueId` and `colorIndex`; level10 also contains vehicle anchor metadata that is outside the current base playable mechanics.
- Full-level switching is structurally different from the existing conveyor-prefab switch: it must replace vehicles and both authored passenger queues together, then rebuild the game/view runtime.
- To satisfy single-level delivery, the all-level catalog must remain development-only. Production should import a generated active-level module containing one selected payload; the editor catalog can stay behind the existing Vite development-only dynamic editor import.
- Extracted totals: level5 has 61 vehicles and queues 202+202; level8 38 and 140+140; level9 37 and 131+131; level10 64 and 218+218; level13 75 and 202+202. Every per-color passenger total matches vehicle seats.
- The production default is level5. Editor selection writes `artifacts/selected-level.txt` and reloads the runtime; exported/applied tuning synchronizes the same marker, and prebuild emits only that payload.
- Legacy currentLevel12 remains internal template data but is excluded from editor options because its manually altered spacing does not produce a viable geometry graph.
- Focused level/collision tests pass 9/9. Vite build and AppLovin checks pass; the 3,627,325-byte package contains only level5.asset.
- Browser QA switched level5 -> level8 -> level5 successfully with no error-level console messages.
- Broader test/game-model.test.js: 27 passed / 8 failed. The remaining failures are existing stale parking-count, queue, texture-dimension, and path-tuning expectations; updated collision tests pass.

## DualQueue B-Spline Turn Fix - 2026-07-15

- The active defect is a continuation of the multi-conveyor feature: DualQueue3/10 Unity prefabs use closed Dreamteck B-splines, while the web renderer currently treats all generated control points as closed Catmull-Rom curves.
- Preserve the four-passenger group structure and shared tangent rotation; the path interpolation type is the confirmed parity gap.
- The workspace is not recognized as a Git repository, matching the previously recorded limitation. Avoid Git-dependent diff/recovery steps and verify touched files directly.
- The extractor already merges arbitrary prefab property maps for direct and nested layouts; `splineType` can be read from `_spline.type` on the same merged conveyor-role properties used by `extractPoints`.
- `SceneView.buildPathCurves()` is the single closed-conveyor construction point and currently hardcodes `THREE.CatmullRomCurve3`; open queue paths should remain on their existing Catmull-Rom path.
- `scene-layout.js` is dependency-free pure math and is the right unit-test boundary for a Dreamteck B-spline point sampler; `scene-view.js` can adapt its `{x,y,z}` result into `THREE.Vector3`.
- Targeted prefab inspection shows the final closed conveyor types are all `BSpline` (`1`), but through distinct authored values: DualQueue2/3/10 set the conveyor spline to `1` directly, while DualQueue5 overrides ConveyorBelt6's base conveyor value `0` to `1`. Extraction must therefore read the merged role properties rather than hardcode a shared type.
- The installed Dreamteck source at `Assets/Plugins/Dreamteck/Splines/Core/Spline.cs` uses plus signs for both nested polynomial terms and the constant term in `CalculateBSplinePosition`; this differs from the minus signs in the handoff transcription. Implement against the actual source formula.
- Closed Dreamteck evaluation uses `doubleIndex = pointCount * progress`, `fromIndex = floor(doubleIndex)` (clamped to the last point at progress `1`), local `t = doubleIndex - fromIndex`, and control points `(i-1, i, i+1, i+2)` wrapped modulo the point count.

## Multi-Conveyor Layout Work - 2026-07-14

- The active level identifies itself as `GameSceneDualQueue2`; runtime conveyor speed uses the actual rendered curve length returned by `SceneView`, so switching the renderer curve can preserve distance-based passenger speed if queue initialization is rerun.
- Current ownership is split across `src/level-data.js` (authored conveyor/queue points and gameplay constants), `src/scene-view.js` (Three.js curves and art), `src/scene-tuning.js`/`src/scene-editor.js` (editable tuning), and `src/main.js` (reinitializes queues after full tuning changes).
- The repository does not contain the requested Unity prefab files. It currently contains only the DualQueue2-derived `Loop_02.png` plus extracted spline/queue data, so layouts 3/5/10 must be read from the original Unity project rather than approximated.
- Broad text search touched generated AppLovin artifacts and produced excessive output. Further searches must explicitly exclude `artifacts`, `dist`, `node_modules`, and archive files.
- The original Unity source is available at `D:\UnityProjects\BusLoop`. All four requested prefabs exist under `Assets/BusJam/Game/Bundleables/Prefabs`; layouts 2, 3, and 10 are about 1.02 MB each, while layout 5 is about 276 KB.
- Each target prefab contains Dreamteck `_spline.points` overrides. DualQueue2 visibly binds `Loop_Road_02`, `Left_Road_02`, and `Right_Road_02` sprites; the remaining layout-specific sprite GUIDs/names and spline groups still need structured extraction from the prefab modification lists.
- Unity-authored capacities differ by layout: DualQueue2 uses conveyor 32 / queues 24+24; DualQueue3 uses conveyor 36 / queues 22+22; DualQueue10 uses conveyor 38 / queues 26+26. Layout 3 uses `Loop/Loop_Road/Left_Road/Right_Road_03`; layout 10 uses the corresponding `_04` assets.
- `GameSceneDualQueue5.prefab` is structurally different and much smaller: it instantiates the conveyor/queue visual objects as nested prefabs and overrides their splines rather than serializing the objects inline. Its direct scene component exposes one `passengerQueue` and one `conveyorBelt` reference, so its referenced prefab GUIDs must be resolved before deciding whether it is genuinely dual-entry at runtime.
- Layout 5's conveyor source GUID resolves to `Assets/BusJam/Game/Bundleables/Prefabs/ConveyorBelt6.prefab`; its other resolved nested prefabs are background/sky/parking/shadow visuals.
- Layout 3 art resolves to `Textures/Car_0307/Loop_03.png` plus `Sprites/Loop_Road_03.png`, `Left_Road_03.png`, and `Right_Road_03.png`. Layout 10 uses the same `_04` asset family. These are real source files suitable for copying into `public/assets`.
- `ConveyorBelt6.prefab` is a true dual-entry layout despite the outer `GameSceneDualQueue5` exposing singular references: it contains `PassengerQueueDual6`, queue capacities 26+26, conveyor capacity 31, exit range about 0.615-0.795, and `_06` loop/road sprites. The scene prefab applies additional overrides to this nested layout.
- The current web renderer builds both the closed belt and open queue curves from `LEVEL_1`, applies global path tuning plus separate curve tuning, and reuses one `loopPlane`. Supporting layout switching therefore needs a catalog consumed by `SceneView`, a texture swap on that plane, and layout-aware game constants (`capacity`, entry percents, exit range) rather than only changing the image.
- DualQueue5's outer overrides target spline component file IDs inside `ConveyorBelt6.prefab` (GUID `e138...`). Many overridden points only change X while inheriting Y/Z from ConveyorBelt6, so its final authored geometry must be computed by merging the base ConveyorBelt6 spline with the scene-level overrides.
- The extraction approach will be reproducible: classify spline components through each prefab's `conveyorSpline`/`queueSpline` references and stripped-object source mapping, then merge nested prefab overrides for DualQueue5. This avoids relying on approximate visual tracing.
- The `_03`, `_04`, and `_06` loop textures are all 2100x1300. Their authored sprite crops are respectively `(0,56,2100,1244)`, `(0,57,2100,1243)`, and `(0,58,2100,1242)`, matching the existing `_02` crop pattern.
- Web curve conversion mirrors Unity Z around `SCENE_TUNING.path.centerZ`, then applies global path scale/offset and per-curve coordinate transforms. Layout-specific tuning can reuse this pipeline without rewriting passenger animation logic.
- The new extractor successfully reconstructs every requested layout as a 19-point closed conveyor spline plus two 20-point queue splines. DualQueue2 output structurally matches the existing web data.
- Final Unity layout constants from extraction: DualQueue2 `32 / 24+24 / exit 0.605-0.78`; DualQueue3 `36 / 22+22 / exit 0.625-0.77`; DualQueue5 (ConveyorBelt6) `31 / 26+26 / exit 0.615-0.795`; DualQueue10 `38 / 26+26 / exit 0.635-0.77`.
- `scripts/extract-unity-conveyor-layouts.mjs` now provides a repeatable prefab-to-JSON path and correctly merges the nested DualQueue5 overrides. The generated inspection artifact is `artifacts/unity-conveyor-layouts.json`.
- Layout switching cannot stay renderer-only: `BusLoopGame` currently reads conveyor capacity, queue capacity, entry percents, and exit range directly from immutable `LEVEL_1`. These need instance-level runtime configuration supplied by the selected layout.
- `SceneView` currently allocates exactly 32 conveyor passenger views and 24 queue views per side. It must allocate catalog maxima (38 conveyor, 26 queue) so editor switching never addresses missing visual groups.
- Entry percents can be computed from the rendered curves by finding the closest closed-curve progress to each queue head. Passing those values into the game model keeps passenger entry aligned with authored trajectories and remains correct if curve tuning changes.
- Runtime tuning should treat a layout selection as a structural change: resize/reset the game belt and queues, then reinitialize with the selected capacity, computed entry percents, actual curve lengths, and layout exit range. Ordinary visual tuning can keep the existing lighter reinitialization path.
- The source loop PNGs are 1.2-1.36 MB each, while the current Loop_02 q80 WebP is only 43 KB. Pillow 12.1 is available, so importing the three extra shapes as q80 WebP assets will keep the playable package impact small.
- Generated `src/conveyor-layouts.js` now holds the four prefab-derived catalogs plus maximum capacities and lookup helpers. The four q80 WebP loop assets total about 238 KB, with each file between 43 KB and 68 KB.
- `scene-editor.js` already supports string-valued select options and has a visibility-refresh pattern for passenger material controls. The conveyor UI can reuse both: one layout selector plus four layout-specific tuning sections that only show the selected layout's fields.
- `SCENE_TUNING` now has independent `art`, closed-curve, and two queue-curve transforms for each of the four layout IDs, while retaining the legacy top-level DualQueue2 fields for exported-tuning compatibility.
- The existing regression suite contains source-contract assertions for editor fields and the old single `initializeQueues(...)` call. Those assertions must be updated alongside behavioral catalog/model tests so they validate the new selector, layout visibility, runtime config handoff, and SceneView catalog usage.
- Unity's queue `conveyorBeltIndex` ordering is opposite the current web `queuePaths` order for DualQueue2. The web convention is queue 0 = left/negative-X entry and queue 1 = right/positive-X entry; extracted layouts must normalize by queue-head X to preserve passenger sequence ownership.
- After left-to-right normalization and regeneration, the catalog exactly matches existing DualQueue2 closed/queue points, and focused tests pass for all requested IDs/assets, runtime capacity/entry/exit configuration, and editor-renderer-main wiring.
- Required Vite production build passes; output includes the existing >500 kB chunk warning. The in-app browser QA path is blocked by the bundled browser client's `process` redefinition error, so visible editor switching still needs a manual browser pass.
- Legacy v3/local exported tuning did not contain `conveyorLayouts`. Main-thread loading and `scripts/apply-scene-tuning.mjs` now copy old `conveyorArt`, `conveyorCurve`, and `queueCurves` into `dualQueue2`, preserving existing tuning during migration.

## Current Durable Findings - 2026-07-08

### Active Level Layout

- The playable now targets imported level12-style data for `GameSceneDualQueue2` rather than the original 6-vehicle level1 prototype.
- Active data has 94 visible vehicles, two fixed queues with 219 groups each, and authored `vehicleDepthes` blocker data for 90 vehicles.
- Vehicle seat totals match fixed passenger queue totals by color. Initial movable vehicles are `1, 4, 34, 51`.
- As of the latest queue-0 variant, fixed queue lengths are `[257, 181]` for 438 passengers; passenger color totals match vehicle seats by color.

### Conveyor / Passenger Entry Parity

- Unity conveyor progress is based on actual spline path length: initial fill uses passenger speed, normal belt motion uses conveyor speed, both divided by spline length.
- Unity queue supply waits until the queue head is ready. During initial fill, empty belt slots clamp just before the entry with `InitialEntryOffsetPercent = 0.0001` until a passenger can enter.
- Web should reuse the full queue-entry visual path for both initial-fill and later refill groups.
- Game Over should not trigger merely when parking spots are reserved. It waits until every occupied parking spot's vehicle is actually `at-spot`, the conveyor has no empty slots, no belt passenger can eventually board, and that condition persists for the configurable `gameOver.failureDelaySeconds` delay.

### Vehicle / Passenger Materials

- Vehicle prefabs use full Unity color atlases; authored model UVs should remain active for window/light/body regions.
- Passenger prefabs are color-specific materials/textures rather than simple runtime swatches. Unity materials combine `_MainTex`, `_BaseCol`, and `_EmissionCol` through `AnimSimpleLit`.
- Current web tuning exposes passenger material color/brightness controls for parity adjustment.

### Effects / Audio / Shadows

- Effect_Hit uses ParticleHit_2/Circle_01_Add, ParticleHit_1/Round_02_Add, and ParticleHit/Round_01_Add at vehicle collision contact.
- Effect_SmokeTrail uses ParticleTrail/Round_01_Alp as a looping moving-vehicle trail.
- Core audio clips are wired for collision, passenger boarding, and full-vehicle departure.
- Real-time Three.js shadow maps were removed after experimentation; authored fake shadows are the active shadow layer.

### AppLovin Packaging

- When inserting large inlined JS/CSS strings into HTML, use function replacers with `String.replace`; plain replacement strings interpret minified `$&` sequences and can inject the matched `</head>` text into the bundle, causing `SyntaxError: Unexpected token '<'` and a loading screen stuck at 0%.
- Editor tuning saved in browser `localStorage` is not a delivery artifact. Before AppLovin packaging, export the tuning JSON and apply it into `src/scene-tuning.js`; the AppLovin single HTML should not include the scene editor UI or editor code.
- Production/AppLovin runtime must not restore editor tuning from `localStorage`; stale platform-preview storage can override newly baked camera/CTA adaptation values and make repeated package changes appear unchanged on device.
- iOS AppLovin store jumps should use `itms-apps://itunes.apple.com/app/id6746743297` as the first MRAID URL, with the `https://apps.apple.com/app/id6746743297` link retained as a fallback. The static AppLovin checker now verifies the direct iOS scheme is present.
- AppLovin single HTML must include the `data:` URL `fetch` compatibility layer for inlined `application/octet-stream` model/VAT assets, and store jumps should remain MRAID-only with no browser `window.open` fallback.
- The 10-vehicle install gate must fire from a successful vehicle dispatch user gesture on real devices; waiting until an asynchronous arrival/frame update can lose the MRAID-open gesture context.

### Camera / Screen Adaptation

- Current trial design-cover behavior is fixed visible height: `camera.fitHeight` remains the vertical visible height across viewport aspects. With `fitHeight: 14.9`, short/wide screens keep visible height 14.9 and only reveal more horizontal content.
- The phone preview frame is an editor-only tool. Production/AppLovin must not add `is-phone-preview`, otherwise CSS can force the stage back to the 1080x2160 design aspect and prevent camera adaptation from seeing the real device/container aspect.

### Vehicle Arrow / Motion

- Bus prefab hierarchy treats Arrow as part of the vehicle visual. Web hit clips should move the vehicle model and arrow under one shared hit root.
- Arrow outline parity is approximated with a dark outline layer behind the white Arrow_01 geometry.
- Authored `vehicleDepthes` remains the blocker/unlock source, but blocked-click hit animations should prefer a nearby directly overlapping visual blocker when one exists; bus 49 should collide with bus 63 rather than indirect depth candidates such as bus 50.

## Archive

Full detailed 2026-07-07 findings were archived to:

- `docs/project/archive/findings.full-2026-07-08.md`
