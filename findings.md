# Findings

## 2026-08-11 Level10 Sakura repackage

- Current Level10 package source/export background is `/assets/applovin/textures/BG02_split01_summer_q60.jpg`.
- Target background is the existing 278,157-byte `/assets/applovin/textures/BG01_split01_Sakura_q60.jpg`; the 1,976,289-byte source PNG remains excluded.
- `scripts/generate-active-level.mjs` already overwrites the generated session manifest with `SCENE_TUNING.background.asset`, so after apply/generate the final entry should reference Sakura only.
- Update the exact Level10 package cache migration from summer to Sakura so prior saved defaults cannot visually override the new baked background in development.
- Source, exported tuning, and selected marker now agree on Level10 with Sakura q60; Level10/39, CTA 1, threshold 10, disabled first-click mask, and DualQueue3 remain unchanged.
- The selected Sakura delivery asset exists at 278,157 bytes. Main/test syntax checks pass.
- First focused background run exposed a real mismatch: `SCENE_TUNING.background.asset` is Sakura but runtime `LEVEL_1.assets.background` is still summer after generation. Catalog/guide/cache-migration checks otherwise pass.
- Direct inspection shows `src/generated-active-level.js` and a fresh module import both contain Sakura correctly. The failed assertion observed the mutable `LEVEL_1` binding after shared test-module state, not a stale generated artifact.
- The background production assertion should use immutable `ACTIVE_LEVEL.assets.background` rather than the mutable runtime `LEVEL_1` binding; runtime texture swapping remains separately covered by the existing source contract.
- The broader sizing regression used PNG fixed offsets (`readUInt32BE(16/20)`) on a JPEG and therefore returned 65536 instead of 2100. Replace it with a format-aware PNG/JPEG dimension reader so the 2100x3382 assertion remains meaningful.
- The format-aware parser succeeds and reaches later assertions; the same broad historical test then fails on unrelated parking spot count `6 !== 5`. Preserve the user's current parking tuning and place exact image dimensions in the focused background test instead.
- Final focused verification passes 5/5: optimized Sakura selection and 2100x3382 dimensions, exact saved-default migration, Level10-only active payload, Level10 vehicle 39, and guide/mask state.
- Final AppLovin HTML is 4,192,202 bytes and passes all 15 checks. It contains only the Sakura q60 byte payload; summer q60, winter q60, and the original Sakura PNG are absent.
- Final package markers retain Level10, guide vehicle 39, CTA enabled, and threshold 10. SHA-256 is `CA7BAF4EC5645B14CEB7F95058D051EEC87653DF1F38BC2630CC499AB2BC2A63`.

## 2026-08-11 Level10 guide-39 CTA package

- Requested baked values: Level10, guide level 10, guide vehicle id 39, CTA enabled, and store redirect after 10 successful operations.
- Prior package work synchronizes both the normal guide and disabled first-click guide scope/target together while preserving `firstClickGuide.enabled`; follow the same established behavior unless the user explicitly asks to enable the mask.
- AppLovin remains the project baseline: single fully inlined HTML, <= 5,000,000 bytes, MRAID CTA, and all 15 existing static checks.
- `artifacts/selected-level.txt` is already `level10`, likely from the editor selection, while `src/scene-tuning.js` and `artifacts/scene-tuning.json` still declare `level16`; the package inputs must be synchronized before generation.
- CTA is already enabled (`cta.enabled = 1`) in both source and exported tuning. Preserve it at `1` and add explicit verification rather than changing unrelated CTA geometry.
- Current package values still use threshold `30`, normal guide `level16/45`, disabled first-click guide `level16/45`, and `firstClickGuide.enabled = 0`.
- `src/main.js` contains a saved-editor migration from the prior Level15/157/40 defaults to Level16/45/30. This package needs a narrow next migration so exact Level16/45/30 cached defaults move to Level10/39/10 without overwriting unrelated custom tuning.
- Level10 contains visible vehicle 39: 6 seats, color index 0, position `(1.1570295, 1.502522)`, yaw about 45 degrees. Level10 has 64 vehicles and authored queues 218+218.
- Exact editable package fields are `level.selected`, `vehicleGuideHand.levelKey/vehicleId`, `firstClickGuide.levelKey/vehicleId`, `cta.enabled`, and `installGate.successfulOperationThreshold`. Preserve every other tuning value.
- The source/exported first-click mask is disabled and remains disabled. The normal guide remains enabled.
- Source, exported tuning, and selected-level marker now agree exactly on Level10. CTA is `1`, threshold is `10`, normal guide is `level10/39/enabled`, and first-click guide is `level10/39/disabled`.
- Unrequested durable values remain unchanged in the structured comparison, including summer background and `dualQueue3` conveyor layout.
- Syntax checks pass for `src/main.js` and the three touched test files.
- Active generation now emits exactly Level10 with 64 vehicles and queues 218+218; no Level9 -> Level7 expansion applies.
- Five focused checks pass: guide target/mask state, selected-session boundary, Level10 vehicle 39, saved-cache migration contracts, and threshold-10 store redirect wiring.
- The final AppLovin package contains only the Level10 session, includes vehicle 39, and carries `level10/39`, CTA enabled, and threshold 10 markers; Level16 and Level9 payload markers are absent.
- Final artifact size is 3,972,962 bytes, leaving 1,027,038 bytes under the strict limit. SHA-256 is `BA8EC8CD23FDF2104E0314488AFC963C7A3348D4AF28AD556F75B2F33261447B`.

