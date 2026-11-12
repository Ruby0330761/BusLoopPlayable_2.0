# Task Plan

## Current Hand Hint Phases

1. **Complete:** Removed the Level 36 dimming mask while preserving an immediate opening hand hint.
2. **Complete:** Hide the hand on canvas interaction and restore it after five seconds of inactivity.
3. **Complete:** Added editor controls, stale-cache migration, movable-target fallback, focused tests, production build, and browser verification.

## Current Level36 Reference Layout Phases

1. **Complete:** Reinterpreted the supplied comparison as a filled, high-density irregular field rather than a hollow outer frame.
2. **Complete:** Rebuilt Level 36 with 82 collision-free vehicles, mostly orthogonal rows, local diagonals, and nine colors while retaining `dualQueue3`.
3. **Complete:** Replaced the 14 minibuses in the right two columns with 4-seat cars, synchronized the queues to `274+268`, reduced vehicle models to `0.70`, and compacted the field around its center to clear both the driving lane and CTA.
4. **Complete:** Regenerated the active payload, passed focused tests/build, and completed browser visual acceptance with zero error-level logs.

## Current BL04 Enhancement Phases

1. **Complete:** Updated the product name and selected the ordinary `dualQueue3` flat loop for `level33`.
2. **Complete:** Put ten pink passengers at the start of queue one, retained the center pink vehicle/opening guide, and reduced parking to four spots.
3. **Complete:** Expanded the station-path perimeter, added full-path overlap regression coverage, and migrated the exact stale editor values that kept the first vehicle on the old path.
4. **Complete:** Enlarged the opening guide hand to `2.2`, replaced the square-corner mask with a `16px` rounded spotlight, and passed focused tests, production build, and browser visual QA.
5. **Complete:** Added live spotlight X/Y, width, height, and margin controls, then converted every right-side editor group into an independently collapsible section.
6. **Complete:** Added a live spotlight corner-radius control; `0` produces a square cutout and values through `120` increase the rounding.

## Current Multi-Platform Export Phases

1. **Complete:** Added the seven platform-native CTA/lifecycle adapters and package formats.
2. **Complete:** Added editor platform selection, single-platform export, and one-click all-platform export.
3. **Complete:** Fixed the export contract at `package-only`, with no asset compression, optimization, or project writeback.
4. **Complete:** Fixed omitted mechanism audio being decoded as a one-byte placeholder and added an artifact-level audio decode gate.
5. **Complete:** Passed focused tests and the full seven-platform static, payload, and runtime regression with zero local failures or warnings.
6. **Complete:** Added editable business naming fields and applied them to single-platform downloads and artifacts inside the aggregate ZIP, including Mintegral and Google naming constraints.
7. **Pending external:** Upload the exact final artifacts to official platform Preview/ad consoles and play them on representative devices.

## Current Queue Auto-Sort Phases

1. **Complete:** Traced queue editor state, vehicle depth semantics, dual-queue highlights, and existing test helpers.
2. **Complete:** Added a pure stable passenger auto-sort that groups vehicle seat colors by ascending depth and applies the dual-queue interleave contract.
3. **Complete:** Added the one-click queue-editor control and focused model/UI regressions.
4. **Complete:** Targeted syntax and model/editor tests pass, and the durable editor feature status is recorded.

## Current Goal

2026-11-12 — **Git handoff authorized by xzx:** new branch `feature/xzx/20261112-editor-stamina-endcard` from the current checkout, with the completed editor changes below. The user explicitly deferred batch export; its naming-list proposal has not been implemented. Commit scope is editor source, paired tests and project notes; authored level24/25 and the ownership registry remain local. Validation reuses the recorded tests/build/browser evidence for v20261112-1418. Push targets this new branch on the existing `origin` only; merging and deployment are outside this request.

- Local branch created and 19 scoped files staged; staged diff checks and remote push dry-run passed. Commit identity was resolved from the signed-in GitLab account's selected Commit email; author name `xzx` is configured for this repository only. Commit and push to the named branch are authorized; batch export remains deferred.

## Completed Local Feature Snapshot

2026-11-12 — **Confirmed and implemented locally: failure end-card store interaction**, v20261112-1418. xzx confirmed dim/non-pulsing Download, no Retry, and tap-anywhere only after the icon appears.

- Existing `D:/Trial_Play/BFT/editor`; small Level 1 / D0 / light Web DOM change, existing dependencies only. Files: `src/main.js`, `src/styles.css`, `src/scene-tuning.js`, `src/scene-editor.js`, existing model/UI regression test, version/changelog and project notes. Reused the existing retry switch and native platform store interface.
- Failure CTA sits below the mask and stops pulsing. With Retry off (new default), the failure overlay becomes an accessible store link only at the existing icon-ready phase. Clicks/Enter/Space route through `InstallFullGame`; normal play, hidden/reset overlays and winning cards do not acquire this action. An explicitly enabled legacy Retry remains available; the editor explains the off mode. Game Over edits update interaction state without restarting the round.
- **Implementation/self-check/scoped review complete:** 215 focused tests and build pass. One actual AppLovin QA export was checked with a local MRAID simulator: pre-icon click count stayed 0; blank/icon/old CTA position/keyboard/portrait edge/landscape edge produced exactly counts 1–6 through the store interface. Real editor level25 was failed by a blocked click, displayed the dim CTA/no Retry/icon link, then reset through normal controls; CTA pulse/enabled state restored. No browser error logs.
- Evidence: `artifacts/playable-exports/xzx-failure-endcard-20261112/` (tests/build, unmodified export, separately instrumented `qa.html`, visible count log and screenshots). Viewports: 1280×720 / 390×844 / 844×390. The original authored logo geometry was retained; landscape checks concern click coverage and failure presentation, not a new logo-fit design.
- Current browser remains on the user's BFT-26102328-母素材/level25 (selected by xzx before browser verification), Retry off, three hearts and opening intro restored. User level24/25/ownership file edits were not edited by this round. **xzx subjective review pending.** No commit/push, shared editor update, prior delivery-file modification or real ad-platform/device acceptance; the QA export intentionally skipped platform checkers.

## Previous Goal (2026-11-12 stamina alignment)

2026-11-12 — **Confirmed and completed locally: responsive stamina alignment**, v20261112-1151. xzx confirmed the left/center/right anchor plan in this chat.

- Scope: existing `D:/Trial_Play/BFT/editor`, small Level 1 / D0 / light Web DOM change, no new dependencies. `src/stamina.js`, `src/stamina-view.js`, `src/scene-tuning.js`, `src/scene-editor.js`, their existing test, version/changelog and project notes. Local implementation only; previous CTA/stamina changes retained.
- `stamina.horizontalAlign` accepts left/center/right, defaults center. Zero X offset anchors the actual HUD edge/center to visible game content with safe edge margins; horizontal nudges scale with content width. Selecting an alignment clears X, preventing the previous 399/400 adjustment from carrying over. Y behavior remains independent.
- **Implementation, self-check and scoped review complete:** 87 focused tests and build pass. 21 editor browser layouts (1280×720, 390×844, 844×390; representative 1/3/10 hearts) and 6 real exported-page layouts pass, maximum measured error <0.012 px. Fresh reload, X reset, master-off disabled selector, downloaded screenshot centering and three actual AppLovin QA exports verified. No error-level browser logs or blocking visual issues observed. Evidence: `artifacts/playable-exports/xzx-stamina-alignment-20261112/`.
- Preview `http://127.0.0.1:5180/` retains the user's BFT-26102327/level24 selection, three hearts and intro enabled, now center/X0. Existing authored level24/ownership file edits were present before this round and were not edited. **xzx subjective review pending.** No commit/push, shared 12151 update, old delivery-file changes or ad-platform acceptance. QA exports intentionally skip platform checkers.

## Previous Goal (2026-11-12 CTA and stamina behaviors)

