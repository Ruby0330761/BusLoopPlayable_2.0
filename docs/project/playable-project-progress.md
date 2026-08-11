# Playable Project Progress

## Completed On 2026-08-11 - Sakura background selection and single-background packaging

- Added `BG01 \u6a31\u82b1` as a third editor-selectable background using the optimized 2100x3382 `BG01_split01_Sakura_q60.jpg` derivative (278,157 bytes); the supplied 1,976,289-byte PNG remains untouched.
- Active-level generation now overwrites every generated session level's background manifest with the baked editor selection and validates that the selected asset exists. This prevents the catalog's fallback background from entering production alongside the selected image.
- Focused syntax/tests pass. Browser QA switched summer -> Sakura -> summer, visually confirmed the Sakura preview, and reported zero error-level logs.
- A temporary Sakura build produced a 4,191,471-byte AppLovin HTML that passed all 15 checks; Base64 fingerprints confirmed only Sakura was embedded. The restored summer final artifact is 3,972,231 bytes, passes all 15 checks, and embeds only summer.
- Final SHA-256: `3300A5FDC1045513203224648AB414AB472E5C490CC6C2D873817DE9C060196F`. Official AppLovin upload/device play remains external manual acceptance.

## Completed On 2026-08-03 - Level16 vehicle-45 guided AppLovin package

- Baked Level16 with the optimized summer background, successful-operation threshold 30, vehicle path X bounds -2.2/2.2, map scale 0.8, and vehicle model scale 0.7 across source/exported tuning and the durable selection marker.
- Added a development-only saved-default migration so editor caches still holding the immediately prior Level15/40/-2.53/0.73/0.63 defaults adopt this package's values without overwriting unrelated custom tuning.
- Baked both guide scopes to Level16 vehicle 45 while retaining `firstClickGuide.enabled = 0`; the normal guide hand remains enabled.
- Generated a Level16-only production payload with 37 vehicles and authored queues 139+79, then completed the production build with only the existing Vite chunk-size warning.
- Generated `artifacts/applovin/index.html` at 3,968,019 bytes, leaving 1,031,981 bytes under the 5,000,000-byte limit. All 15 AppLovin static checks and final guide/parameter/background marker checks pass.
- SHA-256: `7E4C981851EFC8F3F13371E2ED6109553D6327FCA04585507AE9909391FBA7CF`. Official AppLovin preview/QR and real-backend upload/play remain external manual acceptance steps.

## Completed On 2026-08-03 - Final victory CTA overlay

- Fixed the unresponsive final state after every vehicle completes: the terminal win branch now reuses the existing result overlay with `You Win!`, the game icon, title animation, and `Play Now` store CTA.
- The Level9 -> Level7 intermediate handoff remains unchanged; the shared overlay appears only when the current session has no next level.
- Main/test syntax and three focused win/session/source-contract tests pass. Browser inspection confirms the shared title/icon/CTA DOM is present and reports zero error-level logs.
- No build/package was run because the change is a narrow existing-UI branch correction with no asset, dependency, or packaging changes.

## Completed On 2026-08-03 - Editor queue color parity fix

- Fixed editor-driven queue geometry reinitialization duplicating passengers already on the conveyor after a vehicle-layout switch or tuning change.
- Non-reset initialization now preserves the current side/source queue remainder, while explicit structural resets still restore the selected level's authored queues and clear belt slots.
- Level16 remains exactly 218 passengers with per-color parity before and after reinitialization; focused queue/catalog tests pass, browser switching/editing QA has no error-level logs, and Level15 was restored as the production selection.
- No build/package was run because this is a focused model-state fix and the production asset/config boundary is unchanged.

## Completed On 2026-08-03 - Level16 vehicle and queue layout import

- Imported `level16.asset` into the reproducible Unity level catalog as a new editor-selectable layout while preserving its authored Unity `id: 14`, 37 vehicles, and exact 139+79 passenger queues.
- Vehicle seats and passenger colors match exactly across 218 passengers; all vehicle ids/yaws/depth references are valid and the layout has zero initial collision-box overlaps.
- Catalog/generated-source syntax and four focused catalog/queue/collision/selection regressions pass. Browser QA loaded Level16 with both queues and zero console errors, then restored Level15 as the current production selection.
- No production build/package was run because the narrow active module remains Level15-only; Level16 stays behind the development-only catalog/editor boundary.

## Completed On 2026-08-03 - Summer background and AppLovin size pass

- Added an editor background selector for BG01 winter / BG02 summer and made the optimized summer image the baked default across scene tuning and generated level asset manifests.
- Preserved the supplied 1,035,562-byte source and generated `BG02_split01_summer_q60.jpg` at 195,940 bytes with the same 2100x3382 dimensions.
- Focused background regression, source syntax, production build, browser switching QA, and all 15 AppLovin checks pass. The final single HTML is 3,979,125 bytes with 1,020,875 bytes remaining under the 5,000,000-byte checker limit.
- SHA-256: `A7F438C10AC4D7E4C157AAF70E7A13565DBA4ED9904BAE276BC3F8EFF59CE648`. AppLovin official preview/QR and real-backend upload remain external manual acceptance steps.

## Completed On 2026-07-30 - Level15 AppLovin package

- Built the revised Level15-only payload (81 vehicles, queues 296+214) and generated `artifacts/applovin/index.html` at 3,642,343 bytes.
- All 15 AppLovin static checks pass. Final package markers confirm Level15, both replacement queue prefixes, Map Scale `0.73`, vehicle model scale `0.63`, guide vehicle 157, and path X bounds `-2.53 / 2.53`.
- SHA-256: `74FBABDBE2488F99AEF442FB6D04D485007DBF9AC3FF24E8E0DD17343C2EB0E6`. No local permission issue remains.
- AppLovin official preview/QR device play and real creative-backend upload remain required external manual acceptance steps.

## Completed On 2026-07-30 - Level15 queue and tuning revision

- Replaced Level15 passenger queues with the supplied exact order: 296 left + 214 right. Their combined per-color totals still match all 510 vehicle seats.
- Applied Map Scale `0.73`, vehicle model scale `0.63`, Level15 vehicle-157 guide scope/target for both guide configs, and vehicle path X bounds `-2.53 / 2.53` in source and exported tuning.
- Regenerated the Level15 catalog and narrow active payload. Focused queue/guide/config tests pass 8/8 and generated-source syntax passes.
- Build and platform packaging were intentionally skipped per user request.

## Completed On 2026-07-17 - First-step mask-off AppLovin package

- Disabled the timed first-step mask/DOM guide by baking `firstClickGuide.enabled = 0`; the ordinary guide hand remains enabled for Level9 vehicle 114 at size 2.12, with successful-operation threshold 40 unchanged.
- Focused guide/config verification and the production build pass; the build retains only the existing Vite chunk-size warning.
- Generated `artifacts/applovin/index.html` at 3,653,268 bytes; every AppLovin static check passes. SHA-256: `041493FEB89FB3714FBF72CEFB2D4E6C7D2CED5006BF166C5412B720FCF83EE5`.
- AppLovin preview/upload play remains a manual validation step.

## Completed On 2026-07-17 - Level9 to Level7 AppLovin parameter package

- Baked successful-operation threshold `40`, both Level9-only guide targets on vehicle `114`, and guide-hand overall size `2.12` into source/exported tuning.
- The Level9 -> Level7 generator now shares their identical asset manifest instead of serializing it twice; gameplay layouts remain independent and the AppLovin single HTML stays below the platform size limit.
- Focused guide/catalog/session/CTA regressions pass 14/14. The production build passes with only the existing Vite chunk-size warning.
- Generated `artifacts/applovin/index.html` at 3,653,268 bytes; every AppLovin static check passes. SHA-256: `79B7951D936AEBF1D0D5E6340555157607C234A4C641056BB7FB82BFC505745B`.
- AppLovin preview/upload play remains a manual validation step.

