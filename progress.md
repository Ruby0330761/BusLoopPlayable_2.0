# Progress

## 2026-07-16 DualQueue3 Trajectory Package Refresh

- Started a package refresh from the supplied DualQueue3 trajectory screenshot.
- Confirmed the selected layout was DualQueue3 but its stored per-layout curve values were stale. Updated the exported tuning to closed `0/0.85/0.75/0.80`, entry 1 `0.60/0.95`, and entry 2 `-0.60/1.00`.
- Applied the corrected tuning to source; direct config verification confirms Level7, DualQueue3, and all eight screenshot values.

## 2026-07-16 Current Editor Tuning AppLovin Rebuild

- Started the requested production refresh from the parameters currently active in the web editor.
- Packaging route confirmed: export editor tuning to `artifacts/scene-tuning.json`, run `apply:tuning`, build the selected single-level payload, generate `artifacts/applovin/index.html`, then run the AppLovin static checker.
- Current phase: capture the editor's live tuning and selected level before applying or building.
- The initial automated form capture was stale and is superseded by the complete runtime JSON supplied by the user.
- Applied the authoritative `level7` + `dualQueue3` tuning to `artifacts/scene-tuning.json` and `src/scene-tuning.js`; the durable selected-level marker is now `level7`.
- Key baked values: install threshold 20, six parking spots, vehicle-area scale 0.84, guide hand vehicle 89 with offset X 0.25/start X 0.62, and a 3-second mask with padding 15 and highlight scale 0.62 x 0.62.
- First focused run passed 12/13; the only failure was the expected stale generated active module (`level9` versus the new `level7` marker). Explicit Level7 generation is required before the rerun/build.
- Regenerated the Level7-only active module (83 vehicles, queues 368+278). Focused guide/catalog/collision tests pass 13/13.
- Production build passed; Vite emitted only the existing chunk-size warning for the 733.32 kB minified JS chunk.
- Generated `artifacts/applovin/index.html` at 3,639,703 bytes (3.471 MiB); all AppLovin static checks passed.
- Final package marker scan confirms only `level7.asset`, selected `dualQueue3`, install threshold 20, guide vehicle 89/right-to-left offset 0.62, and the 3-second mask/highlight settings. SHA-256: `1AEC67487626C7E73EBB07DE00967344FA0EE6F47BCE61042274ECD8DD03DA5C`.
- Automated final `file://` runtime QA was blocked by browser URL policy. No workaround was used; AppLovin preview/upload play remains the required external manual validation.
- Packaging task complete: final artifact is `artifacts/applovin/index.html`.

## 2026-07-16 Vehicle 89 Timed Guide Mask

- Bound `vehicleGuideHand.vehicleId` to 89 in source and exported tuning.
- Added `firstClickGuide` tuning: enabled, vehicle id, duration seconds, mask opacity, padding, and highlight width/height scale.
- Implemented the mask as four DOM pieces around the target vehicle projection, with pointer events disabled so other vehicles remain operable during the timed overlay.
- Rendered the timed guide hand as a DOM image above the mask, mirrored its visual, and hides it together with the timed mask.
- Adjusted the approach to start on the right and move left toward vehicle 89 while scaling down.
- Added a one-time local editor tuning migration from the old vehicle `1`, base X `-0.38`, and start X `-0.62` defaults to the current vehicle `89` guide settings.
- Removed the interrupted `guide-locked` click restriction from `src/main.js`.
- Verification: syntax checks for touched JS files and focused `test/guide-hand.test.js` passed. Build/package intentionally skipped by request.

## 2026-07-16 Level7 vehicle/queue import

