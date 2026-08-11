# Progress

## 2026-08-11 Level10 guide-39 CTA package

- Started from the current planning files, project progress, code navigation, and AppLovin platform reference.
- Interpreted the request as Level10 production selection, both guide scopes targeting Level10 vehicle 39, CTA enabled, and successful-operation threshold 10; the current first-click mask enabled state will be preserved.
- Current work is verifying Level10 vehicle 39 and the exact source/exported/editor-cache/test ownership before editing.
- Confirmed the durable level marker is already Level10, while source/exported tuning remains Level16; CTA is already enabled and the remaining baked values are guides Level16/45 plus threshold 30.
- Identified the existing saved-default migration and focused guide/config/catalog tests that must be updated with the new package defaults.
- Confirmed Level10 vehicle 39 is a valid visible 6-seat target and mapped the exact five requested configuration areas.
- Phase 1 is complete; next is updating exported tuning, saved-cache migration, and focused expectations, then applying the export to source.
- Updated exported tuning, added the Level16/45/30 -> Level10/39/10 saved-default migration, synchronized paired tests, and applied the export to source.
- Structured verification confirms source/export/marker parity with CTA enabled and first-click mask still disabled; all touched JavaScript files pass syntax checks.
- Generated the Level10-only production payload and passed five focused guide/catalog/config regressions.
- Completed the production build with only the existing Vite chunk-size warning, generated the 3,972,962-byte AppLovin single HTML, and passed all 15 static checks.
- Final scans confirm Level10 only, vehicle 39 present, both guides on Level10/39, CTA enabled, threshold 10, and no Level16/Level9 payload.

## 2026-08-11 Sakura background packaging

- Started from the project progress, code navigation, resource status, and existing planning records.
- Identified the existing winter/summer editor selector and selected-background-only AppLovin result as the behavior to extend.
- Confirmed the source/editor/runtime/generated-manifest ownership and measured the supplied Sakura PNG at 1,976,289 bytes.
- Confirmed the editor/runtime selector is generic and the active-level generator serializes a single selected catalog manifest.
- Confirmed the apply step does not synchronize the catalog background, which can retain the summer fallback when another background is selected.
- Chosen implementation boundary: override each generated session level's `assets.background` from baked scene tuning, then add Sakura to the editor and focused packaging contracts.
- Generated and visually checked the 278,157-byte, 2100x3382 Sakura q60 JPEG while preserving the 1,976,289-byte source PNG.
- Added `BG01 \u6a31\u82b1` to the editor background selector without changing the current summer default.
- Updated active-level generation to validate the selected asset and overwrite every generated session level's background manifest with that one URL.
- Extended focused background and generator source-contract coverage.
- Syntax checks passed for the editor, generator, and both focused test files; the two targeted regressions pass 2/2.
- Temporarily selected Sakura, ran the full production build, generated the AppLovin HTML at 4,191,471 bytes, and passed all 15 static checks.
- Base64 fingerprint verification proved the Sakura validation package contained only the optimized Sakura background.
- Restored the summer default, rebuilt and regenerated the final AppLovin HTML at 3,972,231 bytes, passed all 15 checks, and confirmed only summer is embedded.
- Started the local editor at `http://127.0.0.1:5173/`; DOM QA confirms all three background labels are present.
- Switched the editor to Sakura, visually confirmed the Sakura background in the phone preview, and observed zero error-level browser logs.
- Restored the editor to `BG02 \u590f\u5b63`, kept the local preview available, and recorded the completed feature/resource/package status in the durable project docs.
- Final focused regressions still pass after restoration. The existing worktree contains many unrelated/pre-existing edits and untracked assets; they were preserved and not reverted.
- Removed a duplicated Sakura completion block from the project progress document; the durable record now appears once.

## 2026-08-03 Level16 guide-45 package

- Confirmed Level16 vehicle 45 exists and is a visible 6-seat, color-2 vehicle.
- Updated normal and disabled first-click guide scope/target from Level15/157 to Level16/45 in exported tuning, focused tests, and the editor saved-default migration.
- Applied exported tuning back to source; all other Level16 package parameters remain unchanged.
- Structured source/export verification confirms both guides use Level16/45, the first-click guide remains disabled, and all prior background/threshold/path/scale values are unchanged.
- Regenerated the single-level Level16 payload with 37 vehicles and queues 139+79.
- Source/generated/test syntax and six focused guide/catalog/main checks pass. The active guide regression confirms Level16 vehicle 45 while the first-click mask remains disabled.
- Rebuilt and regenerated the AppLovin single HTML at 3,968,019 bytes. All 15 static checks pass and the final artifact contains both `level16 + vehicleId 45` guide configurations.
- Final binary verification confirms only `BG02_split01_summer_q60.jpg` is embedded. The package has 1,031,981 bytes remaining under 5,000,000; SHA-256 is `7E4C981851EFC8F3F13371E2ED6109553D6327FCA04585507AE9909391FBA7CF`.