## Completed On 2026-07-17 - Level9 to Level7 session transition

- The playable now starts on Level9 and automatically rebuilds as Level7 after Level9 is cleared.
- Follow-up refinement: the Level9 conveyor artwork remains fixed. Only the new Level7 vehicle layout slides in from below over 0.85 seconds, while both side passenger queues restart their existing entrance motion.
- The successful-operation CTA/install counter is session-wide and namespaces repeated vehicle ids by level, so Level9 progress is preserved into Level7 without collisions.
- If the configured threshold is reached during Level9, the count remains ready but store interception is deferred until Level7, ensuring the Level9 win transition cannot be blocked by the current threshold of 40.
- The existing win result/end overlay call is temporarily commented out; loss/game-over behavior is unchanged.
- Both guide layers now target vehicle 114 only on Level9. Normal and timed mask/DOM guide visibility is gated by the active level key, so Level7 vehicle 114 is never guided; both scopes are selectable in the editor.
- Production generation continues to bake only the requested Level9 -> Level7 sequence. The latest guide/session tests pass 6/6, touched-source syntax and production build pass, and the final bundle contains both guide configs as Level9 vehicle 114. The subsequent AppLovin package status is recorded above.

## Completed On 2026-07-16 - Level7 vehicle 66/82 position sync

- Synchronized the latest Unity Level7 coordinates for vehicle 66 (`x -0.15425447 / z 0.95464253`) and vehicle 82 (`x 0.77715284 / z 0.57091796`) through the reproducible level extraction pipeline.
- Added focused coordinate/no-overlap regression coverage and regenerated the catalog, artifact, and selected Level7-only production payload.
- Focused catalog/collision tests pass 12/12; production build passed with only the existing chunk-size warning.
- Regenerated `artifacts/applovin/index.html` at 3,639,587 bytes; all AppLovin checks and final Level7/new-coordinate marker scans passed. SHA-256: `A02356D125E572954D6F9ECBB36218941C171206F713DBCAAFDC4E2F47716E1C`.

## Completed On 2026-07-16 - Level7 current-editor AppLovin rebuild

- Applied the complete runtime tuning exported by the user: Level7, DualQueue3, install threshold 20, six parking spots, vehicle-area scale 0.84, and the current vehicle-89 guide/mask values.
- Generated the Level7-only production payload with 83 vehicles and passenger queues 368+278.
- Focused guide/catalog/collision tests pass 13/13 and the Vite production build passed with only the existing chunk-size warning.
- Generated `artifacts/applovin/index.html` at 3,639,703 bytes; all AppLovin static checks and final single-level/config marker scans passed. SHA-256: `1AEC67487626C7E73EBB07DE00967344FA0EE6F47BCE61042274ECD8DD03DA5C`.
- Automated local `file://` runtime QA was blocked by browser URL policy; AppLovin preview/upload play remains manual validation.

## Completed On 2026-07-16 - Vehicle 89 timed guide mask

- Bound the guide hand to vehicle id 89.
- Added an editor-tunable first-click guide mask that highlights vehicle 89, defaults to black opacity `0.8`, auto-hides after `2s`, and does not block other vehicle clicks.
- Added editor controls for enable/disable, target id, duration, mask opacity, padding, and highlight block width/height scale.
- Moved the timed guide hand into the DOM mask layer so it renders above the mask, flips horizontally, and disappears with the mask.
- Adjusted the guide motion to start on the right, travel left toward vehicle 89, and shrink during the approach.
- Added an editor saved-tuning migration so the previous vehicle `1`, base X `-0.38`, and start X `-0.62` defaults no longer override the vehicle `89` guide settings.
- Synced source and exported scene tuning; focused guide-mask test passed.
- Build/package intentionally skipped by request.

## Completed On 2026-07-16 - Level7 vehicle 89 color and right queue update

- Changed Level7 vehicle id 89 from color 5 to color 2 through the reproducible vehicle override map; it remains a 10-seat vehicle.
- Replaced the exact right queue order while keeping its length at 278. Right-side counts are now `{0:66,1:44,2:10,5:66,6:22,7:70}`, matching the ten seats moved from color 5 to color 2.
- Regenerated the catalog/artifact and preserved the current durable Level9 selection; Level7 remains updated in editor/development options.
- Verification: syntax checks, focused catalog/collision tests 12/12, direct per-color parity check, and `npm.cmd run build` passed. Vite retains the existing >500 kB chunk warning.

## Completed On 2026-07-16 - Level7 Escape C import

- Imported the 83-vehicle layout from `Level_Escape_C/level7.asset` and added Level7 to the editor/development catalog between Level5 and Level8.
- Replaced the asset's stale fixed queues with the supplied exact left/right order (368+278 passengers). Combined per-color counts match all 646 vehicle seats exactly.
- Selected Level7 for production, regenerated the full catalog/artifact and Level7-only active payload, and verified zero initial vehicle-body overlaps.
- Verification: extractor/test syntax checks, focused catalog/collision tests 12/12, exact queue run-order check, direct active/count/overlap diagnostic, and `npm.cmd run build` passed. Vite retains the existing >500 kB chunk warning.

## Completed On 2026-07-16 - Level8/Level9 collider parity

- Replaced stale web 4-seat/6-seat collision lengths with the centered logical sizes from Unity `BusJamConfig.asset`; vehicle positions, yaw values, and SAT tolerance were unchanged.
- Regenerated the full Unity level artifact/catalog and the selected Level9 production payload. The corrected sizes remove all initial vehicle-body overlaps in Level8 and Level9 (and all other imported levels).
- Added a focused Level8/Level9 no-overlap regression. Catalog plus collision tests pass 11/11, and touched/generated JavaScript syntax checks pass.
- No full build/package was run because the change is limited to generated level collision data; the selected level remains Level9.

## Completed On 2026-07-15 - Configurable successful-operation store redirect

- Restored the prior unique successful-vehicle operation gate: the operation that reaches the configured threshold immediately opens the store, and later canvas clicks retain the install redirect.
- Added `installGate.successfulOperationThreshold` to scene tuning and the web editor under `商店跳转 / 成功操作次数`; default is 40 and the editor accepts whole values from 1 to 200.
- Synced source/exported tuning and added an independent focused regression. Main-thread plus redirect tests pass 2/2; syntax and JSON checks pass.
- Rebuilt the selected level13 production bundle and regenerated the AppLovin single HTML at 3,630,878 bytes. AppLovin static checks and final artifact checks for threshold 40 plus the active successful-click redirect passed.

## Completed On 2026-07-15 - Vehicle 130 collision nudge

- Nudged level13 vehicle 130 upward from `z 1.2969986` to `z 1.3369986` so its collision body no longer touches vehicle 135.
- Added the same override to `scripts/extract-unity-levels.mjs` so future Unity level extraction preserves the fix.
- Added a focused catalog regression for the 130/135 collision separation.
- Regenerated the selected level13-only AppLovin package at 3,630,407 bytes.
- Verification: syntax checks, focused level catalog tests 4/4, direct model click check, Vite build, AppLovin package check, and final package string checks passed.

## Completed On 2026-07-15 - DualQueue3 trajectory package refresh

- Switched the active conveyor layout to `dualQueue3` and applied the screenshot trajectory values to that layout only.
- Synced `src/scene-tuning.js` and `artifacts/scene-tuning.json` so future tuning application preserves the selected layout and path values.
- Regenerated the selected level13-only AppLovin package at 3,630,407 bytes.
- Verification: scene tuning syntax/JSON import checks, Vite build, AppLovin package check, and final package string checks passed.