2026-11-12 — **Confirmed and implemented locally for xzx**, v20261112-1055, branch `feature/xzx/20261112-cta-stamina-controls` in `D:/Trial_Play/BFT/editor`.

- Scope: freely editable CTA text shared by preview/screenshot/export; wrong clicks spend one heart at contact while retaining the ordinary bump/return/audio; separate parking-rescue switch reusing the existing deadlock condition, delay, passenger transfer and departure/bay release. Both switches share the current stamina pool. Empty CTA text retains device localization. Existing Game Over/Retry remains the exhaustion result.
- Small local Level 1 / D0 change using the existing DOM/Three.js editor and dependencies; no new third parties. Source, paired tests and export compatibility only. User's confirmation in this chat is the plan/implementation authorization.
- **Implementation and self-check complete:** 224 focused model/view/localization/export/countdown/effects/changelog tests pass; build passes. The Windows directory-link export issue was fixed with a junction and the 42 export tests rerun successfully. Local BFT AppLovin QA export, real screenshot download, 1280×720 desktop / 390×844 mobile browser checks, custom/blank/localized text, refresh persistence and independent/disabled switches verified. Exported-page collision reduced 3→2 hearts without removing the blocker; error-level browser logs empty.
- **Scoped review complete:** ordinary collision motion/contact events are unchanged; costs are once-only/nonnegative; flags change without refilling stamina; original station failure predicate and delay preserved. Evidence: `artifacts/playable-exports/xzx-cta-stamina-20261112/`.
- **User acceptance pending:** xzx reviews the local editor at `http://127.0.0.1:5180/` and subjective collision/rescue feel. Shared editor `10.0.0.54:12151` has not been updated; no Git commit/push or prior delivery-file changes. Ad-platform checking is outside this local editor task; the QA export intentionally skipped those checkers.

## Previous Goal (2026-11-10)

2026-11-10 PR handoff: User explicitly requests committing/pushing this stamina work and creating/merging a PR into main. Preparing a scoped commit on codex/xiaosuo, synchronizing origin/main's background.horizon export fix, and validating the integrated result. Keep unrelated material variants, image-layout drafts, IDE files, ignore changes and spatial-editor test edits out of this PR. Git SSH access works; GitLab web login is pending for the normal merge UI. Existing implementation evidence below remains valid for its recorded snapshot.

2026-11-10: Confirmed 1–10 stamina increment implemented and locally checked at v20261110-1719. Integer controls, centered one/two-row HUD and all opening counts are ready. 182 targeted/regression tests, editor build, 30 browser layouts, new intros, controls/persistence/disabled/countdown coexistence and selected export resources pass; scoped review found no blocking issue. Evidence and acceptance mapping: `docs/ui-design/bl/2026-11-10-stamina-1-10-interaction-design.md` and `artifacts/playable-exports/stamina-1-10-20261110/`. Local editor is running at 127.0.0.1:5177 with saved test preview on/7 hearts/X=0/Y=0/scale1/intro on; source defaults remain off/3. Codex local checks complete; next: user tests controls, rescue/Retry and subjective appearance locally. No commit/push or online deployment; existing closure records below are historical, not a fresh remote status claim.

## Current Stamina Rescue Phases (2026-11-09)

1. **Reference analysis complete:** Statically traced actual-contact rescue, parking-deadlock rescue, same-colour passenger transfer, once-only heart consumption, departure and exhaustion in the supplied HTML. Five attachment images are available; the four used by the reference match its embedded assets. Details and source hash are in `findings.md`.
2. **Confirmed:** User chose 1/3/5/10 hearts, Game Over / Retry, and an opening explanation for all four presets. Subsequent correction requires the supplied dedicated opening design and permits HUD/clock overlap under manual X/Y control. Source of the confirmed rules: `docs/development-docs/bl/2026-11-09-stamina-rescue-plan.md`.
3. **Implemented locally:** Model rescue, real passenger transfer, container release, HUD/intro, editor persistence, conditional export assets and countdown coexistence. Initial full regression: 573 pass / 0 fail / 1 existing FFmpeg skip; browser proved real collision consumption, final rescue before Game Over and Retry restoration/replay.
4. **Revision validation complete:** Supplied 3/5 design and adapted 1/10, 620px runtime artwork with source PNGs retained; independent HUD coordinates verified across countdown visibility changes. Current focused model/countdown/view coverage 40 pass, checker fixtures 14/14, final editor build pass. Final 10-heart export passes 45/45 Android/iOS portrait and Android landscape checks; intro-off and stamina-off branches pass another 30/30. Default 3-heart export resource/size check passes. All local samples stay below 5,000,000 B; evidence in `artifacts/playable-exports/stamina-qa/`.
5. **Ready for local review:** Browser preview `http://127.0.0.1:5177/`, version 20261109-1225. Initial local tuning restored after QA (stamina 10/on, X=48/Y=-2160, countdown off). Implementation review issues closed; latest user-approved deliberate HUD overlap is allowed. No outstanding local blocker; no commit/push/deploy or actual platform/device acceptance performed.
6. **HUD tuning complete at v20261109-1350:** Per the next user request, default anchor moved left to clear speed; top ten-heart HUD is a compact single row inside the measured artwork cavity. View/config 6/6 and syntax pass; desktop, portrait and landscape browser geometry confirms containment and speed clearance. Preview now uses default X/Y=0/0, scale1, ten hearts/on. No full rebuild or re-export for this local visual revision.
7. **Two-row refinement complete at v20261109-1415:** Per the latest user request, the top ten-heart HUD uses a compact, centered 5×2 grid with tighter spacing and clear artwork margins. View/config 6/6 pass; desktop, 390×844 and 844×390 browser checks confirm two rows, centering, containment and speed clearance. Evidence: `artifacts/playable-exports/stamina-qa/hud-10-1415-*`. No full rebuild or re-export for this CSS-only revision.
8. **Shorter ten-heart frame complete at v20261109-1437:** Reused the original PNG/asset whitelist with CSS nine-slicing at 480×280 proportions, preserving round ends and border thickness. The larger 5×2 heart group occupies 65% of frame width (previously 37%). View/config 6/6, syntax and diff checks pass; desktop, 390×844 and 844×390 confirm rows [5,5], centering, cavity/stage containment and speed clearance. Evidence: `artifacts/playable-exports/stamina-qa/hud-10-1437-*`. No new images/dependencies, full rebuild/re-export or commit/push/deploy.
9. **Shorter one/three-heart frames complete at v20261109-1449:** Extended the original PNG nine-slice to 280×280 / 480×280 frames, centered 112px square hearts and 12px three-heart spacing, retaining single-row display height; five/ten layouts are unchanged. View/config 6/6 and syntax pass. All six one/three-heart desktop/390×844/844×390 layouts pass centering, image, containment and speed-clearance checks; desktop five/ten switching also passes. Screenshots show no one-heart seam or three-heart frame contact. Evidence: `artifacts/playable-exports/stamina-qa/hud-1-3-1449-checks.json` and `hud-{1,3}-1449-*.png`. No new images/dependencies, full rebuild/re-export or commit/push/deploy.
10. **Deployed and verified at v20261109-1508:** Updated the existing 12151 service with the original data volume. Source/fallback defaults and online browser confirm off/three hearts; local preview restored to off/three while preserving manual X/Y. Exact ZIP snapshot build and 86 regressions pass; healthy container, matching JS/CSS/seven stamina images, no browser script errors and unchanged metadata for all 120 levels. Evidence: `artifacts/playable-exports/editor-releases/20261109-1508/`. No Git commit/push or ad-platform submission.
11. **Redeployed and verified at v20261109-1536:** User requested another online update; only the build timestamp changed. Rebuilt the exact snapshot and reused v1508's valid 86-test result after source comparison. NAS download hash, healthy 12151 container, JS/CSS/seven images, browser version/defaults and all 120 level metadata records verified. Evidence: `artifacts/playable-exports/editor-releases/20261109-1536/`; previous v1508 package retained. No Git commit/push.
12. **Service removed after explicit confirmation:** Cleaned up the 12151 deployment through server-deploy; container absent and port connection refused. Refreshed/verified 103 authored-level exports before deletion, retaining deployment history and package references. Evidence: `artifacts/playable-exports/editor-service-operations/20261109-close-12151/operation.json`. No automatic restoration.
13. **Repeated closure verified:** The owned 12151 service was found running again. User chose to continue closing; refreshed 104 authored-level backups and removed it through the skill's MCP tool. Container absence and connection refused verified. Evidence: `artifacts/playable-exports/editor-service-operations/20261109-1735-close-12151/operation.json`. No automatic restoration.