## 2026-08-11 Sakura background packaging

- The supplied asset already exists at `public/assets/applovin/textures/BG01_split01_Sakura.png` and is intended to become a third editor background option.
- The current project already records a winter/summer selector and confirms the final AppLovin package embeds only the optimized selected summer image, so the implementation should extend that established selection boundary rather than introduce a parallel asset-loading path.
- Session catch-up automation was unavailable because this Windows environment exposes neither `python` nor `py`; the current planning files and targeted repository reads are the recovery source.
- Current ownership is `src/scene-tuning.js` for the selected asset, `src/scene-editor.js` for the option list, `src/scene-view.js` for live texture swapping, and `scripts/generate-active-level.mjs` plus the level asset manifest for the production-only selection boundary.
- `BG01_split01_Sakura.png` is 1,976,289 bytes. Replacing the currently embedded 195,940-byte summer JPEG in the latest 3,968,019-byte package without optimization would push the package well above AppLovin's 5,000,000-byte limit.
- The source PNG should remain untouched while a dimension-preserving optimized delivery derivative is added and referenced by the editor option.
- The existing editor options point to `BG01_split01_q60.jpg` (139,386 bytes) and `BG02_split01_summer_q60.jpg` (195,940 bytes); Sakura should follow the same optimized-derivative naming and size pattern.
- `scripts/generate-active-level.mjs` serializes only the selected catalog level (plus the explicit Level9 follow-up case) and shares identical asset manifests. It does not independently override the background from tuning, so the apply/export synchronization path must be inspected before editing.
- Runtime switching is already generic: `getSelectedBackgroundUrl()` prefers `SCENE_TUNING.background.asset`, and the view reapplies that texture during tuning changes.
- `scripts/apply-scene-tuning.mjs` updates `src/scene-tuning.js` and the selected-level marker only; it does not update `src/level-catalog.js`.
- `scripts/generate-active-level.mjs` currently serializes the catalog asset manifest unchanged. When a non-summer background is baked into tuning, the production JS can therefore retain both the selected tuning URL and the catalog's summer fallback URL.
- The narrow fix is to clone each selected session level during generation and overwrite `assets.background` with `SCENE_TUNING.background.asset`. Runtime behavior stays unchanged, but both the tuning and generated manifest then reference the same single background.
- AppLovin packaging enumerates all built assets but only substitutes URLs present in the inlined entry HTML/JS/CSS. Preventing extra background URLs from entering production source is sufficient to keep unused editor alternatives out of the final HTML.
- A q60 progressive JPEG derivative was generated at `public/assets/applovin/textures/BG01_split01_Sakura_q60.jpg`: 2100x3382, 278,157 bytes. Visual inspection preserves the supplied composition and major edge/detail readability while keeping the expected package increase manageable.
- Touched source/test syntax checks pass, as do the focused background selector and active-level generator contract tests.
- With a temporary baked Sakura selection, prebuild generated the current durable selected Level5 payload with its background manifest overwritten to Sakura. The production build passed with only the existing Vite chunk-size warning.
- The temporary Sakura AppLovin HTML is 4,191,471 bytes and passes all 15 static checks, leaving 808,529 bytes under the strict limit.
- Final HTML contains no original asset filenames because the packager replaces referenced URLs with data URIs; byte-content fingerprints are required for the definitive selected-only assertion.
- Base64 byte fingerprints confirm the temporary Sakura package embeds only `BG01_split01_Sakura_q60.jpg`; summer, winter, and the original Sakura PNG are absent.
- After restoring the summer default, the refreshed final package embeds only `BG02_split01_summer_q60.jpg`; Sakura, winter, and the original PNG are absent.
- Browser DOM QA at the local editor shows exactly three background options: `BG01 \u51ac\u5b63`, selected `BG02 \u590f\u5b63`, and `BG01 \u6a31\u82b1`.
- Selecting `BG01 \u6a31\u82b1` in the real editor immediately changes the phone preview to the supplied Sakura artwork. The select value resolves to `/assets/applovin/textures/BG01_split01_Sakura_q60.jpg`, and browser error logs remain empty.
- The final restored selection remains Level5 + summer in source/exported/generated state. Final AppLovin size is 3,972,231 bytes with SHA-256 `3300A5FDC1045513203224648AB414AB472E5C490CC6C2D873817DE9C060196F`.
- The current worktree was already broadly dirty across level, tuning, editor, runtime, tests, and generated artifacts. This task preserved those changes and only added the Sakura derivative/option, generator background override, focused contracts, regenerated current artifacts, and short durable records.

## 2026-08-03 Level16 guide-45 package