## Completed On 2026-07-15 - Vehicle 130 guide hand mirror

- Bound the guide hand to vehicle 130, mirrored its texture UV horizontally, and mirrored the static/approach X offsets.
- Synced `src/scene-tuning.js` and `artifacts/scene-tuning.json`; added focused regression coverage.
- Focused tests 10/10, syntax, Vite build, AppLovin checks, content scan, and browser runtime QA passed.
- Regenerated the selected level13-only package at 3,630,406 bytes; browser QA showed the hand on vehicle 130 with no console errors.

## Completed On 2026-07-15 - Imported levels and Unity collision parity

- Imported level5/8/9/10/13 as complete vehicle + paired passenger-queue layouts with reproducible extraction and per-color validation.
- Added editor-level switching with runtime reload and a durable build-selection marker; level5 is the baked default.
- Replaced static depth-chain dispatch with the demo's current-geometry collision graph, per-vehicle sizes, and oriented contact.
- Added a development catalog plus a single-active-level production boundary. Focused tests 9/9, syntax, build, AppLovin checks, package scan, browser switching QA, and build-marker switching passed. Final package: 3,627,325 bytes.
- Broader game-model test file: 27 passed / 8 known stale expectations failed.

## Completed On 2026-07-14

### Multi-conveyor editor layouts

- Added editor-selectable conveyor layouts imported from `GameSceneDualQueue2/3/5/10`, including each prefab's loop art, closed passenger spline, two queue-entry splines, conveyor/queue capacities, and exit range.
- Added independent per-layout art and trajectory transforms. Switching layout resets/reinitializes the editor preview with the selected runtime capacity and computed entry positions; legacy DualQueue2 tuning exports/localStorage migrate into the new nested layout config.
- Added reproducible Unity prefab extraction and compressed WebP assets. Focused multi-conveyor tests passed, and the Vite production build passed with the existing >500 kB chunk warning.
- Full `npm test`: 44 passed / 10 failed; failures are existing stale tuning/expectation mismatches, while all new multi-conveyor regressions passed.
- Manual browser visual switching is still pending because the bundled Browser client failed during setup with `Cannot redefine property: process`.

## Current Snapshot - 2026-07-08

The project moved from the original 6-vehicle level1 prototype to the imported level12-style playable layout on 2026-07-07. The active runtime now targets `GameSceneDualQueue2` with 94 visible vehicles, two fixed passenger queues, authored depth blockers, Unity-style motion/effects/audio, and editor controls for major visual tuning.

## Completed On 2026-07-09

## 2026-07-09 parking spot tuning package refresh

- Exported the latest parking spot tuning to source and exported config: `count 5`, `startX -1.8`, and `z 0.55`.
- User manually ran `npm run build`, `npm run package:applovin`, and `npm run check:applovin`; the AppLovin checker passed.
- Regenerated `artifacts/applovin/index.html` from Vite bundle `index-BXoBfQW6.js`; synced `artifacts/applovin/Bus Fever - Car Jam Escape Playable_applovin.html` and `artifacts/applovin/BusLoopPlayable-2.html` to the same 3,293,249-byte content with matching SHA256 `7ED4366D6C6C7EB7917F102B599509A4171EBA3E9DEF14100E25E31BF392C1B7`.

## 2026-07-09 win fallback CTA overlay

- Reused the existing Game Over result overlay for the win fallback: when the game reaches `won`, it now shows the same mask/logo/CTA flow with title text `You Win!`.
- Tightened the model win condition so victory requires all vehicles to be `done` and remaining passengers to be `0`, preventing the fallback from appearing while passengers remain.
- Verification: `node --check src/main.js`, `node --check src/game-model.js`, and `node --check test/game-model.test.js` passed; direct module win-condition check and result-overlay source check passed. Sandboxed targeted `node --test` hit Windows `spawn EPERM`, and elevated retry was blocked by automatic approval service 503. No AppLovin package was regenerated.

## 2026-07-09 queue 0 replacement

- Replaced the active queue 0 passenger sequence with the requested list, then appended the 3 missing blue passengers at the queue 0 tail. Queue lengths are now `[257, 181]`, total passenger groups are 438, and passenger color totals match vehicle seats.
- Verification: `node --check src/level-data.js`, `node --check test/game-model.test.js`, and direct queue length/color/tail import checks passed. Sandboxed targeted `level12 initializes|queue initialization` tests still hit Windows `spawn EPERM`.

## 2026-07-09 delayed settled Game Over trigger

- Changed Game Over loss timing so the failure condition starts only after all parking spots are occupied by vehicles that have actually reached `at-spot`, the conveyor has no empty slots, and no belt passenger can board; loss now triggers only after configurable `gameOver.failureDelaySeconds` persists, defaulting to 2 seconds.
- Added the delay to source/exported scene tuning and the Game Over editor controls.
- Verification: `node --check` passed for `src/game-model.js`, `src/scene-tuning.js`, `src/scene-editor.js`, and `test/game-model.test.js`; `artifacts/scene-tuning.json` parsed. Sandboxed targeted `Unity conveyor failure|editor sizing` tests hit Windows `spawn EPERM`, and the elevated retry was blocked by automatic approval service 503.

## 2026-07-09 CTA and Game Over tuning export only

- Exported the latest editor CTA/Game Over tuning to `src/scene-tuning.js` and `artifacts/scene-tuning.json`: CTA world anchor `0, 3.17, 7.44`, CTA `y 1868`, height `137`, font size `63`, pulse scale `1.05`; Game Over title pop speed `1.12`, logo position `533, 974`, logo size `645 x 587`, and logo radius `30`.
- No AppLovin package was regenerated by request.
- Verification: syntax/JSON checks only; build/package intentionally skipped.

## 2026-07-09 Game Over font and CTA logo refresh

- Replaced the deadlock CTA overlay logo with the provided `Main_Loading_Icon.png`, copied into `public/assets/main-loading-icon.png`, and adjusted the default logo frame to a wide transparent image.
- Added configurable Game Over title font selection in scene tuning/editor with a new rounded-heavy default, while keeping Impact and system-bold options available.
- Regenerated `artifacts/applovin/index.html` from Vite bundle `index-DN12yPGu.js`; synced `artifacts/applovin/Bus Fever - Car Jam Escape Playable_applovin.html` and `artifacts/applovin/BusLoopPlayable-2.html` to the same 3,292,789-byte content.
- Verification: `node --check` passed for `src/main.js`, `src/scene-tuning.js`, `src/scene-editor.js`, and `test/game-model.test.js`; `artifacts/scene-tuning.json` parsed; elevated targeted `main thread saves` test passed after sandboxed Node hit Windows `spawn EPERM`; elevated `npm run build`, `npm run package:applovin`, `npm run check:applovin`, built bundle `node --check`, final package string checks, and final package hash comparison passed.

## 2026-07-09 passenger queue id swap

- Swapped the two fixed passenger queue ids at the level-data layer: queue 0 now uses the previous queue 1 sequence and queue 1 now uses the previous queue 0 sequence; queue paths/entrance geometry were unchanged.
- Verification: `node --check src/level-data.js`, `node --check test/game-model.test.js`, direct queue import check, and elevated targeted `level12 initializes|queue initialization` tests passed after sandboxed Node hit Windows `spawn EPERM`.

## 2026-07-09 deadlock Game Over CTA flow