## Current Countdown Challenge Phases (2026-11-05)

1. **Complete:** Read the reference V2 countdown/store-return sources, inspect the local playable, and rerun its existing 27 tests (27/27 pass).
2. **Confirmed:** User approved `docs/prd/bl/2026-11-05-countdown-challenge-prd.md` with 「按推荐方案确认，开始开发」. Timeout reuses the existing Game Over flow and `gameOver.retryEnabled`; no separate timeout-action selector or Game Over display switch is added.
3. **Complete locally:** Implemented per `docs/development-docs/bl/2026-11-05-countdown-challenge-plan.md`; reviewed and mapped AC01–AC14 evidence there. Build passed; full regression had 513 pass/0 fail/1 existing FFmpeg skip; countdown focus 14/14 pass; seven platform artifacts from the main-feature/phone-border-fix stage passed 102/102 local runtime checks. These artifacts predate the subsequent visible-blue-frame alignment adjustment. No remote deployment or real-platform/device acceptance was performed.
4. **Local retest complete:** User requested another local test. Fresh 14/14 tests and browser flows passed, including x2 real-time measurement, 78-second editing pause, timeout and both Retry settings. Preview service is running at `http://127.0.0.1:5177/`; details are appended to the same implementation record.
5. **HUD alignment complete locally:** Aligned the visible blue frame edges of the countdown and speed button; 3/3 view tests and desktop/portrait/landscape browser checks passed. No full rebuild or platform re-export after this adjustment; evidence is linked from the project progress entry.
6. **Guide controls/display tuning complete locally:** Per the user's next request, moved the card below the speed toggle in Guide, paired time sliders with number inputs, and added X/Y offsets plus proportional scale. Full build, 67 targeted tests, real slider/input/disabled-state interactions, persistence and portrait/landscape checks passed. PRD AC15–AC16 and implementation evidence updated; defaults keep the prior alignment. No deployment or updated platform packages.
7. **Time range adjustment complete locally:** Both duration and warning accept 0–120 seconds, with warning capped at duration. Zero duration expires once after the first dispatch; zero warning stays silent. Legacy bounds normalize consistently for UI/export. 17 focused tests, syntax and browser boundary checks passed; reused the prior build and restored the user's 1/1-second preview settings.
8. **Release deployed and verified:** Version 20261105-1536 and code commit 4e6ed02 are live at 10.0.0.54:12142. User explicitly authorized identity renewal. The existing container/port/data volume were reused, health and all 116 level metadata entries were preserved. Remote assets match the exact ZIP's isolated build; browser verified the new card, controls, helper text and timer image. Build-input difference is recorded in findings.md. Evidence: artifacts/playable-exports/editor-releases/20261105-1536/.

## Current Level40 Test Package Phases

1. **Complete:** Confirm the saved web-authored `level40` document and identify the production-selection gap.
2. **Complete:** Added production generation support for saved web levels and focused regression coverage.
3. **Complete:** Selected Level40, built the production bundle, generated `test.html`, and passed all AppLovin static checks.
4. **Complete:** Verified the artifact identity, size, hash, and browser play behavior, then updated durable project records.

## Current Web Level Editor Phases

1. **Complete:** Inventoried the Unity `LevelEditor` commands, element types, inspectors, serialization contract, and shortcuts and mapped them to web ownership.
2. **Complete:** Added the editable-level document model with selection, transforms, clipboard, undo/redo, validation, depth rebuild, queues, exports, and playable runtime conversion.
3. **Complete:** Added the on-canvas authoring workspace with grid, pan/zoom, box selection, transforms, snapping/guides, and live playable preview.
4. **Complete:** Added inspectors for vehicles, containers, queues, dependencies, and the Unity vehicle-mechanism fields.
5. **Complete:** Added browser preview persistence, JSON import/export, Unity/CSV/Excel export, and revisioned Vite saves with backups.
6. **Complete:** Focused tests, production build, desktop/mobile browser QA, durable Level9 save, and project documentation are complete.
7. **Complete:** Successful saves now immediately apply the written web-level document, and protected creation/saving of new `level<number>` files is complete.
8. **Complete:** Enforced normalized unique display names across imported Unity levels and saved web levels during new-level checks and create-only saves.
9. **Complete:** Surface saved web levels in the scene editor selector and restore their authored JSON when selected.
10. **Complete:** Produced a zero-to-one web LevelEditor user guide following the supplied Unity guide's Markdown structure and tone.

## Current Web LevelEditor Guide Phases

1. **Complete:** Read the supplied reference as untrusted formatting/content reference and identify its heading, list, emphasis, and table conventions.
2. **Complete:** Verified the current web editor's entry, commands, inspectors, queue workflow, validation, save, preview, and export behavior against source.
3. **Complete:** Wrote the guide under `docs/project/`, verified Markdown structure and factual coverage, and updated project records.

## Current Gate, Conveyor, and Elevator Unity-Parity Phases

1. **Complete:** Compared the Unity LevelEditor rendering, inspector fields, layout rules, and serialization for gate queues, conveyor belts, and elevators against the web editor.
2. **Complete:** Implemented the confirmed canvas-display, configuration, transform, layering, and serialization differences without inventing unsupported Unity values.
3. **Complete:** Added focused regressions and completed targeted syntax, model/editor, and browser visual checks.
4. **Complete:** Updated the web LevelEditor user guide and durable project records with the final parity behavior.

## Current Saved Web Level Selection Phases

1. **Complete:** Traced the missing option to the static Unity-only `LEVEL_OPTIONS` list and confirmed `level40.json` was saved under `artifacts/web-levels`.
2. **Complete:** Added a web-level listing endpoint, merged its names into the selector, and loaded the selected authored document before reload.
3. **Complete:** Added focused regressions, ran browser selection QA, and updated durable records.

## Current Web Level Name Uniqueness Phases

1. **Complete:** Resolve existing display names from the Unity catalog artifact and saved web-level documents with normalized comparison.
2. **Complete:** Pass the requested name through the availability endpoint and enforce it again in create-only persistence.
3. **Complete:** Added focused regressions and browser/API verification, then updated durable records.

## Current Web Level Creation Phases

1. **Complete:** Traced the save/preview split and confirmed saves already write `artifacts/web-levels/<levelId>.json`, while only preview updates the running game.
2. **Complete:** Added new-level authoring state, ID validation, and create-only persistence without overwriting an existing web or Unity level.
3. **Complete:** Successful saves now store the saved document as the active authored level and refresh the playable immediately.
4. **Complete:** Focused tests, service conflict checks, browser save/reload/reopen QA, cleanup, and project records are complete.

## Current Web Level Editor Status

Complete: the authoring workflow saves revisioned `bus-loop-web-level-v1` documents, applies successful saves immediately, and creates protected new web level files without overwriting existing Unity or web levels. Runtime simulation remains limited to mechanisms already implemented by the playable runtime.

## Current Phase

Countdown implementation, commit, online editor update and deployment verification are complete. Online version is 20261105-1536; the existing 116 levels are preserved. No further action is needed for this editor release. Official playable-platform/device acceptance remains separate.