- Level16 contains visible vehicle 45 (`6` seats, color index `2`), so it is a valid guide target.
- The prior guide remained scoped to `level15 + vehicle 157`; changing only the id would keep the guide hidden on the current Level16 package. Both normal and disabled first-click guide configs therefore need `level16 + vehicle 45`.
- Editor localStorage may still contain the exact prior guide pair. The existing saved-default migration now upgrades `level15 + 157` to `level16 + 45` for both guide configs without changing offsets, scale, speed, mask settings, or first-click enabled state.
- The refreshed final package is 3,968,019 bytes and leaves 1,031,981 bytes under the strict limit. Both guide configs contain `levelKey: "level16", vehicleId: 45`; the first-click guide remains disabled.
- All 15 AppLovin static checks pass. Only the optimized summer q60 background is embedded, and the final SHA-256 is `7E4C981851EFC8F3F13371E2ED6109553D6327FCA04585507AE9909391FBA7CF`.

## 2026-08-03 Level16 parameter package

- Requested production values map to `level.selected = level16`, `background.asset = BG02_split01_summer_q60.jpg`, `installGate.successfulOperationThreshold = 30`, `vehiclePath.parkingBounds.minX/maxX = -2.2/2.2`, and `vehicleArea.positionUnitScale/modelScale = 0.8/0.7`.
- The optimized summer background is already the baked source/export asset, so this package does not need another image conversion or duplicate background asset.
- Current pre-change values are Level15, threshold 40, path X bounds -2.53/2.53, map scale 0.73, and vehicle model scale 0.63. `artifacts/scene-tuning.json` is the authoritative patch input for `npm run apply:tuning`, which also synchronizes `src/scene-tuning.js` and `artifacts/selected-level.txt`.
- Selecting Level16 generates a single-level production payload; the special Level9 -> Level7 session expansion does not apply.
- Final generated session is exactly `['level16']` with 37 vehicles and queues 139+79. The production build passes with only the existing >500 kB chunk warning.
- Final AppLovin single HTML is 3,968,021 bytes with 1,031,979 bytes remaining under the strict limit. All 15 static checks pass and marker scans confirm Level16, threshold 30, path X -2.2/2.2, map scale 0.8, model scale 0.7, and `You Win!`.
- Binary embedding verification confirms the package contains the q60 summer background and contains neither the 1,035,562-byte summer source nor the winter background. SHA-256 is `9B6B584D7E58765471B1EDEA4F8CF6C455A41C23873133A9D3D0BAFD5644A201`.
- Existing browser tabs can retain the complete prior editor tuning in localStorage and override new source defaults. A development-only migration now upgrades only exact previous package defaults (Level15/40/-2.53/2.53/0.73/0.63); production excludes this path and the rebuilt package remains byte-identical.

## 2026-08-03 editor final-level freeze

- `BusLoopGame.checkEndState()` correctly sets `status = 'won'` only after every vehicle is `done` and no passengers remain, so the model is not deadlocked.
- `main.js` then always hides `#end-panel`; when there is no next session level it also leaves `showResultOverlay('You Win!')` disabled. The final editor frame therefore has no replay or next action even though the runtime has completed normally.
- Follow-up requirement supersedes the simple replay-panel approach: final victory should reuse `showResultOverlay()` so the existing icon, title animation, CTA art, and store bridge are shared with the failure state; only the title changes to `You Win!`.
- The final implementation calls `showResultOverlay('You Win!')` only after `advanceAfterWin()` returns no next level. Intermediate Level9 -> Level7 completion still reconstructs Level7 and returns before the overlay call.
- Browser DOM inspection confirms one shared result title, one `Play Now` CTA, and one `/assets/main-loading-icon.png` logo; no error-level console logs were reported.

## 2026-08-03 editor layout-switch queue mismatch

- Level16 source/catalog data is already validated at 218 seats and 218 authored passengers with exact per-color parity, so do not alter its queue sequences before reproducing a runtime discrepancy.
- Editor `level.selected` changes are saved immediately, persisted through `/__playable-level`, and followed by a full page reload. Startup resolves the selected catalog level, calls `setActiveLevel`, constructs a fresh `BusLoopGame(selectedLevel)`, then initializes queues from that same model level.
- `BusLoopGame.initializeQueues()` rebuilds its visible queues and source queues from `this.level.passengerQueues`; the next diagnostic must count visible queue items, source items, and belt slots together to distinguish a real loss/mix from finite on-screen queue capacity.
- Direct initialization with the current maximum layout capacities preserves exact totals for both Level15 (510) and Level16 (218). Every runtime per-color count matches both authored queues and vehicle seats; only the visible queue heads differ because the rest remain in `sourceQueues` for later refill.
- The current editor is Level15 + DualQueue3. That conveyor layout exposes 22 visible passengers per side, so counting only the on-screen side queues cannot equal the 510-seat vehicle layout.
- The real duplication occurs after passengers enter the belt: non-structural editor changes call `initializeQueues()` with `resetSlots: false`; the old implementation rebuilt both side/source queues from the full authored arrays while retaining occupied belt slots. Level16 therefore grew from 218 to 226 after eight passengers entered the belt.
- Non-reset queue initialization must preserve the current remaining side/source sequence and only recalculate capacity/distance metadata. Explicit `resetSlots: true` keeps the prior full authored reset behavior.