- Hid the gameplay CTA during normal play and disabled the old 10-success-operation install gate so store routing now waits for the deadlock CTA.
- Added a configurable deadlock overlay: black mask opacity, Game Over text size/pop/fade speed, and logo/CTA position, size, and appear speed are editor-tunable. The deadlock CTA uses the existing MRAID-only store route.
- Regenerated `artifacts/applovin/index.html` from Vite bundle `index-O8PSuwDY.js`; synced `artifacts/applovin/Bus Fever - Car Jam Escape Playable_applovin.html` and `artifacts/applovin/BusLoopPlayable-2.html` to the same 3,196,715-byte content.
- Verification: `node --check` passed for `src/main.js`, `src/scene-tuning.js`, `src/scene-editor.js`, and `test/game-model.test.js`; `artifacts/scene-tuning.json` parsed; elevated targeted `main thread saves|Unity conveyor failure` tests passed; elevated `npm run build`, `npm run package:applovin`, `npm run check:applovin`, and final package size/hash comparison passed. Sandboxed Node test/build still hit Windows `spawn EPERM` before elevated reruns passed.

## 2026-07-09 direct collision blocker targeting

- Changed blocked-click collision targeting so authored depth blocker lists still decide whether a bus is blocked, but the hit animation chooses a nearby directly overlapping visual blocker first.
- Added regression coverage for bus 49 choosing bus 63 as the direct visual collision target instead of the nearer indirect depth candidate 50.
- Verification: `node --check src/game-model.js`, `node --check test/game-model.test.js`, and elevated targeted collision tests passed. A broader targeted blocker run still hits the existing colliding-state blocker-query expectation failure.

## 2026-07-09 second playable queue 1 refresh

- Backed up the prior second-playable package and level data under `artifacts/backups/before-second-playable-queue1-adjust-20260709-155609/`.
- Replaced queue 1 with the latest requested passenger order; queue lengths remain `[245, 193]`, total passengers remain 438, and color totals still match vehicle seats.
- Regenerated the AppLovin single HTML from Vite bundle `index-CsOVmSFO.js`; synced `artifacts/applovin/index.html`, `artifacts/applovin/Bus Fever - Car Jam Escape Playable_applovin.html`, and `artifacts/applovin/BusLoopPlayable-2.html` to the same 3,067,199-byte content.
- Verification: `node --check src/level-data.js`, direct queue length/color-total import check, elevated targeted `level12 initializes` test, elevated `npm run build`, `npm run package:applovin`, `npm run check:applovin`, final package queue-string check, and final HTML hash comparison passed. Sandboxed Node test/build still hit Windows `spawn EPERM` before elevated reruns passed.

## 2026-07-09 second playable passenger-queue variant

- Backed up the pre-change level data and final AppLovin HTML files under `artifacts/backups/before-second-playable-20260709-153725/`.
- Replaced only the two fixed passenger queues for the second playable variant: queue 0 now has 245 passengers, queue 1 now has 193 passengers, with total passengers and color totals unchanged at 438.
- Regenerated the AppLovin single HTML from Vite bundle `index-Dvq-09MP.js`; synced `artifacts/applovin/index.html`, `artifacts/applovin/Bus Fever - Car Jam Escape Playable_applovin.html`, and `artifacts/applovin/BusLoopPlayable-2.html` to the same 3,067,199-byte content.
- Verification: `node --check src/level-data.js`, `node --check test/game-model.test.js`, direct queue length/color-total import check, elevated targeted `level12 initializes` test, elevated `npm run build`, `npm run package:applovin`, `npm run check:applovin`, and final package queue-string checks passed. Sandboxed Node test/build still hit Windows `spawn EPERM` before elevated reruns passed.

## 2026-07-09 AppLovin data-fetch and MRAID-only jump refresh

- Added an AppLovin single-HTML `data:` URL `fetch` compatibility layer so inlined FBX/VAT binary assets decode into `Response` objects before model loaders request them in stricter WebViews.
- Removed the browser-level `window.open` store fallback from runtime CTA/install-gate routing; AppLovin delivery now only calls `mraid.open()`.
- Regenerated `artifacts/applovin/index.html` from Vite bundle `index-xzFxeFV_.js`; final single HTML is 3,067,199 bytes (2.925 MiB). Synced `artifacts/applovin/Bus Fever - Car Jam Escape Playable.html` to the same content.
- Verification: `node --check` passed for `src/main.js`, AppLovin packaging/check scripts, and `test/game-model.test.js`; elevated targeted `main thread saves` test passed after sandboxed `spawn EPERM`; elevated `npm run build`, `npm run package:applovin`, `npm run check:applovin`, and final package string/size checks passed.

## 2026-07-09 CTA updated screenshot tuning package refresh

- Applied the latest screenshot CTA tuning to source and exported tuning: `worldZ 11.29`, `height 99`, `stretchX 3.18`, `fontSize 49`, `fontHeight 16`, and `strokeWidth 4.4`; stroke color remains `1665799`. CTA size still scales by current stage width.
- Regenerated `artifacts/applovin/index.html` from Vite bundle `index-BBLkHFcw.js`; final single HTML is 3,065,850 bytes (2.924 MiB). Synced `artifacts/applovin/Bus Fever - Car Jam Escape Playable.html` to the same content.
- Verification: `node --check src/scene-tuning.js`, `node --check test/game-model.test.js`, direct CTA config import check, elevated targeted `main thread saves` test, elevated `npm run build`, built bundle `node --check`, `npm run package:applovin`, `npm run check:applovin`, final package parameter checks, and package hash comparison passed. Sandboxed targeted test/build still hit Windows `spawn EPERM` before elevated reruns passed.

## 2026-07-09 CTA stage-scaled size package refresh

- Restored CTA size scaling by current stage width for width, height, padding, font size, line height, and stroke width while keeping the latest screenshot tuning values (`height 36`, `stretchX 3.76`, `fontSize 15`, `fontHeight 16`, `strokeWidth 1`) and stroke color `1665799`.
- Regenerated `artifacts/applovin/index.html` from Vite bundle `index-CzpPCV1h.js`; final single HTML is 3,065,848 bytes (2.924 MiB). Synced `artifacts/applovin/Bus Fever - Car Jam Escape Playable.html` to the same content.
- Verification: `node --check src/main.js`, `node --check test/game-model.test.js`, elevated targeted `main thread saves` test, elevated `npm run build`, built bundle `node --check`, `npm run package:applovin`, `npm run check:applovin`, final package parameter/scale string checks, and package hash comparison passed. Sandboxed targeted test/build still hit Windows `spawn EPERM` before elevated reruns passed.

## 2026-07-09 CTA screenshot tuning package refresh

- Applied the screenshot CTA size tuning to source and exported tuning: `height 36`, `stretchX 3.76`, `fontSize 15`, `fontHeight 16`, and `strokeWidth 1`; stroke color remains `1665799`.
- Regenerated `artifacts/applovin/index.html` from Vite bundle `index-Bx9JDNXj.js`; final single HTML is 3,065,832 bytes (2.924 MiB).
- Verification: `node --check src/scene-tuning.js`, `node --check test/game-model.test.js`, direct CTA config import check, elevated `npm run build`, built bundle `node --check`, `npm run package:applovin`, `npm run check:applovin`, and final package parameter string checks passed. The targeted `editor sizing` test still reaches the existing background-dimension assertion (`65536 !== 2100`) before CTA assertions; `main thread saves` passed.

## 2026-07-09 CTA fixed editor-pixel size package refresh