## Current Google Packaging Phases

1. **Complete:** Added root `index.html`, `index.js`, and `style.css` generation and validation.
2. **Complete:** Defaulted Google delivery to portrait and required matching `320x480` metadata.
3. **Complete:** Removed the MRAID open dependency from converted Google CTA paths.
4. **Complete:** Passed Google, integrated conversion, and Unity regression suites.
5. **Complete:** Reconverted and independently validated all 16 Android shape ZIPs.

## Current Spatial Guide Restoration Phases

1. **Complete:** Compared all four level families and their background/platform variants against the complete pre-optimization backup.
2. **Complete:** Restored the family-specific normal guide targets and Rainbow-only first-click guide while retaining every spatial optimization switch and payload.
3. **Complete:** Reconverted 32 Unity packages through the integrated hardening pipeline and passed lifecycle/fail-closed tests.
4. **Complete:** Verified Rainbow AppLovin/Unity first-click timing and Duck/Fish ordinary guide visibility at 390x844 with zero error-level logs.
5. **Complete:** Backed up the overwritten optimized files, replaced 64 target HTML files, and confirmed byte-for-byte source/target parity.

## Current Spatial Runtime Optimization Phases

1. **Complete:** Added the spatial-only editor group, master gate, and independent rollback switches.
2. **Complete:** Added live render state, curve lookup, lazy unused views, static/blocker caches, boarding pooling, and duplicate-work removal.
3. **Complete:** Added shared-geometry VAT passenger and fake-shadow instance batches with four conservative culling chunks.
4. **Complete:** Passed focused tests/build and desktop/mobile browser rendering with zero final error-level logs.
5. **Complete:** Rebuilt and published all 64 supplied spatial packages with exact target hash validation and a full pre-replacement backup.

## Current Production Handoff Guide Phases

1. **Complete:** Confirmed the local Vite editor startup route, browser persistence behavior, level-selection endpoint, and production tuning application script.
2. **Complete:** Traced CTA/install redirects to `mraid.open()` and real pointer/click paths; local browsers without MRAID are expected not to navigate.
3. **Complete:** Documented the AI-assisted export/apply/build/package/check workflow and the required AppLovin manual validation sequence.
4. **Complete:** Recorded the handoff in project documentation without changing runtime code or rebuilding the existing package.

## Current Level12 Sakura Package Phases

1. **Complete:** Confirmed Level12 vehicle 34, guide/CTA/background tuning owners, production selection, and AppLovin package commands.
2. **Complete:** Synchronized Level12, guide vehicle 34 with Level12 scope, Sakura background, and store redirect threshold 10 across durable source/exported state, saved-cache migration, and focused assertions.
3. **Complete:** Regenerated the narrow Level12 production payload; syntax, catalog 10/10, guide 1/1, and targeted background/cache/install checks 3/3 pass.
4. **Complete:** Built, packaged, passed all 15 AppLovin checks, saved `level12-sakura.html`, and verified the package markers/background fingerprints and final hash.

## Current Level12 Playable Queue Sync Phases

1. **Complete:** Parsed both AppLovin `passengerQueues` arrays and confirmed 219+219 passengers with exact Level12 seat-color parity.
2. **Complete:** Replaced the extractor override/test expectations and the supplied `level12.asset` fixed passenger sequence, preserving a backup of the prior asset.
3. **Complete:** Re-imported Level12 incrementally, restored the Level10 narrow production module, and verified exact queue parity across playable, asset, catalog, and tests.
4. **Complete:** Recorded the completed queue-source correction and verification result.

## Current Level12 Import Phases

1. **Complete:** Located the Level12 row in `FixQueueConfigB.xlsx` and confirmed 173 left + 265 right passengers exactly match 94 vehicles / 438 seats by color.
2. **Complete:** Added Level12 and its exact queue order to the reproducible Unity extraction/catalog pipeline and editor persistence whitelist.
3. **Complete:** Regenerated the catalog with an explicit merge mode, preserved Level10 production selection, and passed queue, collision, depth-reference, selection, and syntax checks.
4. **Complete:** Browser QA rendered Level12 with zero error-level logs, restored Level10, and recorded the durable handoff without rebuilding or repackaging AppLovin artifacts.

## Current Level10 Winter Separate Package Phases

1. **Complete:** Fingerprinted the existing Sakura package and preserved it as `level10-sakura.html` with an identical hash.
2. **Complete:** Switched exported/source/cache defaults and focused assertions from Sakura to winter while preserving Level10/39/CTA/threshold values.
3. **Complete:** Regenerated Level10 and passed focused syntax/background/config/catalog/guide checks.
4. **Complete:** Built/packaged winter, saved it separately, passed all 15 checks on both named artifacts, verified selected-background-only fingerprints, and recorded hashes/status.

## Current Level10 Sakura Repackage Phases

1. **Complete:** Confirmed the current Level10 package inputs, optimized Sakura asset, selected-background generator boundary, cache migration owner, and focused tests.
2. **Complete:** Switched exported/source tuning to Sakura and migrated the exact prior summer default without changing Level10/39/CTA/threshold values.
3. **Complete:** Regenerated Level10 and passed focused syntax/background/config/catalog/guide checks.
4. **Complete:** Built, packaged, passed all 15 AppLovin checks and background byte fingerprints, and recorded final size/hash/status.

## Current Level10 Guide/CTA Package Phases

1. **Complete:** Confirmed Level10 vehicle 39, exact tuning fields, saved-editor migration, package commands, and focused tests.
2. **Complete:** Synchronized Level10, both guide scopes/targets, CTA enabled, and threshold 10 across exported/source/selection state and saved-cache migration.
3. **Complete:** Regenerated the Level10-only payload and passed focused syntax/config/catalog/guide checks.
4. **Complete:** Built, packaged, passed all 15 AppLovin checks and final marker scans, and recorded size/hash/status.

## Current Sakura Background Packaging Phases

1. **Complete:** Traced background tuning, editor, runtime manifest, generated active-level, and AppLovin packaging behavior; isolated the catalog summer fallback leak.
2. **Complete:** Added the optimized Sakura background as a third editor option while preserving the summer default and original PNG.
3. **Complete:** Updated focused regressions and verified generated production data retains only the selected background.
4. **Complete:** Passed focused checks, temporary Sakura and restored-summer builds, AppLovin validation/fingerprint scans, browser QA, and durable documentation.

## Current Level16 Guide-45 Package Phases

1. **Complete:** Confirmed Level16 vehicle 45 exists and the current Level15 guide scope would otherwise suppress it.
2. **Complete:** Updated normal/first-click guide scope and target plus focused tests and editor-cache migration.
3. **Complete:** Applied tuning, regenerated Level16, and passed focused guide/config checks.
4. **Complete:** Built, packaged, passed all AppLovin checks, and recorded the refreshed size/hash.

## Current Level16 Parameter Package Phases

1. **Complete:** Confirmed current values, AppLovin commands, generated-level boundary, and affected focused tests.
2. **Complete:** Set Level16, summer background, threshold 30, path X -2.2/2.2, map scale 0.8, and model scale 0.7 across source/exported selection state.
3. **Complete:** Regenerated the Level16 active payload and passed focused configuration/catalog/runtime checks.
4. **Complete:** Rebuilt after the editor saved-default migration, revalidated all 15 AppLovin checks, and confirmed the final size/hash remain unchanged.

## Current Editor Completion-State Phases

1. **Complete:** Confirmed the model reaches `won` while the final-session UI branch exposed no result action.
2. **Complete:** Reused the existing failure CTA/icon overlay for final victory with `You Win!` and the existing store CTA behavior.
3. **Complete:** Updated focused source contracts and retained the model win-condition plus Level9 -> Level7 handoff coverage.
4. **Complete:** Targeted tests and browser DOM/log QA pass, Level15 remains selected, and durable project records are updated.