## 2026-08-03 Level16 import discovery

- Supplied source `D:/备份/busloop素材关卡/level16.asset` is a 19,337-byte Unity YAML level file. Its filename yields catalog key `level16`, while its authored internal `id` is `14`; preserve both values rather than rewriting the Unity id.
- The asset declares `mapScale: 0.95` and `conveyorBeltName: ConveyorBelt4`. Vehicle and fixed passenger queue sections are present; exact counts and per-color parity still require structured extraction.
- The request is to add a new layout, not to replace the current production selection. Preserve the existing Level15 selection unless validation reveals an explicit project rule requiring otherwise.
- The existing extractor already derives catalog keys/options from filenames and validates per-color passenger totals. Level16 needs only a new default source entry, regenerated catalog/artifact output, a Vite persistence whitelist entry, and focused catalog coverage; no new editor control subsystem is required.
- Production generation reads `artifacts/selected-level.txt` and emits only the selected session, so keeping that marker at Level15 allows Level16 to be development-selectable without increasing the current AppLovin package.
- Structured parsing finds 37 unique vehicle ids with 218 total seats (`14x4`, `17x6`, `6x10`) and two authored queues of 139 + 79 passengers. Seat and passenger color totals match exactly: `{0:30,1:36,2:44,3:18,5:24,6:20,7:34,8:12}`.
- The source `m_Name` is also `level14`, confirming the filename/internal-name mismatch originates in the supplied asset. Catalog key/display should remain filename-based (`level16`) while provenance fields retain Unity `id: 14`.
- `conveyorBeltName: ConveyorBelt4` exists in the YAML, but the current level extractor/runtime do not store or consume that field; conveyor shape remains the independently selected global editor layout. The user specifically scoped this import to vehicle layout and passenger queues, so no conveyor mapping should be invented.
- Direct runtime-collision diagnostics report zero initial vehicle-body overlaps, every derived yaw is finite, and every authored `vehicleDepthes` reference points to an existing Level16 vehicle id.
- Browser QA confirms Level16 appears after Level15 in the editor, the Vite endpoint accepts the selection, and the reloaded scene visibly renders the new vehicle ring plus both passenger queues on a nonblank 644x1328 canvas with zero error-level console messages.

## 2026-08-03 summer background packaging decision

- The supplied summer JPG is 1,035,562 bytes at 2100x3382. A quality-60 derivative preserves the dimensions and visual composition at 195,940 bytes, so production uses the derivative while retaining the original as the source asset.
- AppLovin packaging replaces only asset URLs present in the production JS/CSS/HTML. Keeping BG01 in the development-only editor options does not embed it in the final package; the verified HTML contains the summer q60 bytes and contains neither the original summer bytes nor BG01 bytes.
- The verified single HTML is 3,979,125 bytes, leaving 1,020,875 bytes under the project's strict 5,000,000-byte limit.

## 2026-07-30 Level15 import discovery

- Supplied source `D:/备份/busloop素材关卡/level15.asset` is a Unity YAML level asset with `id: 15`, `m_Name: level15`, and `conveyorBeltName: ConveyorBelt6`.
- The existing reproducible import boundary is `scripts/extract-unity-levels.mjs`; it owns source paths, exact passenger-queue overrides, per-color seat validation, and generated catalog/artifact output. Focused coverage lives in `test/level-catalog.test.js`.
- The supplied sequences contain 278 left-queue passengers and 232 right-queue passengers (510 total); the Unity asset contains 81 unique vehicles and 510 seats.
- Queue color totals are `{0:86,1:58,2:70,3:54,4:76,5:48,6:62,7:56}` and exactly match the Unity vehicle-seat totals color by color, so the queues are valid as an authoritative override.
- Replacement queue request redistributes the same 510 passengers to 296 left + 214 right while preserving the exact combined color totals `{0:86,1:58,2:70,3:54,4:76,5:48,6:62,7:56}`; no vehicle color/seat changes are required.
- Requested editor/runtime fields map to `vehicleArea.positionUnitScale` (Map Scale), `vehicleArea.modelScale` (vehicle model size), `vehiclePath.parkingBounds.minX/maxX` (drive-path X bounds), and both `vehicleGuideHand` / `firstClickGuide` for guide level and vehicle id.
- Making an imported level the current playable requires synchronizing `src/scene-tuning.js`, `artifacts/scene-tuning.json`, `artifacts/selected-level.txt`, and the Vite development-selection whitelist; Level9-only guide `levelKey` values are separate scope controls and must remain unchanged.
- The former default Level7 path under `D:/UnityProjects/.../Level_Escape_C/level7.asset` has drifted to an unrelated 42-vehicle, color-8 layout. The compatible preserved 83-vehicle source is `D:/备份/改文件名临时文件夹/level7.asset`; the extractor now uses that stable backup so adding Level15 does not rewrite or invalidate Level7.
- The planning skill session-catchup helper cannot run because neither `py` nor `python` is available in this Windows workspace; continue from the existing planning files plus direct workspace inspection.
- Current AppLovin packaging route remains `npm.cmd run build` -> `npm.cmd run package:applovin` -> `npm.cmd run check:applovin`; local completion requires a single fully inlined HTML <= 5,000,000 bytes, while official preview and real-backend play remain external manual acceptance steps.