- Changed CTA width, height, padding, font size, line height, and stroke width to use the editor tuning values as fixed CSS pixels in the final runtime; CTA position still uses the world-coordinate anchor.
- Regenerated `artifacts/applovin/index.html` from Vite bundle `index-DHZIWUN8.js`; final single HTML is 3,065,834 bytes (2.924 MiB).
- Verification: `node --check src/main.js`, `node --check test/game-model.test.js`, elevated targeted `main thread saves` test, elevated `npm run build`, built bundle `node --check`, `npm run package:applovin`, `npm run check:applovin`, and source/final package string checks passed. Sandboxed targeted test/build still hit Windows `spawn EPERM` before elevated reruns passed.

## 2026-07-09 CTA phone-preview size consistency package refresh

- Changed CTA size interpretation back to 1080-design-space scaling for width, height, padding, font size, line height, and stroke width, so values tuned in phone-preview editor mode render at the same relative size in the final package; CTA position still follows the world-coordinate anchor.
- Regenerated `artifacts/applovin/index.html` from Vite bundle `index-wZZxcaWN.js`; final single HTML is 3,065,934 bytes (2.924 MiB).
- Verification: `node --check src/main.js`, `node --check test/game-model.test.js`, elevated targeted `main thread saves` test, elevated `npm run build`, built bundle `node --check`, `npm run package:applovin`, `npm run check:applovin`, source checks for `scaledPx(..., uiScale)`, and final package string checks for the CTA size/world config passed. Sandboxed `node --test` and `npm run build` still hit Windows `spawn EPERM` before elevated reruns passed.

## 2026-07-09 CTA size tuning package refresh

- Applied the screenshot CTA size tuning to source and exported tuning: `height 73`, `stretchX 2.83`, `fontSize 32`, and `fontHeight 64`; the existing fixed-size behavior and world anchor remain unchanged.
- Regenerated `artifacts/applovin/index.html` from Vite bundle `index-FpSv9k5p.js`; final single HTML is 3,065,918 bytes (2.924 MiB).
- Verification: `node --check src/scene-tuning.js`, `node --check test/game-model.test.js`, source/exported CTA config check, elevated `npm run build`, built bundle `node --check`, `npm run package:applovin`, `npm run check:applovin`, and final package string checks for the CTA size/world config passed. Sandboxed `npm run build` still hit Windows `spawn EPERM` before the elevated rerun passed.

## Completed On 2026-07-08

## 2026-07-08 CTA fixed-size package refresh

- Changed CTA sizing so button width, height, padding, font size, line height, and stroke width use fixed CSS pixels from tuning instead of scaling with device/stage width; CTA position still follows the world-coordinate anchor.
- Regenerated `artifacts/applovin/index.html` from Vite bundle `index-DZ3DdzZm.js`; final single HTML is 3,065,920 bytes (2.924 MiB).
- Verification: `node --check src/main.js`, `node --check test/game-model.test.js`, elevated targeted `main thread saves` test, elevated `npm run build`, built bundle `node --check`, `npm run package:applovin`, `npm run check:applovin`, and final package string checks for the CTA world anchor passed. Sandboxed `node --test` and `npm run build` still hit Windows `spawn EPERM` before elevated reruns passed.

## 2026-07-08 CTA world-coordinate package refresh

- Applied the screenshot CTA world anchor to source and exported tuning: `worldX 0`, `worldY 0.99`, `worldZ 11.57`.
- Regenerated `artifacts/applovin/index.html` from Vite bundle `index-NGI5-RRW.js`; final single HTML is 3,065,936 bytes (2.924 MiB).
- Verification: `node --check src/scene-tuning.js`, `node --check test/game-model.test.js`, `artifacts/scene-tuning.json` parse/config check, elevated `npm run build`, built bundle `node --check`, `npm run package:applovin`, `npm run check:applovin`, and final package string checks for the CTA world anchor passed. Sandboxed `npm run build` still hit Windows `spawn EPERM` before the elevated rerun passed.

## 2026-07-08 CTA world-anchored positioning

- Changed CTA positioning so the DOM button is anchored by fixed scene/world coordinates (`cta.worldX/Y/Z`) and projected through the active Three.js camera, while the old design-space `cta.x/y` remains as a fallback.
- Added editor controls for the CTA world anchor and synced the exported tuning JSON; the default anchor preserves the current visual placement at `worldX 0`, `worldY 0`, `worldZ 10.2604`.
- Verification: `node --check` passed for `src/main.js`, `src/scene-view.js`, `src/scene-tuning.js`, `src/scene-editor.js`, and `test/game-model.test.js`; `artifacts/scene-tuning.json` parsed successfully; elevated targeted `main thread saves` coverage passed. The paired `editor sizing` target still hits the existing background-dimension assertion (`65536 !== 2100`).

## 2026-07-08 CTA center-relative AppLovin package

- Regenerated the AppLovin single-HTML package after the CTA center-relative positioning logic update; final output is `artifacts/applovin/index.html` from Vite bundle `index-CGzi8wTG.js`.
- Verification: sandboxed `npm run build` still hit Windows `spawn EPERM`, elevated `npm run build` passed with the existing Vite `>500 kB` chunk warning, then `npm run package:applovin`, `npm run check:applovin`, built bundle `node --check`, and final package string checks for CTA config/store routing passed. Final single HTML is 3,065,418 bytes (2.923 MiB).

## 2026-07-08 CTA center-relative positioning logic

- Changed CTA runtime positioning so `cta.x/y` are resolved as offsets from the 1080x2160 design center and then applied to the actual stage center, preventing device aspect/height changes from shifting the button by top-left anchoring.
- No package was regenerated for this logic-only update.
- Verification: `node --check src/main.js`, `node --check test/game-model.test.js`, direct position math checks, and elevated targeted `node --test --test-name-pattern "main thread saves" test/game-model.test.js` passed. Sandboxed targeted Node test still hit Windows `spawn EPERM` before the elevated rerun passed.

## 2026-07-08 CTA screenshot tuning package refresh

- Applied the screenshot CTA tuning values to `src/scene-tuning.js` and `artifacts/scene-tuning.json`: `x 540`, `y 1981`, `height 140`, `stretchX 2.83`, `fontSize 59`, `fontHeight 100`, `strokeWidth 2.9`, `pulseScale 1.15`, and `pulseSpeed 0.21`; stroke color was intentionally left unchanged.
- Regenerated `artifacts/applovin/index.html` from Vite bundle `index-BHpnsInC.js`; final single HTML is 3,065,333 bytes (2.923 MiB).
- Verification: `node --check src/scene-tuning.js`, `node --check test/game-model.test.js`, `artifacts/scene-tuning.json` parse check, elevated `npm run build`, `npm run package:applovin`, `npm run check:applovin`, direct `SCENE_TUNING.cta` import check, and final package string checks passed. The targeted `editor sizing` test still reaches an unrelated existing background-dimension assertion before CTA checks (`65536 !== 2100`).

## 2026-07-08 install gate real-device gesture fix

- Changed the 10-vehicle install gate so the 10th successful vehicle dispatch calls `InstallFullGame()` immediately inside the same pointer/user gesture, while arrival-state scanning remains as a non-duplicating fallback.
- Regenerated `artifacts/applovin/index.html` from Vite bundle `index-9-PiTtp-.js`; final single HTML is 3,065,334 bytes (2.923 MiB).
- Verification: `node --check src/main.js`, `node --check test/game-model.test.js`, elevated targeted `node --test --test-name-pattern "main thread saves" test/game-model.test.js`, elevated `npm run build`, `npm run package:applovin`, and `npm run check:applovin` passed. Sandboxed targeted test and build still hit Windows `spawn EPERM` before elevated reruns passed.

## 2026-07-08 iOS AppLovin store jump hardening