## Current Layout-Switch Queue Parity Phases

1. **Complete:** Reproduced Level15 -> Level16 initialization parity, then isolated duplication when editor-driven queue geometry reinitialization rebuilt authored queues while retaining occupied belt slots.
2. **Complete:** Preserve the model's current side/source queue remainder during non-reset editor reinitialization; explicit structural resets still restore authored queues and clear the belt.
3. **Complete:** Added a Level16 regression that advances passengers onto the belt, reapplies editor queue geometry, and asserts exact total/per-color conservation.
4. **Complete:** Targeted tests and browser switching/editing QA pass, Level15 is restored, and durable project records are updated.

## Current Level16 Import Phases

1. **Complete:** Inspected project navigation/rules; Level16 has 37 unique vehicles, 218 seats, authored queues 139+79, exact per-color parity, valid depth references, and zero initial overlaps.
2. **Complete:** Added Level16 to the default extractor and Vite persistence whitelist without changing the Level15 production selection or inventing conveyor/tuning values.
3. **Complete:** Regenerated catalog/runtime data; four focused catalog/queue/collision/selection regressions pass and the generated production module remains Level15-only.
4. **Complete:** Browser QA loaded Level16 with zero console errors, restored Level15, and confirmed the production boundary did not change; recorded the durable handoff without an unnecessary build/package.

## Current Summer Background Phases

1. **Complete:** Measured both 2100x3382 backgrounds and generated a 195,940-byte q60 summer derivative without overwriting the 1,035,562-byte source.
2. **Complete:** Added the background asset to tuning, editor options, runtime texture swapping, and generated level manifests; summer is the baked default and winter remains selectable in development.
3. **Complete:** Source syntax and the focused background regression pass; browser QA confirmed both directions switch immediately and reported zero console errors.
4. **Complete:** Production build and all 15 AppLovin checks pass at 3,979,125 bytes. Official preview/QR and real-backend upload/play remain external.

## Current Level15 AppLovin Packaging Phases

1. **Complete:** Confirmed Level15 remains selected with the revised data/tuning and AppLovin requires a fully inlined single HTML <= 5,000,000 bytes plus the existing static bridge/lifecycle checks.
2. **Complete:** Production build passed without additional permission; prebuild generated Level15 with 81 vehicles and 296+214 queues, with only the existing Vite chunk-size warning.
3. **Complete:** Generated `artifacts/applovin/index.html` at 3,642,343 bytes; all 15 static checks pass and final marker scans confirm the revised queues/tuning with SHA-256 `74FBABDBE2488F99AEF442FB6D04D485007DBF9AC3FF24E8E0DD17343C2EB0E6`.
4. **Complete:** Recorded the package status. No local permission-dependent work remains; AppLovin official preview and real-backend upload/play are the required external manual validation steps.

## Current Level15 Queue/Tuning Revision Phases

1. **Complete:** Parsed the replacement queues as 296 left + 214 right and confirmed their combined per-color totals exactly match all 510 Level15 seats.
2. **Complete:** Replaced the Level15 queue override/test expectations and synchronized map scale 0.73, vehicle model size 0.63, both guide scopes/targets to Level15 vehicle 157, and path X bounds -2.53/2.53 in source/exported tuning.
3. **Complete:** Regenerated Level15 catalog/runtime data; generated-source syntax and focused queue/guide/config verification pass 8/8 without packaging or building.
4. **Complete:** Recorded the durable revised Level15 status and handoff.

## Current Level15 Import Phases

1. **Complete:** Parsed `level15.asset` and validated 81 unique vehicles / 510 seats against the supplied 278+232 queues with exact per-color parity.
2. **Complete:** Added Level15 and its exact queue override, corrected the drifted Level7 default source to its preserved 83-vehicle backup, and regenerated the full catalog/artifact with Level15 selected.
3. **Complete:** Generated the narrow Level15 runtime payload; catalog tests passed 7/7, direct collision diagnostics found zero initial overlaps, and the production build passed before the queue/tuning revision request.
4. **Complete:** Recorded the durable Level15 import/revision status, verification results, and handoff.

## Current First-Step Mask-Off Package Phases

### Phase: First-step mask-off AppLovin package

**Status:** complete

1. **Complete:** Confirmed `firstClickGuide.enabled` owns the timed DOM mask and synchronized it to `0` in source/exported tuning plus the focused test.
2. **Complete:** Source/test syntax, direct source/export assertions, focused guide test, and production build passed; build retains only the existing Vite chunk-size warning.
3. **Complete:** Regenerated/checked the AppLovin single HTML; all static checks and final mask/guide/CTA marker scans passed.
4. **Complete:** Recorded final artifact size/hash/status and prepared the handoff.

## Current AppLovin Parameter Package Phases

1. **Complete:** Confirm current tuning values, AppLovin single-HTML commands, and platform checks.
2. **Complete:** Synchronize threshold 40, guide vehicle 114, and guide size 2.12 across source/exported tuning and focused tests.
3. **Complete:** Run focused verification and production build.
4. **Complete:** Generated and checked the AppLovin single HTML; sharing the identical Level9/Level7 asset manifest reduced it to 3,653,268 bytes and every static check passes.
5. **Complete:** Recorded artifact size/hash/static status and prepared the package handoff.

## Current Level9-Only Guide Phases

1. **Complete:** Inspect guide tuning, editor/exported config, visibility conditions, and focused tests.
2. **Complete:** Add Level9 scope for guide vehicle 114 and suppress both guide layers on Level7.
3. **Complete:** Update focused tests and durable documentation.
4. **Complete:** Run syntax, focused tests, and production build verification.

## Current Vehicle-Only Level7 Entrance Phases

1. **Complete:** Inspect the current layout-root grouping, queue initialization, and focused transition regression.
2. **Complete:** Move Level7 entrance animation to a vehicle-only root while keeping conveyor art fixed and restarting side queues.
3. **Complete:** Update focused regressions and durable documentation.
4. **Complete:** Run syntax, focused tests, and production build verification.

## Current Level9 To Level7 Transition Phases

1. **Complete:** Trace the mapped runtime/model/render/test paths and confirm the current production level payload constraints.
2. **Complete:** Implement the Level9-to-Level7 session transition, lower-center scale-in visual, shared CTA counter, and disabled end page.
3. **Complete:** Add focused regression coverage for level order, counter continuity, transition wiring, and end-page suppression.
4. **Complete:** Run focused verification and record durable status/handoff.

## Current Level7 Vehicle Position Sync Phases

1. **Complete:** Read the project navigation and authoritative Unity Level7 transforms for vehicle IDs 66 and 82.
2. **Complete:** Update the focused coordinate regression and regenerate Level7 outputs directly from the authoritative asset.
3. **Complete:** Run focused verification and the required production build.
4. **Complete:** Regenerate and statically validate the AppLovin single-HTML package.
5. **Complete:** Record artifact size/hash and durable handoff.

## Current Trajectory Refresh Phases

1. **Complete:** Set DualQueue3 closed and entry trajectory transforms to the screenshot values and apply the tuning.
2. **Complete:** Verify the Level7/DualQueue3 production selection and focused regressions.
3. **Complete:** Rebuild, regenerate the AppLovin single HTML, and run static/package marker checks.
4. **Complete:** Record the new artifact size/hash and handoff.

## Current Packaging Phases

1. **Complete:** Export the current editor tuning and preserve its selected level.
2. **Complete:** Apply exported tuning to source and synchronize the Level7 selection marker.
3. **Complete:** Run focused tests plus the production build.
4. **Complete:** Generate and statically validate the AppLovin single-HTML package.
5. **Complete:** Record artifact size, selected level, verification results, and handoff. Local `file://` browser QA was blocked by browser URL policy; AppLovin preview/upload validation remains external manual QA.

## Implementation Phases