## Level9 to Level7 session transition - 2026-07-17

- New packaging request: disable only the first-step timed mask (`firstClickGuide.enabled`) while retaining the ordinary Level9 vehicle-114 guide hand, threshold 40, and guide size 2.12.
- `SceneView.updateGuideHand()` suppresses the ordinary sprite only while `firstClickGuide.enabled` is truthy, so setting that flag to `0` both hides the timed DOM mask/hand and restores the normal vehicle guide without runtime code changes.
- Final package markers confirm `firstClickGuide.enabled: 0` and `vehicleGuideHand.enabled: 1`; the new single HTML remains 3,653,268 bytes, passes all AppLovin static checks, and has SHA-256 `041493FEB89FB3714FBF72CEFB2D4E6C7D2CED5006BF166C5412B720FCF83EE5`.
- Current packaging request uses the project's established AppLovin baseline path: baked source/exported tuning -> `npm.cmd run build` -> `npm.cmd run package:applovin` -> `npm.cmd run check:applovin` -> fixed-marker/hash inspection of `artifacts/applovin/index.html`.
- AppLovin delivery remains a single fully inlined HTML using the existing MRAID bridge. Local checks cannot replace AppLovin preview/upload validation.
- Requested baked values are successful-operation threshold 40, both guide targets on Level9 vehicle 114, and `vehicleGuideHand.size` 2.12.
- Initial config inspection confirmed source and exported tuning were synchronized at threshold 20 and guide size 2.52; both already held Level9 vehicle 114 before the requested parameter update.
- The project checker enforces one HTML <= 5,000,000 bytes, inline script syntax, no external script/stylesheet, no WAV, MRAID CTA, no `window.open` fallback, lifecycle/startup markers, and an allowlist for only the Android/iOS store URLs plus W3C namespace references.
- First package generation produced 5,926,059 bytes (5.652 MiB). Every AppLovin checker item passes except the 5,000,000-byte limit, so the remaining work is package-size optimization rather than bridge/runtime correction.
- Level9 and Level7 use the same asset manifest, but the generated session serialized that manifest twice. Because the AppLovin packager replaces every asset URL occurrence with a full data URI, the duplicate manifest repeated the encoded models/textures/audio in the single HTML. The generator can safely share the primary level's asset object with follow-up levels while retaining distinct vehicle/passenger layouts.
- After sharing the manifest, the final single HTML is 3,653,268 bytes and all static checks pass. Marker inspection confirms threshold 40, both Level9 vehicle-114 guide configs, guide size 2.12, and the MRAID-only CTA bridge. SHA-256: `79B7951D936AEBF1D0D5E6340555157607C234A4C641056BB7FB82BFC505745B`.

- Guide follow-up: source/exported tuning still stores vehicle 89 even though the current editor setting is vehicle 114. Persist vehicle 114 in both `vehicleGuideHand` and `firstClickGuide` so production matches the requested current configuration.
- Both guide layers are owned by `SceneView`: the normal sprite uses `vehicleGuideHand`, while the timed DOM mask/hand uses `firstClickGuide`. Level scoping must be checked in both `updateGuideHand()` and `isFirstClickGuideActive()` to guarantee Level7 suppression.
- Add a durable `levelKey: 'level9'` to both guide configs. Saved editor patches that omit this field will preserve the source default through the existing deep merge.
- Vehicle 114 exists in both baked session levels, confirming that id-only lookup will reproduce the guide on Level7 unless the active `LEVEL_1.key` is checked.
- The editor already supports option-backed fields through `LEVEL_OPTIONS`, so both normal and first-click guide scopes can be exposed as level selectors without adding new editor infrastructure.
- Final guide verification passes: the scope helper returns true for Level9 and false for Level7 for both configs; guide/session tests pass 6/6 and the production build succeeds.
- The 749,343-byte final bundle contains `vehicleGuideHand` and `firstClickGuide` as `levelKey: "level9", vehicleId: 114`.