- Follow-up: change vehicle 89 to color 2 and replace the Level7 right passenger queue with the revised user sequence; validation is in progress.
- Confirmed vehicle 89 is a 10-seat color-5 vehicle; the revised right queue stays at 278 entries and replaces exactly ten color-5 passengers with color 2, preserving every per-color seat total.
- Updated the extractor's general vehicle override map so Level7 vehicle 89 becomes color 2, replaced the exact right-queue run data, and extended the regression assertion.
- Touched-file syntax checks passed and Level7 extraction regenerated all outputs successfully with 83 vehicles and 368+278 queues.
- First focused run passed the new Level7 vehicle/queue assertion but failed only because active Level7 did not match the current durable Level9 selection; resynchronizing outputs to Level9 without changing the Level7 catalog data.
- Resynchronized generated active/artifact selection to Level9. Focused tests pass 12/12 and direct Level7 checks confirm vehicle 89 color 2 plus exact revised right-queue and seat/passenger parity.
- Production build passed with current Level9 selection and only the existing chunk-size warning; project progress and navigation now record the generalized vehicle/queue override behavior.
- Started importing `D:\UnityProjects\BusLoop\Assets\BusJam\Game\Bundleables\Level_Escape_C\level7.asset` with user-supplied left/right passenger queues.
- Next: validate vehicle seat/color totals against both queues, then extend the extractor/catalog and targeted tests.
- Validated 83 vehicles/646 seats; the supplied left/right queues are 368+278 and match all per-color seat totals exactly.
- Added Level7 to the default extraction sources, encoded the exact supplied queue order as a durable override, and added queue-order/catalog expectations.
- Switched the durable active selection to Level7; syntax checks passed and extraction regenerated the catalog/artifact plus Level7-only active module (83 vehicles, queues 368+278).
- Catalog/collision tests pass 12/12; direct verification confirms exact per-color queue totals, Level7 active selection, and zero initial vehicle-body overlaps. Production build remains.
- Production build passed and regenerated the Level7 active payload; Vite emitted only the existing >500 kB chunk warning. Project progress and code navigation were updated for the sixth imported level.

## 2026-07-16 Level8/Level9 collision-size parity

- Reproduced 22 initial OBB overlaps in Level8 and 21 in Level9 with the current generated sizes.
- Confirmed Unity gameplay uses centered `BusJamConfig.asset` sizes (`4: 0.27 x 0.47157902`, `6: 0.27 x 0.486`, `10: 0.27 x 0.6785897`); these remove all initial overlaps in all five imported levels.
- Updated the Unity level extractor constants and added a focused Level8/Level9 no-overlap regression; generated data and verification are next.
- Syntax checks passed, and the extractor regenerated `artifacts/unity-levels.json`, `src/level-catalog.js`, and the selected Level9 `src/generated-active-level.js` from the five supplied assets.
- Focused catalog/collision tests pass 11/11; stale collision lengths are absent from the extractor and generated files. Full build/package was intentionally skipped for this data-only correction.

## 2026-07-15 Real-device Store Redirect Failure

- User reported that the threshold redirect did not open the store during real-device testing.
- Reopened the task as a platform-path defect; static package checks are no longer considered sufficient evidence for this behavior.
- Next: verify threshold reachability and platform bridge/user-gesture behavior in the final artifact, then harden and repackage.
- Exact old/new comparison found no missing gate step in current `index.html`; pointerup timing, success counting, same-operation redirect, finished-state interception, and `mraid.open` match the working backup.
- Found a stale descriptive `..._Hard.html` beside the current package; it lacks the active successful-operation gate and is the leading upload-file mismatch candidate.
- Current level13 model can exceed 40 successes (best diagnostic run 45) but many play paths deadlock earlier, so a real-device retest must confirm both the uploaded hash and the observed counter path.
- Audio unlock and SceneView pointer timing match the working backup; current Axon/AppLovin guidance still requires direct `mraid.open()` click-through.
- Comparison phase is complete. The next code/package action depends on whether the uploaded file was current `index.html` (`CD8648...`) or stale `..._Hard.html` (`7ED436...`).
- User confirmed the uploaded artifact was current `index.html`; proceeding with final-package runtime instrumentation rather than artifact-sync changes.
- Browser-controlled final-package instrumentation passed: with threshold 1, a real successful canvas click logged count `1/1`, finished `true`, and an immediate Android `mraid.open` call.
- No source/package edit has been made from this diagnostic yet. Device OS and visible internal count/bridge evidence are now required to choose between a count-observability fix and a platform-specific store URL/bridge fix.