1. **Complete:** Bind the guide hand target to vehicle id 89.
2. **Complete:** Add first-click guide tuning for enable/disable, target id, duration, opacity, padding, and highlight width/height scale.
3. **Complete:** Render the timed DOM mask and DOM guide hand above it while leaving pointer input available for all vehicles.
4. **Complete:** Add/update focused regression coverage and run lightweight verification only.

## Prior Level7 Import Phases

1. **Complete:** Parse Level7 vehicles/containers and validate the supplied left/right queue lengths and color totals.
2. **Complete:** Add Level7 plus its queue override to the reproducible extraction/catalog pipeline.
3. **Complete:** Regenerate catalog/artifact and make Level7 the active selected payload unless project state requires preserving another explicit selection.
4. **Complete:** Add focused catalog/queue/collision coverage and run targeted verification.
5. **Complete:** Record durable project status and handoff.

## Prior Level8/Level9 Collider Phases

1. **Complete:** Reproduce and enumerate the Level8/Level9 initial overlap pairs from the current runtime collision graph.
2. **Complete:** Compare those pairs against the source Unity transforms/colliders and isolate the parity error.
3. **Complete:** Implement the narrow correction with focused regression coverage.
4. **Complete:** Run targeted verification and record the durable result/remaining manual QA.

## Prior Store Redirect Phases

1. **Complete:** Inspected the supplied prior AppLovin HTML and current runtime/editor/test/package ownership for the success-count redirect.
2. **Complete:** Added a default-40 editor-facing threshold and restored the redirect behavior with focused regression coverage.
3. **Complete:** Ran targeted checks, rebuilt, packaged AppLovin single HTML, validated the artifact, and recorded the durable handoff.
4. **Complete:** Diagnosed the final package, current source, working backup, stale sibling artifact, input timing, audio dependency, threshold reachability, and official AppLovin bridge requirement.
5. **In progress:** Reproduced current `index.html` successfully with an instrumented MRAID stub; next add device-visible count/bridge observability or a platform-specific correction once the tested OS is confirmed.
6. **Pending:** Rebuild, validate the final single HTML, and record the required real-device retest steps.

## Prior Completed Phases

1. **Complete:** Added a reproducible Unity level extractor and validated all five supplied vehicle/queue datasets.
2. **Complete:** Ported the demo's geometry-driven vehicle collision context and focused regressions.
3. **Complete:** Added full-level editor selection with structural runtime reload.
4. **Complete:** Added single-active-level prebuild generation for production packaging.
5. **Complete:** Passed focused tests, syntax, build, AppLovin checks, content scan, and browser switching QA.

## Recently Completed

- Nudged level13 vehicle 130 clear of vehicle 135's collision body, added a focused regression, and regenerated the selected level13 AppLovin package.
- Switched the active conveyor layout to `dualQueue3`, applied the screenshot trajectory values, and regenerated the selected level13 AppLovin package.
- Bound the guide hand to vehicle 130, mirrored the texture UV and horizontal approach offsets, and regenerated the selected level13 AppLovin package.
- Multi-conveyor layout switching and Dreamteck closed B-spline parity for DualQueue2/3/5/10 were implemented and focused verification passed; manual browser QA remains a separate follow-up.

## Deferred Existing Follow-Up