- Changed store routing so iOS MRAID clicks first open `itms-apps://itunes.apple.com/app/id6746743297`, then fall back to the Apple web URL on later attempts; Android keeps the Google Play URL.
- Replaced the one-time `hasOpenedStore` lock with a short click cooldown so a silently blocked first iOS attempt does not make later CTA/install-gate taps inert. iPadOS detection now also handles `Macintosh` touch user agents.
- Regenerated `artifacts/applovin/index.html` from Vite bundle `index-CuqeIwdT.js`; final single HTML is 3,094,762 bytes (2.951 MiB).
- Verification: `node --check src/main.js`, `node --check scripts/check-applovin-package.mjs`, `node --check test/game-model.test.js`, elevated targeted `node --test --test-name-pattern "main thread saves" test/game-model.test.js`, elevated `npm run build`, `npm run package:applovin`, and `npm run check:applovin` passed. The checker now includes an iOS direct-scheme assertion.

## 2026-07-08 CTA design-coordinate positioning

- Changed CTA tuning from bottom/safe-area anchoring to design-coordinate center positioning with configurable `cta.x` and `cta.y`; added separate `cta.fontHeight` control for text line-height independent of font size.
- Updated editor controls, source tuning, exported tuning JSON, and source-contract assertions. No package was regenerated for this change.
- Verification: `node --check src/main.js`, `node --check src/scene-tuning.js`, `node --check src/scene-editor.js`, `node --check test/game-model.test.js`, elevated targeted `node --test --test-name-pattern "main thread saves" test/game-model.test.js`, and `artifacts/scene-tuning.json` parse check passed.

## 2026-07-08 height-lock 14.9 trial package

- Changed `calculateDesignCoverHalfHeight()` back to fixed visible-height behavior for the current device test: all viewport aspects use `camera.fitHeight` as the vertical visible height, so `fitHeight: 14.9` stays 14.9 on short and tall screens while wider screens only reveal more horizontal content.
- Regenerated `artifacts/applovin/index.html` from fresh Vite bundle `index-DEayjv3w.js`.
- Verification: `node --check src/scene-layout.js`, `node --check test/scene-layout.test.js`, elevated `node --test test/scene-layout.test.js`, direct math checks, elevated `npm run build`, `npm run package:applovin`, and `npm run check:applovin` passed. Final single HTML is 3,057,989 bytes (2.916 MiB), contains the fixed-height helper `return Math.max(.01,Number(fitHeight)/2||.01)` in minified form, keeps production preview-frame disabled, and contains no production `localStorage.getItem`.

## 2026-07-08 production preview-frame bypass for responsive camera

- Fixed the final package path that prevented responsive camera math from taking effect: `applyPreviewFrame()` now enables the 1080x2160 phone preview frame only in Vite dev/editor mode, so production/AppLovin keeps `#stage` full-screen and `SceneView.resize()` reads the real device/container aspect instead of a forced design-aspect preview box.
- Regenerated `artifacts/applovin/index.html` from fresh Vite bundle `index-B5E56wTh.js`.
- Verification: `node --check src/main.js`, `node --check test/game-model.test.js`, elevated targeted `node --test --test-name-pattern "main thread saves" test/game-model.test.js`, elevated `npm run build`, `npm run package:applovin`, and `npm run check:applovin` passed. Final single HTML is 3,058,131 bytes (2.916 MiB), contains no production `localStorage.getItem`, and the minified production flag used for `is-phone-preview` is `false`.

## 2026-07-08 short-screen design-cover zoom-out restored

- Changed `calculateDesignCoverHalfHeight()` so screens wider than the 1080x2160 design aspect increase camera visible height by `viewportAspect / designAspect`, making short/wide devices zoom out and reveal a wider authored scene instead of staying height-locked and enlarged.
- Regenerated `artifacts/applovin/index.html` from fresh Vite bundle `index-D4kfUfRI.js`.
- Verification: `node --check src/scene-layout.js`, `node --check test/scene-layout.test.js`, elevated `node --test test/scene-layout.test.js`, direct math checks, elevated `npm run build`, `npm run package:applovin`, and `npm run check:applovin` passed. Final single HTML is 3,058,135 bytes (2.916 MiB). The 612x916 case now computes visible height 19.91 and visible width 13.30.

## 2026-07-08 production tuning-cache bypass and AppLovin refresh

- Changed production/AppLovin startup so editor `localStorage` tuning is ignored outside Vite dev mode; the delivery package now uses only the baked `src/scene-tuning.js` values, avoiding stale device/platform preview cache overriding camera adaptation changes.
- Regenerated `artifacts/applovin/index.html` from fresh Vite bundle `index-Dt9kM1QW.js`.
- Verification: `node --check src/main.js`, `node --check test/game-model.test.js`, elevated targeted `node --test --test-name-pattern "main thread saves" test/game-model.test.js`, elevated `npm run build`, `npm run package:applovin`, and `npm run check:applovin` passed. Final single HTML is 3,057,993 bytes (2.916 MiB) and contains no production `localStorage.getItem` tuning reads.

## 2026-07-08 fresh-build AppLovin package after height-lock adaptation

- Regenerated `artifacts/applovin/index.html` from a user-run fresh Vite build bundle `index-BluE9YwH.js`, replacing the earlier package produced from a patched `dist` bundle.
- Verification: `node --check dist/assets/index-BluE9YwH.js`, `npm run package:applovin`, `npm run check:applovin`, and a manual `node --check` of the final inline module passed. Final single HTML is 3,058,707 bytes (2.917 MiB) and contains the height-lock helper `return Math.max(.01, Number(fitHeight) / 2 || .01)`, `camera.fitHeight` 14.9, and the latest CTA config.

## 2026-07-08 height-lock camera adaptation correction

- Changed `calculateDesignCoverHalfHeight()` to pure height-lock behavior: `camera.fitHeight` stays as the vertical visible height for all viewport aspects, so wider/shorter screens reveal more horizontal content without changing camera distance.
- Synced the current built bundle and regenerated `artifacts/applovin/index.html`; final single HTML is 3,058,843 bytes (2.917 MiB).
- Verification: `node --check src/scene-layout.js`, direct math checks, `node --check dist/assets/index-CA9mrv8c.js`, `npm run package:applovin`, `npm run check:applovin`, and a manual `node --check` of the final inline module passed. With `fitHeight` 14.9, visible height stays 14.9 at 1080x2160, 1080x1920, 720x1280, 1080x2400, and 1440x3200. Sandboxed `node --test test/scene-layout.test.js` remains blocked by Windows `spawn EPERM`.

## 2026-07-08 design-cover short-screen zoom-out correction

- Corrected `calculateDesignCoverHalfHeight()` so viewports wider than the 1080x2160 design aspect now zoom out with `baselineHalfHeight * viewportAspect / designAspect` instead of zooming in.
- Synced the current built bundle and regenerated `artifacts/applovin/index.html`; final single HTML is 3,058,853 bytes (2.917 MiB).
- Verification: `node --check src/scene-layout.js`, direct math checks, `node --check dist/assets/index-CA9mrv8c.js`, `npm run package:applovin`, `npm run check:applovin`, and a manual `node --check` of the final inline module passed. With `fitHeight` 14.9, visible heights are 14.9 at 1080x2160, 16.7625 at 1080x1920, 16.7625 at 720x1280, and 14.9 at 1080x2400. Sandboxed `node --test test/scene-layout.test.js` remains blocked by Windows `spawn EPERM`.

## 2026-07-08 CTA final package tuning refresh