- Follow-up clarification: the conveyor artwork and general passenger/conveyor layout must remain stationary during the Level9-to-Level7 handoff. Only the newly created Level7 vehicle roots should animate upward from below.
- `replaceActiveLevel()` already clears `initialEntryPathStates` and `queueEntryPathStates`; `main.js` then calls `initializeGameQueues({ resetSlots: true })` on a fresh Level7 model. This preserves the existing two-sided `entryMotion` startup path, so no separate passenger animation system is needed.
- The current `layoutRoot` owns conveyor art, spots, passengers, guide, vehicles, and effects; animating it scales/moves all of them. Add a child `vehicleRoot` for vehicle views and animate only that child while leaving `layoutRoot` at its identity transform.
- Ground-plane screen direction is represented by positive world Z toward the lower/near side of the camera, so a vehicle-root Z offset can provide the requested from-below entrance without changing vehicle scales.
- Level7 supplies two queues, capacity 24 per side, entry percents `[0, 0.421]`, and the standard initial-fill metadata. A focused model regression can confirm both entry indices become active after the fresh Level7 queue reset.
- Final implementation uses a dedicated `Vehicle Layout Root` with a positive-Z start offset of 8 and a 0.85-second cubic ease-out to zero. Conveyor art, parking/passenger layout roots, and vehicle scale remain unchanged during the handoff.
- Refined verification passes 13/13 across session/catalog and paired CTA tests. The 749,210-byte production bundle contains the vehicle-only entrance markers, excludes the old scale entrance marker, and retains only Level9/Level7 data.

- The current production boundary is still a generated single active level (`src/generated-active-level.js`); Level7 and Level9 coexist only in the development catalog. A production two-level session therefore needs an explicit second-level payload path instead of relying on editor-only catalog imports.
- `src/main.js` owns the session-wide CTA/install state (`numberCountBus`, `isFinish`, and the counted vehicle set), while its existing `reset()` clears all three. The Level9-to-Level7 handoff must rebuild the game/view without calling that session reset path.
- Current win handling in `syncHud()` hides `#end-panel` and calls `showResultOverlay('You Win!')`; this is the end-page behavior that must be disabled for the intermediate Level9 win and, per request, temporarily suppressed altogether.
- `BusLoopGame` already accepts a level argument in its constructor, and `level-data.js` exposes `setActiveLevel(level)`, so the model can be reconstructed around Level7 while keeping CTA state in the outer bootstrap scope.
- `SceneView` reads the live `LEVEL_1` binding throughout construction and update logic but has no level-swap or full-dispose API. The least invasive safe transition is to add a focused scene rebuild method that clears level-specific scene objects/state and rebuilds them after `setActiveLevel(level7)`, or to make the bootstrap replace the entire view while explicitly disposing the old renderer/listeners/assets.
- `src/main.js` currently declares `game` and `view` as constants and exposes those fixed objects through `window.__busLoop`; a real in-session level swap requires mutable runtime references and QA accessors that resolve the current objects.
- The install counted set currently keys only by numeric vehicle id. Because Level9 and Level7 reuse numeric ids, a shared counter must namespace uniqueness by level key while preserving the accumulated numeric count.
- Level9 and Level7 share the exact same runtime asset manifest, conveyor scene, and background; only authored level data differs. The existing loaded Three.js templates/textures can be reused safely, so the transition only needs to replace level-specific vehicle roots and reset transient render state.
- Current production generation writes only `ACTIVE_LEVEL`. The focused extension is to keep Level9 as `ACTIVE_LEVEL` and emit Level7 as a named session follow-up from the same generator, preserving the narrow production payload without importing the full development catalog.
- Structural sizes: Level9 has 37 vehicles with queues 131+131; Level7 has 83 vehicles with queues 368+278.
- `VehicleEffects.clear()` already removes live particles and resets timing/contact state, so render-level handoff can explicitly clear effects before replacing vehicle roots.
- `BusLoopGame.subscribe()` returns an unsubscribe closure. The main runtime should unsubscribe the completed Level9 model before creating/subscribing Level7, preventing stale listeners and duplicate win handling.
- The generated runtime now contains exactly `level9` and `level7` when Level9 is selected; direct inspection confirms 37/83 vehicles and queue sizes 131+131 / 368+278 in that order.
- The current install threshold is 20 while Level9 has 37 vehicles. To keep Level9 completable, reaching the threshold during Level9 records `installReady` but does not intercept input or open the store until the session advances to Level7.
- Focused verification passes 12/12 across session/catalog and paired CTA main-thread/threshold paths. The production bundle is 749,274 bytes and includes only Level9/Level7 markers among imported levels; the existing >500 kB Vite warning remains unchanged.

## Level7 vehicle 66/82 coordinate sync - 2026-07-16