- Re-run the full test suite when Windows child-process spawning is reliable.
- Revisit blocker expectations around vehicles already in the colliding state.
- Resume broader AppLovin stabilization after this editor/runtime feature is accepted.

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Final queue-sort line-number regex was malformed by PowerShell quote escaping | 1 | Switched to literal `Select-String -SimpleMatch`; implementation and verification were unaffected. |
| Queue-sort planning patch did not match the BOM-prefixed first heading and then the legacy error-table separator | 2 | Switched to the documented targeted PowerShell fallback with stable ASCII anchors. |
| Broader `level-catalog` verification retained four unrelated stale expectations for catalog membership, generated selection, Level12 selection, and Level16 map scale | 1 | Preserve current unrelated level data; use the passing `level-layout-editor` and `level-editor-model` suites plus browser switching QA for this selector change. |
| Browser QA showed the unsaved marker remained after undo restored the original document | 1 | Compare the current serialized document with the saved baseline instead of comparing monotonic change counters. |
| Browser read-only evaluation could not call `getContext()` on the canvas proxy | 1 | Use rendered screenshots plus exact DOM boundary/overflow checks; the visible canvas was nonblank and correctly framed. |
| Model test compared `0.5800000000000001` to `0.58` with strict equality | 1 | Use an epsilon assertion for the expected JavaScript floating-point representation. |
| Planning session catch-up could not start because `python` is unavailable on PATH | 1 | Continue from the existing planning files and current workspace inspection; do not block the LevelEditor migration on the optional recovery helper. |
| PowerShell blocked `npm.ps1`, so the parallel generation step did not run and dependent tests still read the old Level10 module | 1 | Use direct `node scripts/generate-active-level.mjs` and `npm.cmd` commands, then rerun dependent checks serially. |
| Broad visual-config test also hit the pre-existing camera elevation expectation `55` versus current tuning `61` | 1 | Do not change unrelated camera tuning; verify this request with narrower Level12/background/guide/install assertions. |
| Inline Node marker command was mangled by PowerShell quote parsing and produced an invalid regular expression | 1 | Use native PowerShell string/byte checks for the packaged artifact instead of retrying the same quoting pattern. |
| Post-write PowerShell queue-count regex reported `0+0` because its end-of-line assertion did not accommodate CRLF | 1 | Did not rewrite; re-read with the project's line parser and confirmed 219+219 with exact playable parity. |
| Combined playable-queue planning update did not match the BOM-prefixed `progress.md` heading | 1 | Split task plan, findings, and progress into separate narrow patches. |
| Combined Level12 completion patch did not match the BOM-prefixed project progress heading | 1 | Verify no partial changes, then patch the BOM file separately using its first dated section as context. |
| Bundled `pnpm run dev` attempted to rewrite existing `node_modules` metadata and failed with EPERM | 1 | Do not retry dependency installation; launch the already-installed Vite entry directly with the bundled Node runtime. |
| Full Unity catalog regeneration failed because the historical default `D:/备份/改文件名临时文件夹/level7.asset` no longer exists | 1 | Locate the current preserved source paths; if unavailable, use an explicit incremental catalog import that preserves existing generated levels. |
| Combined Level12 planning-file patch did not match the BOM-prefixed `progress.md` heading | 1 | Split the updates into narrow per-file patches that avoid the encoded first line. |
| Planning session catch-up could not start because neither `python` nor the Windows `py` launcher is installed on PATH | 2 | Continue from the existing planning files and inspect the current workspace directly; do not retry the unavailable launchers. |
| A diagnostic PowerShell line-range expression received multiple `Select-String` matches and failed array subtraction | 1 | Switched to a targeted `rg -C` context read and avoided computed line arithmetic. |
| The first combined model correction patch no longer matched the edited source context | 1 | Re-read the exact current block and applied a narrower patch against the verified lines. |
| The first Unity-parity regression run failed the zero-gap fallback and a static generated-field regex | 1 | Matched Unity's `gap <= 0.01 -> 0.1` fallback and asserted the `numberField` call rather than generated runtime markup. |
| Browser QA showed parking area `#0` as an active child container with a false return action | 1 | Restrict active-container inspector fallback to non-zero child-container IDs. |
| Initial combined planning-file patch used a progress-file context that did not match the BOM-prefixed file | 2 | Split the update into narrow heading/current-goal patches and verify each file independently. |
| Initial background asset size probe referenced a nonexistent unoptimized winter filename | 1 | Use the actual editor option path `BG01_split01_q60.jpg` and enumerate the texture directory before further comparisons. |
| PowerShell passed the literal `dist/assets/*.js` wildcard to `rg`, producing Windows path error 123 | 1 | Resolve the generated JS file explicitly or verify the final package using Base64 byte fingerprints instead of a wildcard path. |
| In-app browser load-state helper does not support `networkidle` | 1 | Wait for `domcontentloaded`, allow a short render interval, and inspect the fresh DOM snapshot. |
| Final progress scan found the new durable completion entry duplicated at the document top | 1 | Removed the second identical block and rechecked the heading count. |
| Initial combined plan/progress/findings patch did not match the BOM-prefixed progress heading | 1 | Split the update around the first dated section heading and applied the three planning-file changes successfully. |
| Final multi-pattern `rg` command was split by PowerShell quoting into invalid path arguments | 1 | Keep the successful package/hash checks and rerun config location checks with literal `Select-String` patterns. |
| First Sakura background regression found `SCENE_TUNING` on Sakura while mutable test-state `LEVEL_1.assets.background` remained summer | 1 | Confirmed generated `ACTIVE_LEVEL` is Sakura; move the production-manifest assertion to immutable `ACTIVE_LEVEL` while keeping runtime swap coverage separate. |
| Background sizing regression read JPEG bytes with PNG fixed offsets and reported width 65536 | 1 | Replace the fixed-offset read with a format-aware PNG/JPEG dimension parser and retain exact 2100x3382 assertions. |
| Broad editor-sizing test reached an unrelated stale parking count expectation (`6 !== 5`) after the JPEG parser succeeded | 1 | Do not change parking tuning; assert dimensions in the focused background test and exclude the unrelated broad case from this package verification. |
| First editor-cache synchronization targeted one of two localhost tabs; that tab disappeared on reload while the surviving tab retained old Level15 values | 1 | Synchronize the surviving current tab and verify its controls after reload; production source/package values are already correct. |
| Focused config group included a stale camera assertion expecting elevation 55 while current authored tuning is 61 | 1 | Keep unrelated camera tuning unchanged; rerun the requested Level16/config checks through their focused catalog and threshold/background tests. |
| Browser role lookup for hidden result-overlay elements exceeded its selector deadline | 1 | Used direct id locators for the hidden shared overlay DOM; title, CTA, and logo each resolve exactly once. |
| In-app browser isolated evaluation does not expose a real `document.createElement`, so a temporary main-world win-state script could not be injected | 2 | Do not add a runtime debug hook; verify the win branch with focused model/source-contract tests and inspect the already-shared overlay DOM/logs in browser. |
| Browser label lookup for the DualQueue3 closed-Z input also matched its closed-Z-size input | 1 | Used an exact spinbutton role/name locator and completed the edit/restore QA. |
| Parallel final verification stopped on an over-specific Level15 `rg` expression and hid sibling output | 1 | Reran focused tests and selection checks separately with direct markers. |
| Broader Level9->Level7 session suite failed because the intentional production selection is Level15 | 1 | Kept the Level15 boundary unchanged; relied on the passing focused Level15/Level16 catalog/model regressions for this task. |
| Broader queue filter hit the known stale Level12 expected head color 5 while runtime data starts at color 0 | 1 | Did not alter unrelated historical queue expectations; the four relevant queue/parity tests pass. |
| First duplication diagnostic called nonexistent `game.tick()` | 1 | Used the model's public `game.update()` method; reproduced Level16 growing from 218 to 226 passengers after a non-reset editor reinitialization. |
| Browser tab creation returned a tab outside the current in-app browser session | 1 | Read the browser bootstrap troubleshooting guide and claimed the existing localhost preview tab instead. |
| Planning skill completion checker was not installed under the local `.claude` cache | 1 | Verified the current Level16 phase list directly; all four phases are marked complete and all requested checks pass. |
| Combined Level16 completion-doc patch used a stale current-phase sentence and failed verification | 1 | Re-read the four short document headers and apply narrow per-section updates against current text. |
| Combined Level16 syntax/status probe returned aggregate exit 1 after only printing the Level15 marker | 1 | Separate each syntax and config check so the failing segment is explicit before regeneration. |
| PowerShell queue diagnostic treated integer color keys as ordered-dictionary positional indexes and emitted repeated out-of-range errors | 1 | Preserve the reliable queue lengths/run extraction, then switch the color-total comparison to a Node diagnostic using explicit run arrays. |
| Node diagnostic received the Chinese Unity asset path through the legacy PowerShell pipeline code page as `??` and failed with `ENOENT` | 1 | Separate the pure numeric Node queue calculation from a native PowerShell Unicode-path asset calculation, then compare their small JSON summaries. |
| Full default extraction stopped on pre-existing Level7 because its configured external Unity source now fails the preserved queue/seat parity check across colors 0-8 | 1 | Repointed the default to the matching preserved 83-vehicle source at `D:/备份/改文件名临时文件夹/level7.asset`; existing Level7 data remains unchanged. |
| Level7 drift diagnostic could not serialize a PowerShell hashtable with integer keys to JSON, hiding the paired path-search output | 1 | Emit the small asset summary as plain text/string-key fields and run the candidate-path search independently. |
| First refreshed AppLovin package is 5,926,059 bytes and fails the 5,000,000-byte limit | 1 | All other AppLovin checks pass; share the identical Level9/Level7 asset manifest in generated session data so each binary data URI is inlined only once. |
| First generated-session assertion checked numeric `id` values against level names | 1 | Use the catalog's `key` field (`level9`, `level7`); corrected assertion confirms both order and shared asset-object identity. |
| Combined durable-doc patch did not match the BOM-prefixed progress heading | 1 | Split the update by file and anchor on the first ASCII section heading; all four records were then updated and reread. |
| Exact quoted `rg` check for `levelKey` returned no match under PowerShell quoting | 1 | Read the focused tuning block directly; both guide configs visibly contain `"levelKey": "level9"`. |
| Planning completion checker reported 0/0 because the existing plan used numbered bold statuses instead of its supported phase/status markers | 1 | Added one compatible `### Phase` plus `**Status:** complete` marker for the current package task; retained the detailed numbered checklist. |
| Broad guide `rg` pipeline returned exit 1 after emitting useful matches | 1 | Re-read the exact scene-view method range and guide test directly; use separated verification commands later. |
| Second split patch found the replacement vehicle add already changed by the prior narrow edit | 1 | Re-read the exact method and patch only the remaining old parent/removal and animation blocks. |
| Combined vehicle-root/entrance patch did not match one mixed-line-ending scene-view block | 1 | Split the change into small constructor, vehicle-parent, and animation-method patches using local ASCII anchors. |
| Combined transition-test/queue search returned exit 1 after emitting the requested context | 1 | Treat the emitted context as usable and keep later searches/verification separated so the failing segment is identifiable. |
| Progress update did not match the BOM-prefixed `# Progress` heading | 1 | Insert the entry before the first ASCII dated section instead of matching the first line. |
| Large `src/main.js` patch failed to match the BOM/line-ending-sensitive import block | 1 | Split the edit into narrow patches anchored on individual ASCII sections. |
| Targeted `rg` used a Unix-style `src/*.js` glob that PowerShell passed as an invalid Windows path | 1 | Avoid shell globs for `rg` on this workspace; pass explicit files or use `-g` filters. |
| Planning completion checker was blocked by the current PowerShell execution policy | 1 | Run the same read-only checker in a child PowerShell with `-ExecutionPolicy Bypass`. |
| Final package marker scan expected leading zeros in minified decimals | 1 | Vite emits values such as `-.15425447` and `.95464253`; verify exact vehicle-id/property snippets in the minified package instead. |
| Combined plan/progress patch did not match the BOM-prefixed `progress.md` heading | 1 | Split the files and insert the progress entry before the first dated section using an ASCII anchor. |
| Planning skill session-catchup path under `.codex` did not exist | 1 | Use the actual installed skill path under `.agents`; if Python remains unavailable, rely on planning files plus direct workspace inspection. |
| Browser Use blocked automated navigation to the final local `file://` package | 1 | Do not bypass the URL policy; rely on passed build/static package checks and record AppLovin preview/real-upload play as the remaining manual validation. |
| Focused catalog test read the stale Level9 `generated-active-level.js` before the build pre-step regenerated it | 1 | Run `npm.cmd run level:generate` explicitly from the Level7 marker, then rerun focused tests before the production build. |
| Combined test patch partially applied the guide expectations before failing on a later game-model context | 1 | Re-read both tests, confirmed the guide changes landed, and applied a separate narrow patch for the threshold assertions. |
| Windows UI export was stopped because the automation could not verify the active browser URL with sufficient confidence | 1 | User supplied the complete `window.__busLoop.exportTuning()` JSON directly; use it as the authoritative build input. |
| First tuning-verification snippet reused an undefined scratch variable in the browser helper | 1 | Retried with fresh declared verification variables; all 245 editor fields matched the exported artifact. |
| Browser inspection cannot access `window.__busLoop` from its isolated page context even though the editor DOM is loaded | 1 | Export the authoritative editor state from each `[data-path]` control, then merge those path/value pairs into the existing tuning JSON. |
| Focused test found generated active Level7 while the durable selection marker is currently Level9 | 1 | Preserve the user's current Level9 selection and rerun extraction/generation with `--selected=level9`; Level7 remains updated in the catalog. |
| Final combined `rg` verification exited 1 because the stale-size search intentionally found no matches | 1 | Treat the no-match exit as the expected successful stale-constant check; preceding context output confirmed all requested edits. |
| Combined completion-doc patch did not match the BOM-prefixed project progress heading | 1 | Retried once using the first dated section as an ASCII anchor; the completion record, plan, and progress update landed. |
| Combined extractor/test patch did not match the default source path because the terminal's legacy decoding displayed mojibake | 1 | Re-read the file explicitly as UTF-8 and applied a smaller patch using ASCII anchors; the stored path was already correct. |
| Combined plan/progress update did not match the BOM-prefixed `progress.md` header | 1 | Split the files and use the first dated section as the progress insertion anchor. |
| Planning skill session-catchup could not run because `python` is not installed/on PATH | 1 | Read the existing planning files directly and continue from the current workspace state. |
| Combined active-plan/progress patch did not match the BOM-prefixed `progress.md` header | 1 | Split the update by file and use narrow ASCII section anchors. |
| Plan-only `apply_patch` helper stalled after the combined patch failure | 1 | Terminated the helper and continued with bounded inspection; the later source patch completed successfully. |
| Sandboxed targeted planning-file rewrite was denied despite workspace write scope | 1 | Avoided broad rewriting and returned to `apply_patch` once the helper recovered. |
| Reused editor contract test stopped at the known unrelated background-size mismatch `65536 !== 2100` | 1 | Added and ran an independent success-redirect regression; it and the main-thread wiring test pass 2/2. |
| PowerShell blocked `npm.ps1` under the local execution policy | 1 | Used the standard Windows `npm.cmd` entrypoint; build, packaging, and checks passed. |
| First package-comparison PowerShell command had an incomplete nested subexpression | 1 | Replaced nested interpolation with precomputed variables. |
| Broad regex comparison timed out on the 3 MB single-line HTML package | 1 | Replaced regex scanning with fixed-marker `IndexOf`/`LastIndexOf` slices; all three packages compared successfully. |
| Python executable was unavailable for the temporary local HTTP server | 1 | Switched to the project's installed Vite runtime. |
| Detached Vite shell process exited and the first browser navigation was refused | 1 | Ran Vite as the active long-running Node command and opened a fresh browser tab. |
| First diagnostic click hit a blocked vehicle under the animated guide-hand offset | 1 | Calculated vehicle 130's exact projected canvas center and repeated the real pointer click; gate and MRAID logs passed. |
| Combined active-plan/progress/findings patch did not match the BOM-prefixed `progress.md` header | 1 | Split the update by file and use narrow ASCII section anchors. |
| Several `apply_patch` calls remained in the helper after the patch had landed | 3 | Stopped waiting, reread each target, and confirmed the requested edits were present before continuing. |
| Full `test/game-model.test.js` retains 9 unrelated existing failures (parking count, queue expectation, tuning dimensions/values, blocker/path expectations) | 1 | Verified all three new conveyor catalog/factory/wiring tests independently; keep the existing failures recorded and do not change unrelated behavior. |
| `git status --short` reports that the workspace is not a Git repository | 1 | Continue with direct file inspection and explicit changed-file verification; do not rely on Git diff for this task. |
| Combined planning-file patch did not match the BOM-prefixed `findings.md` header | 1 | Retry with a narrower ASCII section anchor instead of the first line. |
| `apply_patch` helper stalled while appending Unity asset findings | 1 | Terminated the stalled helper; the sandboxed PowerShell fallback was denied and its elevated retry timed out, so retried one smaller patch. |
| PowerShell context helper failed because a drive-letter path was interpolated directly before `:` | 1 | Replaced the helper with direct `rg` context queries and avoided the invalid interpolation form. |
| Catalog test showed prefab `conveyorBeltIndex` order is the reverse of the current web queue-path order | 1 | Normalize extracted queue paths by their head X coordinate (left to right), preserving current web queue IDs across layouts. |
| Focused editor contract test reached existing background dimension failure `65536 !== 2100` | 1 | Keep the known unrelated failure recorded and move new conveyor source contracts into an independent focused test. |
| Sandboxed Vite build failed with Windows `spawn EPERM` | 1 | Elevated `npm run build` passed with the existing chunk-size warning. |
| Browser skill runtime fails at `browser-client.mjs:33` with `Cannot redefine property: process` | 2 | Reset the browser JavaScript session and retried once; same failure. Browser visual QA remains manual because the skill forbids switching to an unsupported fallback surface. |
| Default gameplay regression set still reports `5 !== 6` for parking-spot count | 1 | Recorded as the pre-existing tuning/test mismatch; all new conveyor and DualQueue2 entrance tests in the same run passed. |
| Large documentation patch and the smaller code-navigation retry both stalled in `apply_patch` | 2 | Terminated both helpers and used the authorized targeted PowerShell fallback; corrected two PowerShell backtick escape artifacts immediately after rereading. |
| First artifact refresh wrote a literal `\\n` after the JSON object | 1 | Rewrote `artifacts/scene-tuning.json` using `String.fromCharCode(10)` and verified JSON parsing/layout keys. |