## 2026-07-15 Configurable Success Redirect

- Recovered the exact old package behavior: count unique successful vehicle operations and open the store on the threshold-reaching operation.
- Restored the disabled gate in `src/main.js`, replaced the hardcoded threshold with `installGate.successfulOperationThreshold`, and set the default to 40.
- Added the web editor control under `商店跳转`, synchronized `artifacts/scene-tuning.json`, and updated focused source/tuning regressions.
- Syntax and JSON parsing checks pass; focused tests and AppLovin rebuild are next.
- Focused main-thread and independent success-redirect regressions pass 2/2. The broader editor contract still stops at its recorded unrelated `65536 !== 2100` background-size expectation.
- `npm.cmd run build`, `npm.cmd run package:applovin`, and `npm.cmd run check:applovin` passed; the selected level13 package is 3,630,878 bytes.
- Final package inspection confirmed the baked threshold 40 and an enabled same-click success redirect. The requested implementation and repackaging are complete.

## 2026-07-15 Vehicle 130 Collision Nudge

- Nudged level13 vehicle 130 from `z 1.2969986` to `z 1.3369986`, clearing its direct collision overlap with vehicle 135.
- Persisted the same override in `scripts/extract-unity-levels.mjs`, `src/level-catalog.js`, `src/generated-active-level.js`, and `artifacts/unity-levels.json`.
- Added a focused level-catalog regression confirming 130 and 135 no longer overlap and 130 has no blockers.
- Rebuilt the selected level13 production bundle and regenerated `artifacts/applovin/index.html` at 3,630,407 bytes.
- Verification passed: syntax checks, focused level catalog tests 4/4, direct model click check, Vite build, AppLovin package check, and final package string checks.

## 2026-07-15 DualQueue3 Trajectory Package Refresh

- Switched the active conveyor layout to `dualQueue3`.
- Applied the screenshot passenger trajectory values to `dualQueue3`: closed curve `0, 0.85, 0.75, 0.80`; entry 1 `0.60, 0.95`; entry 2 `-0.60, 1.00`.
- Synced `src/scene-tuning.js` and `artifacts/scene-tuning.json`.
- Rebuilt the selected level13 production bundle and regenerated `artifacts/applovin/index.html` at 3,630,407 bytes.
- Verification passed: syntax/JSON import checks, Vite build, AppLovin package check, and final package string checks.

## 2026-07-15 Vehicle 130 Guide Hand Mirror

- Bound the guide hand to vehicle 130 and horizontally mirrored both the texture UV and the static/approach X offsets.
- Synced source and exported scene tuning so later `apply:tuning` runs preserve the target and motion direction.
- Focused guide-hand plus level/collision tests passed 10/10; Vite build and AppLovin checks passed.
- Browser QA on selected level13 confirmed the hand renders on vehicle 130, animates, and produces no console errors.
- Regenerated the level13-only AppLovin package at 3,630,406 bytes.

## 2026-07-15 Imported Levels And Collision Parity

- Imported and validated level5/8/9/10/13 with their paired queues.
- Added geometry-driven collision parity, editor full-level selection, and single-level prebuild generation.
- Focused tests 9/9 and syntax checks passed. Broader game-model tests: 27 passed / 8 known stale expectations failed.
- Vite build passed with the existing chunk warning. AppLovin package/check passed at 3,627,325 bytes; content scan found only level5.asset.
- Browser QA switched level5 -> level8 -> level5 with no console errors; the durable editor selection endpoint also switched the build marker to level8 and restored level5.

## 2026-07-15 DualQueue B-Spline Turn Fix