## 2026-08-03 Level16 parameter package

- Started synchronizing the requested Level16/summer/threshold/path/vehicle-scale values for a new AppLovin package.
- Confirmed summer q60 is already baked. Remaining changes are Level15 -> Level16, threshold 40 -> 30, path X -2.53/2.53 -> -2.2/2.2, map scale 0.73 -> 0.8, and model scale 0.63 -> 0.7.
- Confirmed the workflow: update exported tuning, apply it to source/selection marker, regenerate the active payload, run focused checks, then build/package/check the single HTML against 5,000,000 bytes.
- Updated `artifacts/scene-tuning.json` and focused expectations, then applied the export through `npm run apply:tuning`; source tuning and the durable selection marker now target Level16.
- Structured source/export/marker verification matches exactly: Level16, summer q60, threshold 30, path X -2.2/2.2, map scale 0.8, and model scale 0.7.
- Regenerated the narrow production payload as Level16 with 37 vehicles and authored queues 139+79.
- Initial grouped config verification passed 4 relevant tests but also hit the known unrelated stale camera expectation (55 vs current 61); camera tuning is out of scope and remains unchanged.
- Source/generated/test syntax passes. Focused catalog/config/win/threshold checks pass 7/7, and the unchanged Level15-only guide regression passes 1/1.
- Direct generated payload inspection confirms one-level sequence `level16`, 37 vehicles, queues 139+79, and summer q60 background.
- Production build passed and regenerated the same Level16 37-vehicle / 139+79 payload; Vite emitted only the existing >500 kB chunk warning.
- Generated `artifacts/applovin/index.html` at 3,968,021 bytes (3.784 MiB); final static checks and marker/hash verification are next.
- All 15 AppLovin static checks pass. Final marker scan confirms Level16, threshold 30, path X -2.2/2.2, map scale 0.8, model scale 0.7, and the `You Win!` completion overlay.
- Binary scan confirms only the summer q60 background is embedded. Final size is 3,968,021 bytes with 1,031,979 bytes remaining; SHA-256 is `9B6B584D7E58765471B1EDEA4F8CF6C455A41C23873133A9D3D0BAFD5644A201`.
- Browser inspection found a surviving localhost tab still using cached Level15/40/-2.53/0.73/0.63 values. The first cache update targeted a second tab that disappeared during reload; the remaining tab still needs synchronization even though production source/package values are already correct.
- Added a narrow editor-cache migration: only saved fields that exactly match the previous package defaults are upgraded to Level16/30/-2.2/2.2/0.8/0.7; unrelated custom tuning remains untouched.
- Migration/source syntax plus five focused main/catalog/config checks pass. Because runtime source changed, the production package will be rebuilt and revalidated before handoff.
- Rebuild after the editor-cache migration passed; production tree-shaking keeps the same Level16 bundle and existing chunk warning. Repackaged single HTML remains 3,968,021 bytes.
- Rechecked all 15 AppLovin rules and final markers after rebuilding; size/hash/background embedding remain identical and every requested value is present.

## 2026-08-03 editor final-level completion fix

- Started tracing the reported unresponsive editor state after every vehicle completes.
- Confirmed the game model reaches `won`; the UI branch hides the existing completion panel and intentionally suppresses the production victory overlay when no next level exists.
- Follow-up clarified that victory should reuse the existing failure CTA/icon overlay instead of the simple replay panel. Updated the final win branch and focused source contracts accordingly.
- Syntax and focused win/main/session source-contract tests pass 3/3 after enabling `showResultOverlay('You Win!')` at final completion.
- Browser main-world state injection is blocked by the in-app browser's isolated DOM API; no product debug hook will be added solely for QA. Browser verification will inspect the shared overlay DOM and console, while the final-state branch remains covered by tests.
- Browser DOM verification found the shared result title, game icon, and CTA exactly once each; the icon source is `/assets/main-loading-icon.png` and error-level logs are empty.
- Final behavior: terminal victory calls the same result overlay as failure with title `You Win!`; the overlay owns the existing icon animation and `Play Now` store CTA.

## 2026-08-03 editor layout-switch queue parity fix