| Final line-number search used a PowerShell-escaped regular expression that reached `rg` with an unclosed group | 1 | Switched to literal `Select-String` lookups; implementation and verification were unaffected. |
| Combined Level40 completion-doc patch did not match the AppLovin audit's actual title | 1 | Verified the patch was atomic, reread the five targets, and split the documentation updates around their exact headings. |
| First split documentation read contained a malformed JavaScript token in the orchestration wrapper | 1 | Corrected the wrapper and reran the same read-only checks successfully. |

## Context Pointers

- Current status: `docs/project/playable-project-progress.md`
- Code map: `docs/project/code-navigation.md`
- Durable findings: `findings.md`
- Resource status: `docs/project/playable-resource-status.md`


## YXH BL-2610284 HTML Material Baseline (2026-11-05)

1. **Complete:** Imported the supplied material into isolated `variants/BL-2610284`, preserving editor work.
2. **Complete:** Built the AppLovin baseline under the user's explicit original-resource exception; froze exact bytes and passed static, payload, Android/iOS trusted-input runtime, and four-viewport layout checks.
3. **Pending external acceptance:** Checker, official Preview, representative ad hosts/devices. User requested AppLovin first; UN/MO are deferred.
4. Evidence: `playable-runs/20261105-bl-q201v2-applovin-v1.0.1-repo/applovin-baseline.json` and `delivery-summary.md`. No Git commit/push or deployment.