- Resumed after an interrupted turn; no source changes had been made.
- Switched the active plan to spline-type extraction and Dreamteck closed B-spline evaluation for the DualQueue3/10 turn-clipping defect.
- Restored the project navigation and prior multi-layout context. The workspace still has no usable Git repository metadata, so verification will rely on exact file inspection and automated checks.
- Next: inspect the mapped extractor/catalog/renderer/layout-test files and confirm how nested prefab overrides should supply `_spline.type`.
- Added `_spline.type` extraction from the same merged conveyor properties used for point extraction and mapped the Dreamteck enum to `catmullRom`, `bSpline`, `bezier`, or `linear`.
- Regenerated `src/conveyor-layouts.js` and `artifacts/unity-conveyor-layouts.json`; all four authored closed conveyors independently resolve to `bSpline`. Extractor and generated-module syntax checks passed.
- Added a pure Dreamteck closed B-spline evaluator to `src/scene-layout.js`, including Unity's closed segment mapping and modulo-wrapped control points.
- Added `DreamteckClosedBSplineCurve3` and `makeClosedConveyorCurve` in `src/scene-view.js`; selected layouts now dispatch on `layout.splineType`, while open queue curves retain their prior Catmull-Rom behavior. Both source files pass `node --check`.
- Added pure-math formula and closed-boundary tests, catalog spline-type assertions, source wiring checks, and an actual Three.js factory dispatch test.
- Focused verification passes: all 12 `scene-layout` tests and all 3 conveyor catalog/factory/wiring tests. A full `game-model` run retains 9 pre-existing unrelated failures already represented by current tuning/game-state mismatches.

## 2026-07-14 Multi-Conveyor Layout Feature

- Switched the active plan to editor-selectable conveyor layouts from `GameSceneDualQueue2/3/5/10` with independent offsets and matching passenger paths.
- Restored the existing planning/project navigation context and identified the initial runtime/editor ownership boundaries.
- Next: locate prefab-derived spline and conveyor-art evidence for layouts 3, 5, and 10, then define the normalized layout catalog.
- Located the original source prefabs in `D:\UnityProjects\BusLoop\Assets\BusJam\Game\Bundleables\Prefabs` and confirmed all requested files include authored spline overrides.
- Extracted the first layout-specific facts: DualQueue3 uses `_03` road art with 36 conveyor slots; DualQueue10 uses `_04` road art with 38 slots; DualQueue5 is composed from nested conveyor/queue prefabs and needs GUID resolution.
- Added and ran `scripts/extract-unity-conveyor-layouts.mjs`; it generated complete normalized data for all four requested layouts and verified their spline/queue point counts.
- Phase 1 is complete. Phase 2 is integrating the generated catalog and layout-aware runtime constants.
- Generated `src/conveyor-layouts.js` and imported compressed loop assets under `public/assets/unity/conveyors`; syntax checks passed for the extractor and generated module.
- Added four independent layout tuning records and a selected-layout value to `src/scene-tuning.js`.
- Wired the selected catalog into `SceneView`, added texture caching/switching and catalog-max passenger pools, made `BusLoopGame` accept layout runtime constants, and routed main/editor reinitialization through the selected layout config.
- Normalized queue IDs left-to-right, regenerated the catalog, and passed 3 focused multi-conveyor regressions. Implementation phases 2-4 are complete; verification/documentation is in progress.
- Full Vite build passed after the known sandbox `spawn EPERM` retry. A broader focused gameplay run passed all new conveyor/default-dual-entry cases but retained two pre-existing 5-vs-6 parking-spot assertions. Browser automation could not start because the bundled Browser skill client fails while redefining `process`; visual switching QA is still manual.
- Final automated verification: 4 focused feature/migration tests passed; full suite finished at 44 passed / 10 pre-existing failures; Vite production build passed. Updated exported tuning, code navigation, resource status, project progress, and handoff notes.

## Current Status - 2026-07-08

Documentation was compacted after the 2026-07-07 workday. The active project state is now summarized in short files, and full 2026-07-07 logs were moved to `docs/project/archive/`.

## Current Runtime State

- Active playable uses imported level12-style data with 94 vehicles and two fixed passenger queues.
- Unity-style audio, vehicle effects, fake shadows, passenger material controls, vehicle arrow outline, and departure/count-board fixes are in place.
- Current follow-up is validation/stabilization, not new platform packaging.

## Verification State

No build was run during this documentation cleanup. Verification was limited to file inspection and size/content checks.