- Updated CTA tuning to bottom `46`, height `113`, stretchX `2.95`, font size `47`, stroke width `2.9`, pulse scale `1.09`, and pulse speed `0.21` in `src/scene-tuning.js`, `artifacts/scene-tuning.json`, the current built bundle, and the AppLovin package.
- Verification: `node --check src/scene-tuning.js`, `node --check dist/assets/index-CA9mrv8c.js`, `npm run package:applovin`, `npm run check:applovin`, and a manual `node --check` of the final inline module passed. Final `artifacts/applovin/index.html` is 3,058,853 bytes (2.917 MiB) and contains the new CTA config with no old CTA config present.

## 2026-07-08 AppLovin loading 0% package fix

- Fixed the bad AppLovin package that stayed at 0% loading: the previous package had corrupted inline JS around non-ASCII end-panel text after direct bundle editing. Rebuilt from source, changed the end-panel title text in `src/main.js` to ASCII English, and regenerated `artifacts/applovin/index.html`.
- Hardened `scripts/check-applovin-package.mjs` with an inline module syntax check so corrupted inlined JS fails static validation before upload.
- Verification: user reran `npm run build`, then `npm run package:applovin` and `npm run check:applovin` passed. Additional manual extraction of the final inline module from `artifacts/applovin/index.html` passed `node --check`. Final single HTML is 3,058,850 bytes (2.917 MiB) and contains `camera.fitHeight` 14.9 plus the design-cover logic.

## 2026-07-08 camera fitHeight 14.9 AppLovin refresh

- Updated editor/exported camera tuning so `camera.fitHeight` is `14.9` in `src/scene-tuning.js`, `artifacts/scene-tuning.json`, and the current built `dist` bundle used for packaging.
- Regenerated `artifacts/applovin/index.html`; final single HTML is 3,058,846 bytes (2.917 MiB).
- Verification: `node --check src/scene-tuning.js`, `npm run package:applovin`, and `npm run check:applovin` passed. Final HTML contains `fitWidth:14.8,fitHeight:14.9,padding:.35`, keeps the design-cover `designWidth/designHeight` logic, and no longer contains the old `fitHeight:19.4` camera config.

## 2026-07-08 design-cover camera adaptation and AppLovin refresh

- Changed the crop-enabled camera adaptation to use the 1080x2160 design frame as a height-locked cover baseline: `camera.fitHeight` now controls visual scale, while `sourceCrop` keeps only background/target offset behavior and no longer zooms the camera out on short screens.
- Regenerated `artifacts/applovin/index.html` from the user-built `dist` bundle `index-CcEAXRhs.js` at 2026-07-08 16:29. Final single HTML is 3,058,846 bytes (2.917 MiB).
- Verification: `npm run package:applovin` and `npm run check:applovin` passed. Final HTML contains the compressed design-cover formula with `designWidth: 1080`, `designHeight: 2160`, `fitHeight: 19.4`, and fixed `shortScreenScale: 1`; the old short-screen crop constants `1366.875` and `1.125` are absent.

## 2026-07-08 short-screen camera fit fix and AppLovin refresh

- Fixed the short-screen adaptation so responsive source crop no longer reduces the authored camera fit bounds; crop-enabled rendering now uses the larger of `camera.fitWidth/fitHeight` and the responsive crop fit.
- Regenerated `artifacts/applovin/index.html` from fresh `dist` bundle `index-D_tbDuwl.js` built at 2026-07-08 15:47. Final single HTML is 3,058,808 bytes (2.917 MiB).
- Verification: `node --check` passed for `src/scene-layout.js` and `src/scene-view.js`; direct layout math check confirms 1080x1920 now keeps camera fit at 14.80 x 19.40 with visible height 26.31 instead of the old 16.32 crop fit; `npm run package:applovin` and `npm run check:applovin` passed, and final HTML contains the short-screen crop, camera max-fit logic, CTA tuning, and Android/iOS store URLs.

## 2026-07-08 AppLovin repackaged for responsive/CTA changes

- Regenerated `artifacts/applovin/index.html` from a fresh `dist` built at 2026-07-08 15:32 after the responsive crop and CTA/store-routing edits.
- Verification: package checks confirm the final HTML contains the responsive crop helper, `sourceCrop` tuning, scaled CTA CSS/JS, CTA tuning values, and Android/iOS store URLs. `npm run package:applovin` and `npm run check:applovin` passed. Final single HTML is 3,058,510 bytes (2.917 MiB).

## 2026-07-08 AppLovin package regenerated after latest local edits

- Regenerated the AppLovin single-HTML package from the current workspace contents at `artifacts/applovin/index.html`.
- Verification: sandboxed `npm run build` was blocked by Windows `spawn EPERM`, elevated `npm run build` passed with the existing Vite `>500 kB` chunk warning, then `npm run package:applovin` and `npm run check:applovin` passed. Final single HTML is 3,058,510 bytes (2.917 MiB).

## 2026-07-08 short-screen responsive crop source update

- Added responsive source-crop fit logic so screens shorter than the 1080x2160 baseline zoom the scene out by increasing the effective crop area, while the 1080x2160 baseline and taller screens keep the authored crop behavior.
- Changed `src/scene-view.js` to consume the shared crop-fit helper from `src/scene-layout.js`; updated layout tests and source-contract assertions for the new path.
- Verification: `node --check src/scene-layout.js` and `node --check src/scene-view.js` passed. Sandboxed `node --test` and `npm run build` are currently blocked by Windows `spawn EPERM`; elevated retries were rejected by the current Codex usage limit, so AppLovin package regeneration is still pending.

## 2026-07-08 Android/iOS store routing update

- Updated store routing in `src/main.js` to use the provided Android URL `https://play.google.com/store/apps/details?id=gridplus.busjam.carpuzzle` and iOS URL `https://apps.apple.com/app/id6746743297`.
- Added iOS detection for iPhone/iPad/iPod and touch-capable iPadOS-on-Mac user agents, plus a single `openStore()` path with duplicate open protection for CTA and install-gate clicks.
- Updated the AppLovin package URL allowlist for both store URLs and regenerated `artifacts/applovin/index.html`; final single HTML is 3,058,510 bytes (2.917 MiB).
- Verification: `node --check src/main.js`, `node --check scripts/check-applovin-package.mjs`, elevated targeted `node --test --test-name-pattern "main thread saves" test/game-model.test.js`, elevated `npm run build`, `npm run package:applovin`, and `npm run check:applovin` passed.

## 2026-07-08 AppLovin MRAID ready/default startup gate

- Added an explicit MRAID startup gate in `src/main.js`: local preview starts immediately when `window.mraid` is absent, AppLovin `loading` state waits for the `ready` event, and `default` or other already-available states start the runtime without delay.
- Updated the AppLovin static checker to fail final packages that only include `mraid.open` but lack the ready/default wait evidence, then regenerated `artifacts/applovin/index.html`.
- Verification: `node --check src/main.js`, `node --check scripts/check-applovin-package.mjs`, elevated targeted `node --test --test-name-pattern "main thread saves" test/game-model.test.js`, elevated `npm run build`, `npm run package:applovin`, and `npm run check:applovin` passed. Final single HTML is 3,057,660 bytes (2.916 MiB).

## 2026-07-08 CTA design-space scaling fix

- Changed CTA sizing so editor values such as height, bottom, font size, stroke width, and padding are treated as 1080-wide design-space values and scaled by the rendered stage width in both editor preview and production packages.
- Regenerated `artifacts/applovin/index.html`; final single HTML is 3,057,338 bytes (2.916 MiB).
- Verification: `node --check src/main.js` and AppLovin scripts passed; elevated `npm run build` passed after sandboxed Vite hit Windows `spawn EPERM`; `npm run package:applovin`, `npm run check:applovin`, elevated targeted `node --test --test-name-pattern "main thread saves" test/game-model.test.js`, and localhost browser preview passed. In the 342px-wide preview stage, the CTA now renders at about 65.6 x 22.0px instead of using the raw 203 x 68px design values.