- Started tracing the reported passenger-color mismatch after editor vehicle-layout switching.
- Confirmed the switch path performs a full reload and reconstructs both the active level binding and `BusLoopGame`; no old model reuse has been found yet.
- Next: run direct Level15 -> Level16 model parity diagnostics across visible queues, source queues, and conveyor slots, then inspect passenger rendering/allocation if model totals remain exact.
- Direct model diagnostics passed for Level15 and Level16: authored queues, runtime queues+sources+belt, and vehicle seats have identical per-color totals after initialization.
- Connected to the current Level15/DualQueue3 editor preview; it intentionally renders only 22 passenger positions per side while retaining all remaining passengers in the model's refill source.
- Reproduced the actual duplication path: after eight Level16 passengers entered the belt, a normal editor queue reinitialization increased runtime total from 218 to 226 and duplicated colors 2 and 6.
- Updated `BusLoopGame.initializeQueues()` so non-reset reinitialization repartitions only the current remaining side/source passengers; occupied belt slots and prior boarded progress are no longer duplicated.
- Source/test syntax checks and two focused queue initialization regressions pass. A direct post-fix diagnostic holds Level16 at 218 with exact per-color parity before and after reinitialization.
- Browser QA switched Level15 -> Level16, changed and restored a DualQueue3 curve value to exercise non-reset reinitialization, and reported no error-level logs; the editor and durable selection were restored to Level15.
- Final focused catalog/model selection and parity regressions pass 4/4. The broader queue filter passed 4 relevant tests and hit one known stale Level12 hard-coded head-color expectation; Level9->Level7 session tests remain incompatible with the current intentional Level15 production selection.
- No build/package was run because the change is isolated to runtime queue state preservation and does not alter assets, dependencies, or the production generation boundary.

## 2026-08-03 Level16 import

- Started importing `D:/备份/busloop素材关卡/level16.asset` as a new vehicle/passenger layout through the existing reproducible Unity level pipeline.
- Validated 37 unique vehicles / 218 seats against authored queues 139+79 with exact color parity; all yaws/depth references are valid and initial collision overlap count is zero.
- Added Level16 to the default extractor sources and Vite editor-selection whitelist, plus focused catalog assertions for exact queue runs and collision safety.
- Regenerated `artifacts/unity-levels.json` and `src/level-catalog.js`; output includes Level16 with 37 vehicles and queues 139+79. Regenerated the narrow production module and confirmed it remains Level15-only.
- Catalog/generated-source syntax passes. Focused directory, production-boundary, Level16 queue/collision, and editor wiring regressions pass 4/4.
- Restarted the local Vite server so it reads the new whitelist; browser preview reaches the playable loading/editor shell at `http://127.0.0.1:4173`.
- Browser editor lists Level16 after Level15; selecting it is accepted by the Vite persistence endpoint and reloads the runtime successfully.
- The reloaded Level16 scene visibly renders the new vehicle ring and both passenger queues on a 644x1328 canvas; error-level console count is zero.
- Switched the editor back to Level15 and confirmed the persisted marker, source tuning, and narrow generated runtime all remain Level15.
- Task complete. No production build/package was run because Level16 is only added to the development catalog and the current AppLovin payload remains unchanged.
- Final rerun: focused tests pass 4/4, both generated modules pass syntax checks, Level16 queues resolve to 139+79, active sequence is only Level15, diff whitespace check passes, and the local editor returns HTTP 200.

## 2026-08-03 summer background and package

- Added BG01 winter / BG02 summer selection to the scene editor and set the optimized summer asset as the source/exported/generated default.
- Kept the supplied 1,035,562-byte source intact; generated a 195,940-byte q60 derivative at the original 2100x3382 dimensions.
- Focused regression, syntax checks, production build, and browser switching QA pass; browser console errors: 0.
- Regenerated `artifacts/applovin/index.html` at 3,979,125 bytes. All 15 checks pass, only the q60 summer bytes are embedded, and SHA-256 is `A7F438C10AC4D7E4C157AAF70E7A13565DBA4ED9904BAE276BC3F8EFF59CE648`.
- External follow-up: run AppLovin official preview/QR and real creative-backend upload/play validation.

## 2026-07-30 Level15 AppLovin package

- Production build passed and regenerated the Level15-only session with 81 vehicles and 296+214 queues; Vite emitted only the existing chunk-size warning.
- Generated `artifacts/applovin/index.html` at 3,642,343 bytes. All 15 AppLovin checks and final queue/tuning marker scans pass.
- SHA-256 is `74FBABDBE2488F99AEF442FB6D04D485007DBF9AC3FF24E8E0DD17343C2EB0E6`; no local permission issue remains.
- External follow-up: upload the current `index.html` to AppLovin official preview and the real creative backend, then record desktop/QR-device gameplay, CTA, audio, lifecycle, and end-state results.

## 2026-07-30 Level15 queue and tuning revision