- The authoritative input is `D:\UnityProjects\BusLoop\Assets\BusJam\Game\Bundleables\Level_Escape_C\level7.asset`.
- Project navigation maps this change to `scripts/extract-unity-levels.mjs`, generated `src/level-catalog.js` / `src/generated-active-level.js`, and `test/level-catalog.test.js`.
- Level7 is already the durable selected production level; the prior package contains 83 vehicles and queues 368+278.
- Current Unity-authored coordinates are vehicle 66 `x=-0.15425447, z=0.95464253` and vehicle 82 `x=0.77715284, z=0.57091796`; both retain their existing rotations.
- The extractor already has a per-level `vehicleOverrides` mechanism, while focused Level7 assertions currently cover vehicle 89 color plus exact queue order.
- Level7 positions are parsed directly from the Unity asset by `parseUnityLevel`; no new hardcoded override is needed. The durable repo changes should be regenerated catalog/artifact/active-level data plus a focused coordinate regression.
- Compared with the current generated Level7 payload, vehicle 66 moves from `(-0.14925447, 0.8996426)` to `(-0.15425447, 0.95464253)`, and vehicle 82 moves from `(0.78215283, 0.6409179)` to `(0.77715284, 0.57091796)` in web `x/z` coordinates.
- The active generated level is already `level7`. Run the extractor with `--selected=level7`, then focused catalog/collision checks, `npm.cmd run build`, `package:applovin`, and `check:applovin`.
- After regeneration, both the development catalog and single-level production payload contain the exact new coordinates, and the complete 83-vehicle Level7 collision scan still reports zero initial overlaps.
- Vite strips leading zeros from decimal literals in the final package; Level7 markers appear as `id:66 ... x:-.15425447,z:.95464253` and `id:82 ... x:.77715284,z:.57091796`.

## DualQueue3 Trajectory Refresh - 2026-07-16

- The screenshot requires DualQueue3 closed curve `offsetX 0`, `offsetZ 0.85`, `scaleX 0.75`, `scaleZ 0.80`; entry 1 `offsetX 0.60`, `offsetZ 0.95`; entry 2 `offsetX -0.60`, `offsetZ 1.00`.
- The current tuning selected `dualQueue3` but its per-layout transform still held stale DualQueue2-like values (`offsetZ 0.60`, entries `0.60/0.90` and `-0.50/0.90`). The package therefore needs a real config correction before rebuilding.

## Current Editor Tuning Rebuild - 2026-07-16

- The browser editor state is authoritative for this request; `artifacts/scene-tuning.json` must be refreshed from the editor before `npm.cmd run apply:tuning`.
- Browser page inspection cannot access the main-world `window.__busLoop`, but every editor row carries its exact tuning path in `data-path` and exposes the current value in a number input or select. Those path/value pairs are sufficient to rebuild the complete editor-authored patch without reading browser storage.
- The automated fresh-tab form state was stale. The user's direct runtime export is authoritative: `level7`, `dualQueue3`, guide vehicle 89 with base X `0.25`, right-side approach `0.62`, far/near scale `1.14/1`, speed `0.55`, and a 3-second mask sized `0.62 x 0.62` with padding 15.
- The production workflow keeps the editor catalog development-only and regenerates `src/generated-active-level.js` from the selected level during `npm.cmd run build`.
- AppLovin delivery remains one fully inlined HTML under 5,000,000 bytes with MRAID CTA/ready handling and no external asset URLs.
- The final Level7/dualQueue3 package is 3,639,703 bytes with SHA-256 `1AEC67487626C7E73EBB07DE00967344FA0EE6F47BCE61042274ECD8DD03DA5C`; static validation and package marker checks passed. Automated local `file://` runtime QA was blocked by browser URL policy, so AppLovin preview/upload play remains pending manual validation.

## Level7 Escape C Import - 2026-07-16

- Follow-up validation: vehicle 89 is a visible 10-seat parking-area vehicle currently using color 5. Changing it to color 2 requires moving exactly 10 passenger entries from color 5 to color 2.
- The revised right queue remains length 278 and changes counts from `{0:66,1:44,5:76,6:22,7:70}` to `{0:66,1:44,2:10,5:66,6:22,7:70}`. Combined with the unchanged left queue, it exactly matches the projected vehicle seat totals after vehicle 89 becomes color 2, with zero per-color mismatch.
- The durable override and revised queue were applied successfully; extraction regenerated the selected Level7 catalog/artifact/active payload with unchanged structural counts (83 vehicles, queues 368+278).
- Verification exposed that `artifacts/selected-level.txt` is currently `level9`; generating active Level7 created a selection mismatch even though the Level7 catalog assertions passed. Preserve the existing Level9 selection and regenerate active/artifact selection as Level9 while retaining the updated Level7 catalog entry.
- After resynchronizing to current selection Level9, focused catalog/collision tests pass 12/12. Direct Level7 verification confirms vehicle 89 `{seats:10,colorIndex:2}`, right queue length 278 with counts `{0:66,1:44,2:10,5:66,6:22,7:70}`, and exact combined seat/passenger color parity.
- Production build passed with the current selected Level9 payload and only the existing Vite >500 kB chunk warning; Level7 changes remain in the generated development catalog/artifact.
- Source: `D:\UnityProjects\BusLoop\Assets\BusJam\Game\Bundleables\Level_Escape_C\level7.asset` (42,234 bytes, Unity id 7, mapScale 1).
- The asset contains 83 parking-area vehicles and 646 total seats. Seat totals by color are: `0:110`, `1:126`, `3:44`, `4:50`, `5:112`, `6:74`, `7:130`; vehicle seat types are 18 four-seat, 19 six-seat, and 46 ten-seat vehicles.
- The asset's serialized fixed queues are not usable for this import: they total only 152+124 passengers and include color 8, which has no corresponding vehicle seat total. The user's supplied left/right queues must explicitly override the asset queues before `validateLevel()`.
- Existing ownership is `scripts/extract-unity-levels.mjs` -> `artifacts/unity-levels.json` + `src/level-catalog.js` + selected `src/generated-active-level.js`, with catalog coverage in `test/level-catalog.test.js`.
- The supplied queues parse cleanly as left/queue 0 length 368 and right/queue 1 length 278, totaling exactly 646 passengers. Combined color counts exactly match the 83 vehicles' seat totals for every color (`0,1,3,4,5,6,7`) with zero mismatch.
- Queue-specific counts are left `{0:44,1:82,3:44,4:50,5:36,6:52,7:60}` and right `{0:66,1:44,5:76,6:22,7:70}`.
- `artifacts/selected-level.txt` currently selects Level9 and is the production generator's authoritative selection. This import should update it to Level7 and regenerate the active payload; `src/scene-tuning.js` remains a fallback default of Level5.
- Level7 was added between Level5 and Level8 in the default source order, `artifacts/selected-level.txt` now selects `level7`, and extraction succeeded with `83 vehicles, queues 368+278`; the generated active module is Level7.
- Focused catalog/collision tests pass 12/12. Direct generated-data verification confirms options `[level5, level7, level8, level9, level10, level13]`, active key `level7`, exact passenger/seat color totals, and zero initial Level7 vehicle-body overlaps.