## 2026-07-08 final AppLovin package refreshed with tuned web config

- Re-exported the adjusted web editor config from Edge localStorage key `bus-loop-scene-tuning-v3` into `artifacts/scene-tuning.json`, applied it to `src/scene-tuning.js`, then regenerated `artifacts/applovin/index.html`.
- Key applied values include camera elevation `61`, FOV `2.2`, target Z `1.8`, source crop offset Y `211`, CTA bottom `12`, CTA stretch X `2.98`, vehicle position scale `0.75`, and vehicle model scale `0.7`.
- Verification: `node --check` passed for tuning and AppLovin scripts; elevated `npm run build` passed after sandboxed Vite hit Windows `spawn EPERM`; `npm run package:applovin` and `npm run check:applovin` passed. Final single HTML is 3,056,955 bytes (2.915 MiB), contains no scene editor markers, includes the adjusted tuning values, and rendered successfully via localhost preview with no error-level console logs.

## 2026-07-08 AppLovin editor removal and tuning export path

- Changed `src/main.js` so the scene editor is loaded only in Vite dev mode; production/AppLovin runtime removes the editor mount and does not include editor code.
- Updated `scripts/package-applovin-single-html.mjs` to strip the editor mount and editor CSS from the AppLovin single HTML.
- Added `scripts/apply-scene-tuning.mjs` plus `npm run apply:tuning` so exported editor/localStorage tuning JSON can be merged into `src/scene-tuning.js` before production packaging.
- Verification: `node --check` passed for touched JS files; elevated `npm run build`, `npm run package:applovin`, `npm run check:applovin`, extracted inline-JS `node --check`, and browser preview passed. Final `artifacts/applovin/index.html` is 3,056,343 bytes and contains no `scene-editor`/editor UI markers.

## 2026-07-08 AppLovin single-HTML loading fix

- Fixed `scripts/package-applovin-single-html.mjs` so inlined CSS/JS insertion uses function replacers; this prevents minified `$&` sequences from being expanded into the matched `</head>` text and corrupting the module script.
- Regenerated `artifacts/applovin/index.html`; current single package is 3,073,516 bytes (2.931 MiB).
- Verification: `node --check scripts/package-applovin-single-html.mjs`, elevated `npm run build`, `npm run package:applovin`, `npm run check:applovin`, and extracted inline-JS `node --check` passed. Browser HTTP preview no longer stays on the 0% loading page and reaches the rendered game scene.

## 2026-07-08 MP3 audio switch and build size check

- Switched runtime audio references in `src/level-data.js` from WAV to the matching MP3 files under `public/assets/unity/audio`.
- Verification: `node --check src/level-data.js` passed; `npm run build` passed with the existing Vite `>500 kB` chunk warning after sandboxed build hit Windows `spawn EPERM`.
- Current `dist` output is 4,012,063 bytes across 51 files and includes only MP3 audio, so it is under the 5MB package-size limit but is not yet the AppLovin single-HTML/inline-resource final delivery format.

## 2026-07-08 install gate after successful vehicle arrivals

- Added AppLovin install gate state in `src/main.js`: count unique vehicles that have reached a parking spot from snapshot state as `numberCountBus`, set `isFinish` after `maxNumberCountBus = 10`, and route the next canvas click through `InstallFullGame()`.
- `InstallFullGame()` shares the CTA store open path and calls `mraid.open(...)` when available; CTA clicks stop propagation and open the store directly.
- Replaced the earlier `vehicle-arrived` event-only counter because later same-frame gameplay events can overwrite `lastEvent` before the UI sees it.
- Verification: `node --check src/main.js` and `node --check test/game-model.test.js` passed; elevated targeted `node --test --test-name-pattern "main thread saves" test/game-model.test.js` passed after sandboxed Node hit `spawn EPERM`.
## 2026-07-08 CTA button and AppLovin MRAID open

- Added the bottom CTA button using `Main_Prop_GreenBtn.png`, with configurable horizontal stretch, text size, text outline, and pulse animation.
- Fixed CTA hover so the global button hover style does not clear the image background.
- CTA clicks now call `mraid.open('https://play.google.com/store/apps/details?gl=US&hl=en-US&id=gridplus.busjam.carpuzzle')` when available, with `window.open` only as local-preview fallback.
- Verification: `node --check src/main.js`, `src/scene-tuning.js`, `src/scene-editor.js`, and `test/game-model.test.js` passed; elevated targeted `node --test --test-name-pattern "editor sizing|main thread saves" test/game-model.test.js` passed after sandboxed Node hit `spawn EPERM`.
- Added a passenger material mode switch: default `unityTexture` keeps the existing Unity color texture restoration, while `solidColor` drives passenger color from one configured hex per color index without assigning color texture maps. VAT animation texture usage remains unchanged.
- Verification: `node --check` passed for `src/scene-view.js`, `src/scene-tuning.js`, `src/scene-editor.js`, `src/main.js`, and `test/game-model.test.js`; elevated targeted `node --test --test-name-pattern "editor sizing|main thread saves" test/game-model.test.js` passed after sandboxed Node test runner hit `spawn EPERM`.
- Optimized passenger color picking/editing: passenger material `needsUpdate` now only fires when texture map state changes, single color-index edits only refresh matching passenger materials, and scene tuning saves are debounced with a final `beforeunload` flush.
- Verification: `node --check` passed for `src/scene-view.js`, `src/scene-tuning.js`, `src/scene-editor.js`, `src/main.js`, and `test/game-model.test.js`; elevated targeted `node --test --test-name-pattern "editor sizing|main thread saves" test/game-model.test.js` passed after sandboxed Node test runner hit `spawn EPERM`.

## Completed On 2026-07-07

- Imported the active level layout from the level12 source data: 94 vehicles, two 219-group fixed queues, authored blocker lists, and initial movable vehicles `1, 4, 34, 51`.
- Added gameplay/audio parity for collision, passenger boarding, and full-vehicle departure sounds using Unity-named audio assets.
- Improved passenger entrance motion by reusing the full queue-entry path for non-initial refills.
- Added or tuned vehicle departure path controls, full-load delay, count-board decrement behavior, and placeholder passenger visibility.
- Added Effect_Hit and Effect_SmokeTrail parity, then kept authored fake shadows as the active shadow solution after removing the heavier real-time shadow-map path.
- Added directional-light/editor controls, passenger material controls, vehicle arrow outline controls, and Map Scale editor naming.
- Restored bus/van fake shadow sizing and removed the bottom operation toast while preserving gameplay events/audio/end panel.

## Current Verification State

- Many touched files passed `node --check` during the 2026-07-07 sessions.
- Several targeted tests passed with elevated execution where sandboxed Node child process spawning hit `EPERM`.
- Some full test/build runs passed with the existing Vite `>500 kB` chunk warning.
- Later queue/conveyor full-suite verification was blocked by existing blocker-test expectation failures and then by usage-limit rejection for elevated build execution.

## Current Risks / Open Follow-Up

- Re-check current full `node --test` when the environment allows child-process spawning reliably.
- Revisit existing blocker expectation failures around querying blockers while a vehicle is colliding.
- Manually compare current level12 gameplay, passenger entry, effects, audio timing, fake shadows, and material colors against Unity reference.
- Keep platform packaging paused until the AppLovin baseline visual/playability pass is accepted.

## Archive

Full 2026-07-07 progress log was archived to:

- `docs/project/archive/playable-project-progress.full-2026-07-08.md`