- Replaced the exact Level15 queues with 296 left + 214 right passengers; all 510 passengers retain exact color parity with the 81 vehicles.
- Synchronized Map Scale `0.73`, vehicle model scale `0.63`, both guide configs to Level15 vehicle 157, and path X bounds `-2.53 / 2.53` across source/exported tuning.
- Regenerated the catalog and Level15-only active payload. Syntax and focused catalog/guide/config checks pass 8/8.
- No build or package was run after these adjustments, as requested.

## 2026-07-17 Level9 to Level7 session transition

- Started a fresh AppLovin package pass to disable the first-step timed mask while preserving the normal Level9 vehicle-114 guide and prior threshold/size values.
- Synchronized `firstClickGuide.enabled` to `0` in source/exported tuning and updated the focused guide regression; direct config assertions and the 1/1 guide test pass.
- Production Level9 -> Level7 build passes with only the existing Vite chunk-size warning.
- Regenerated the AppLovin single HTML at 3,653,268 bytes; every static check passes and final markers show `vehicleGuideHand.enabled: 1`, `firstClickGuide.enabled: 0`, Level9 vehicle 114, size 2.12, and threshold 40. SHA-256: `041493FEB89FB3714FBF72CEFB2D4E6C7D2CED5006BF166C5412B720FCF83EE5`.
- AppLovin parameter package: synchronized successful-operation threshold 40 and guide size 2.12 while preserving Level9 vehicle 114 in both source and exported tuning.
- Shared the identical Level9/Level7 asset manifest in generated production data, removing duplicate binary data URIs without changing either gameplay layout.
- Focused guide/catalog/session/CTA regressions pass 14/14. Production build passes with only the existing Vite chunk-size warning.
- Generated and statically validated `artifacts/applovin/index.html` at 3,653,268 bytes. Final SHA-256 is `79B7951D936AEBF1D0D5E6340555157607C234A4C641056BB7FB82BFC505745B`; AppLovin preview/upload play remains manual.
- Guide follow-up: persisted both guide targets as Level9 vehicle 114, added level selectors in the editor, and gated the normal sprite plus timed DOM mask/hand by the active level key. Level7 now suppresses both guide layers even though it also contains vehicle id 114.
- Added direct Level9/Level7 guide-scope assertions. Guide and session regressions pass 6/6, touched-source syntax passes, and the production build passes with only the existing chunk-size warning.
- Final bundle is 749,343 bytes and contains both guide configs as `level9 + vehicle 114`; the active win-end text remains absent.
- Switched the production selection/tuning to Level9 and extended active-level generation to bake the narrow Level9 -> Level7 session payload.
- Added pure session state that preserves one successful-operation CTA/install count across both levels while namespacing repeated vehicle ids by level.
- Deferred an already-ready CTA/store gate until the final session level so the current threshold of 20 cannot intercept Level9 before its 37 vehicles are cleared.
- Follow-up refinement: the Level9 conveyor art and passenger/conveyor layout now remain fixed during the handoff. Only the new Level7 vehicle root slides in from below over 0.85 seconds; no layout scaling is applied.
- The fresh Level7 model still resets conveyor slots and clears visual entry state, so passenger groups begin entering from both left and right queues during the vehicle entrance.
- Temporarily disabled the existing win result/end overlay; loss behavior remains unchanged.
- Refined verification passes: touched-source syntax, session/catalog regressions 11/11 (including stationary-conveyor wiring and both-side Level7 entry), paired CTA regressions 2/2, and the production build.
- The final 749,210-byte JS bundle contains Level9 and Level7, the vehicle-root/offset entrance markers, no legacy scale-entrance marker, and no active win-end text. Vite retains only the existing >500 kB warning.

## 2026-07-16 Level7 vehicle 66/82 position sync

- Read the updated Unity `level7.asset`: vehicle 66 is now `x -0.15425447 / z 0.95464253`; vehicle 82 is now `x 0.77715284 / z 0.57091796`.
- Added focused coordinate assertions and regenerated the catalog, artifact, and active Level7 payload from the authoritative Unity asset.
- Direct verification confirmed both generated catalog and production active module contain the new coordinates before focused verification and packaging.
- Test-file syntax check and focused level catalog/collision regressions pass 12/12, including no-overlap checks for both moved vehicles.
- Production build passed and regenerated the selected Level7-only payload (83 vehicles, queues 368+278); Vite emitted only the existing chunk-size warning.
- Regenerated `artifacts/applovin/index.html` at 3,639,587 bytes (3.471 MiB); all AppLovin static package checks passed.
- Final package scan confirms `level7.asset`, exact new vehicle 66/82 coordinates, and absence of both stale coordinate pairs. SHA-256: `A02356D125E572954D6F9ECBB36218941C171206F713DBCAAFDC4E2F47716E1C`.
- Task complete; final artifact is `artifacts/applovin/index.html`.

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