## Level8/Level9 Initial Collider Parity - 2026-07-16

- The imported vehicle positions and yaw values come directly from each Unity level asset; yaw is reconstructed from the serialized quaternion.
- The extractor does not read per-prefab collider geometry. It assigns hard-coded web collision bodies by seat count: width `0.27` for all types and lengths `0.4814318817567568`, `0.5639630614864864`, and `0.6785897` for 4/6/10-seat vehicles.
- Runtime collision uses centered oriented boxes and treats exact boundary contact as overlap (`<=` in all SAT axes). The next check is to enumerate the Level8/Level9 pairs and compare their authored prefab collider bounds/centers against these hard-coded dimensions.
- A direct SAT diagnostic on the current catalog reproduced 22 initial overlap pairs in Level8 and 21 in Level9. The common Level8 straight-line spacing is about `0.51`, while two hard-coded 6-seat lengths sum to a required center spacing of `0.563963...`; penetrations commonly reach about `0.054`.
- Level9's curved chains show the same pattern across rotated 6-seat vehicles, so the defect is systemic rather than a single bad imported pose. `D:\UnityProjects\BusLoop\Assets` is available for authoritative prefab inspection.
- Authoritative prefab YAML confirms the web constants are wrong for 4-seat and 6-seat buses. After applying each collider object's local scale, Unity sizes are approximately: 4-seat `0.27000001 x 0.47157903` with local center Z `-0.02223980`; 6-seat `0.27 x 0.486` centered; 10-seat `0.27000002 x 0.67858938` centered.
- All 33 normal color/seat prefabs under `BusAndPassenger` use the same values for their seat class. The current web lengths `0.48143188` (4-seat) and `0.56396306` (6-seat) do not match those prefabs; especially the 6-seat body is about `0.077963` too long.
- Substituting the authoritative sizes removes every initial overlap in Level9 and reduces Level8 from 22 pairs to three very small 4/6-seat contacts. Level5 also becomes clean; Level10 and Level13 retain one small 4-seat-related pair each if the prefab's nonzero 4-seat collider center is applied literally.
- Unity runtime sets `scene.VehicleScale = clamp(config.mapScale, 0.5, 1.8)` before borrowing vehicles, while the level asset stores raw vehicle transforms. The remaining question is how `VehiclePool` applies the inverse/scene scale and whether authored `position` denotes the vehicle transform or an adjusted collider reference point.
- `BusJamConfig.asset` is the authoritative logical collision source and contains exactly: 4-seat `{x:0.27,z:0.47157902}`, 6-seat `{x:0.27,z:0.486}`, 10-seat `{x:0.27,z:0.6785897}`. `VehicleConfig.GetSize()` and `GameScene.GetVehicleSize()` use these centered sizes; the prefab BoxCollider's 4-seat center offset is not part of the gameplay geometry graph.
- Unity scales both authored positions (about the parking-area anchor) and logical vehicle sizes by the same `VehicleScale`, so overlap relationships remain invariant in the raw level coordinate space used by the web runtime.
- Using the centered `BusJamConfig.asset` sizes eliminates all initial oriented-box overlaps in all five imported levels, including Level8 and Level9. This identifies the root cause as stale/incorrect 4-seat and 6-seat web length constants, not position/yaw extraction or SAT tolerance.
- The five supplied source assets are at `D:\备份\改文件名临时文件夹\level{5,8,9,10,13}.asset`; the extractor's current default path string is mojibake and should be corrected while regenerating.
- `test/level-catalog.test.js` already owns an oriented collision-box helper and the prior Level13 overlap regression, making it the narrow test boundary for asserting the Unity size table and zero initial Level8/Level9 pair overlaps.

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
