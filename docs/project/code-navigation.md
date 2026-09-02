# Code Navigation

Use this file before code changes. Pick the closest change area, then read only the listed files and their paired tests. Broaden the search only when the navigation does not cover the request.

## Change Target Map

| Change area | Start here | Also check |
| --- | --- | --- |
| App bootstrap, HUD, input, reset, localStorage tuning, branding image/text positioning and dragging, QA API | `src/main.js` | `index.html`, `src/styles.css` |
| Runtime audio events and WebAudio playback | `src/audio-controller.js` | `src/main.js`, `src/level-data.js`, `src/scene-view.js`, `test/game-model.test.js` |
| Core gameplay rules, click handling, blockers, spots, queues, boarding, win/fail | `src/game-model.js` | `src/level-data.js`, `src/vehicle-motion.js`, `test/game-model.test.js` |
| Runtime vehicle collision graph, Unity vehicle sizes, oriented contact edges | `src/vehicle-collision.js` | `src/game-model.js`, `test/vehicle-collision.test.js` |
| Level constants, colors, fixed passenger sequence, vehicle/spot source data | `src/level-data.js` | `src/game-model.js`, `test/game-model.test.js` |
| Imported Unity level catalog and narrow production session selection | `src/level-catalog.js` | `src/generated-active-level.js`, `scripts/extract-unity-levels.mjs`, `scripts/generate-active-level.mjs`, `test/level-catalog.test.js` |
| Multi-level playable session order, shared CTA operation count, and win handoff | `src/level-session.js` | `src/main.js`, `src/generated-active-level.js`, `src/scene-view.js`, `test/level-session.test.js` |
| Conveyor layouts and prefab-derived paths | `src/conveyor-layouts.js` | `src/scene-view.js`, `src/game-model.js`, `src/scene-tuning.js`, `test/game-model.test.js` |
| Unity conveyor prefab extraction | `scripts/extract-unity-conveyor-layouts.mjs` | `src/conveyor-layouts.js`, `artifacts/unity-conveyor-layouts.json` |
| Standalone spatial conveyor import, production generation, runtime catalog, and rendering | `scripts/spatial-conveyor-importer.mjs` | `scripts/generate-active-spatial-conveyor.mjs`, `src/generated-active-spatial-conveyor.js`, `src/spatial-conveyor-runtime.js`, `vite.config.js`, `src/scene-editor.js`, `src/scene-view.js`, `src/game-model.js`, `test/spatial-conveyor-importer.test.js`, `tools/spatial-conveyor-import-support/bus-loop-spatial-v1/` |
| On-demand spatial conveyor point editing, selection, transforms, history, and explicit JSON saves | `src/spatial-conveyor-editor.js` | `src/spatial-conveyor-edit-model.js`, `src/spatial-conveyor-editor.css`, `src/spatial-conveyor-runtime.js`, `src/scene-editor.js`, `src/scene-view.js`, `src/main.js`, `vite.config.js`, `test/spatial-conveyor-editor.test.js` |
| Three.js scene rendering, camera, picking, assets, vehicles, passengers, shadows | `src/scene-view.js` | `src/scene-tuning.js`, `src/scene-layout.js`, `test/game-model.test.js`, `test/guide-hand.test.js` |
| Scene/editor tuning values | `src/scene-tuning.js` | `src/scene-editor.js`, `src/scene-view.js`, `scripts/apply-scene-tuning.mjs`, relevant tests |
| Editor UI controls, toggle/text fields, Icon/Logo/text adjustment, and control grouping | `src/scene-editor.js` | `src/scene-tuning.js`, `src/styles.css` |
| Responsive layout math, curve transforms, camera fit helpers | `src/scene-layout.js` | `test/scene-layout.test.js` |
| Vehicle routes, click-to-station paths, station departure, collision distance, hit clips | `src/vehicle-motion.js` | `src/game-model.js`, `test/game-model.test.js` |
| Vehicle departure ribbons/smoke, boarding smoke, particle motion | `src/vehicle-effects.js` | `test/vehicle-effects.test.js`, `src/scene-tuning.js`, `src/scene-view.js` |
| Page structure, canvas mount, branding image/text overlay, end panel, editor mount | `index.html` | `src/main.js`, `src/styles.css` |
| Visual CSS, HUD, branding overlay, editor panel, phone preview, responsive behavior | `src/styles.css` | `index.html`, `src/scene-editor.js` |
| Build/test scripts or dependency changes | `package.json` | Lockfile if dependency versions change |
| Vite development server and durable editor level selection | `vite.config.js` | `artifacts/selected-level.txt`, `src/main.js`, `scripts/generate-active-level.mjs` |
| AppLovin single-HTML packaging | `scripts/package-applovin-single-html.mjs` | `scripts/check-applovin-package.mjs`, `package.json`, `docs/platforms/applovin-playable-audit.md` |
| Unity VAT extraction utility | `scripts/extract-unity-vat.mjs` | `tools/unity-vat-export/Packages/manifest.json` |
| Game model regressions | `test/game-model.test.js` | `src/game-model.js`, `src/vehicle-motion.js`, `src/scene-tuning.js` |
| Scene layout regressions | `test/scene-layout.test.js` | `src/scene-layout.js` |
| Effect regressions | `test/vehicle-effects.test.js` | `src/vehicle-effects.js` |

## File Responsibilities

### Root/config

- `index.html`: DOM shell for the playable. Owns `#app`, `#stage`, `#game-canvas`, branding image/text overlay, message overlay, end panel, reset button, and `#scene-editor` mount.
- `package.json`: npm metadata, Vite scripts, `node --test` test script, and dependency list.
- `scripts/package-applovin-single-html.mjs`: AppLovin packaging utility. Reads Vite `dist`, inlines built JS/CSS and `/assets/...` files as data URIs, and writes `artifacts/applovin/index.html`.
- `scripts/check-applovin-package.mjs`: AppLovin static upload precheck for `artifacts/applovin/index.html`, including size, single-file, inline-resource, WAV, remote URL, and MRAID CTA checks.
- `scripts/apply-scene-tuning.mjs`: Applies exported editor tuning JSON from `artifacts/scene-tuning.json` (or `--input`) into `src/scene-tuning.js` and synchronizes `artifacts/selected-level.txt` before production packaging.
- `scripts/spatial-conveyor-importer.mjs`: Standalone Node importer for the BusLoop `ConveyorBeltTemplate` spatial-track family. Merges prefab overrides with bundled Dreamteck/template support, embeds required textures, and writes one removable JSON package per imported prefab under `artifacts/spatial-conveyors/`.
- `scripts/generate-active-spatial-conveyor.mjs`: Reads the baked conveyor selection, validates the matching imported JSON package, and generates the single spatial conveyor payload included in production builds.
- `tools/spatial-conveyor-import-support/bus-loop-spatial-v1/`: Editor-owned Unity/Dreamteck support package used by the spatial importer; imports do not read the external BusLoop Unity project.
- `tools/unity-vat-export/Packages/manifest.json`: Unity package manifest for the VAT export helper project.

### Runtime source

- `src/main.js`: Browser entry point. Wires `BusLoopGame`, `SceneView`, `GameAudioController`, and `createSceneEditor`; handles saved tuning migration, responsive branding image/text positioning, text fitting and dragging, HUD sync, reset, long press speed-up, animation frame loop, and `window.__busLoop` QA/debug API.
- `src/audio-controller.js`: Runtime audio bridge. Owns Unity-named sound config playback, WebAudio unlocking/preloading, random clip choice, game-event de-duping, and passenger-up playback.
- `src/game-model.js`: Pure gameplay state machine. Owns vehicle click handling, blocker checks, station assignment, route progress, conveyor/queue passenger flow, boarding events, win/fail checks, snapshots, and subscriptions.
- `src/vehicle-collision.js`: Unity-style runtime collision context. Owns per-vehicle collision sizes, current-pose oriented boxes, drive-out graph decisions, direct candidates, and edge contact points.
- `src/level-data.js`: Small runtime boundary that exports colors and the mutable live `LEVEL_1` binding backed by the current generated session level.
- `src/level-session.js`: Pure two-level session state. Owns current level order, level-scoped successful-vehicle de-duplication, shared CTA/install count, win advancement, and full-session reset.
- `src/level-catalog.js`: Generated development-only catalog for the six imported Unity levels plus the legacy baseline used as extraction/template data.
- `src/generated-active-level.js`: Generated narrow production payload containing the selected active level and any explicit in-session follow-up level.
- `src/generated-active-spatial-conveyor.js`: Generated narrow production payload containing the selected imported spatial conveyor, or `null` for an ordinary conveyor selection.
- `src/scene-view.js`: Main Three.js renderer. Owns scene construction, camera/background fit, texture/model/VAT loading, path curves, parking spots, vehicle/passenger visuals, shadows, arrows, seat boards, effects integration, picking, snapshot rendering, resize, and per-frame render.
- `src/scene-tuning.js`: Single mutable tuning object. Owns editor-facing values for preview/crop, branding image/text visibility/lock/content/geometry, camera, facing, path transforms, background, conveyor art, parking spots, seat boards, vehicle paths, vehicle area mapping, passengers, shadows, arrows, and effects.
- `src/scene-editor.js`: Generated editor panel. Owns `FIELD_GROUPS`, input/range/select/toggle/text bindings, Icon/Logo/text adjustment controls, nested tuning path get/set helpers, collapsed UI behavior, reset-to-default hook, and editor labels.
- `src/spatial-conveyor-runtime.js`: Shared spatial package registry plus Unity transform application and Dreamteck repeated-mesh geometry generation. Development packages come from Vite endpoints; production registers the generated active package before scene creation.
- `src/spatial-conveyor-edit-model.js`: Pure spatial-point editing state. Owns stable imported pivots, selection, curve-sampled insertion, prepend/append/delete, and bounded undo/redo history.
- `src/spatial-conveyor-editor.js`: Development-only on-demand spatial point editor. Owns Three.js point handles, TransformControls, box/range/multi-selection, numeric point editing, live preview, explicit save/save-as, and unsaved-change handling.
- `src/spatial-conveyor-editor.css`: Development-only overlay, toolbar, point-property panel, and mobile layout for the spatial point editor.
- `src/scene-layout.js`: Pure layout helpers. Owns orthographic half-height calculation, perspective distance calculation, and curve coordinate transform logic used by the renderer and tests.
- `src/vehicle-motion.js`: Unity-style vehicle motion math. Owns motion constants, Unity AnimationCurve sampling, path construction to stations, station exit paths, rounded path baking, path evaluation, station/collision speed selection, collision distance, hit direction, and hit clip sampling.
- `src/vehicle-effects.js`: Particle/effect runtime. Owns Unity effect defaults, Effect_Ribbon departure burst, Ribbon_01 3x3 atlas frame sampling, ParticleSmoke, boarding smoke, speed-over-lifetime sampling, movement range clamping, particle disposal, and per-frame effect updates.
- `src/styles.css`: Layout and UI styling. Owns full-screen stage, canvas sizing, responsive branding overlays, HUD, message toast, end panel, editor panel, collapsed editor state, mobile layout, and phone preview framing.

### Tests/scripts

- `test/game-model.test.js`: Broad regression suite for gameplay, tuning invariants, source-asset existence, scene-view source contracts, VAT mesh layout, vehicle paths, collision/hit behavior, and route tuning.
- `test/scene-layout.test.js`: Unit tests for camera/layout helper math and curve transforms.
- `test/vehicle-effects.test.js`: Unit tests for Effect_Ribbon, ParticleRibbon atlas behavior, ParticleSmoke, speed-over-lifetime, and editor-driven effect tuning.
- `scripts/extract-unity-vat.mjs`: Node utility that reads Unity texture YAML `_typelessdata` and writes the top mip raw VAT texture bytes for the web runtime.
- `scripts/extract-unity-levels.mjs`: Parses supplied Unity level YAML into the development catalog/artifact, applies authored vehicle/queue overrides, and validates per-color passenger totals against vehicle seats.
- `scripts/generate-active-level.mjs`: Reads baked scene tuning and emits the selected production session (Level9 followed by Level7 when Level9 is selected) before Vite builds.
- `test/level-catalog.test.js`: Imported level counts, queue pairing, narrow production-session boundary, and editor/build wiring regressions.
- `test/level-session.test.js`: Level9-to-Level7 production sequence, shared CTA/install count continuity, repeated-id namespacing, vehicle-only entrance/stationary-conveyor wiring, two-sided queue restart, and end-page suppression regressions.
- `test/vehicle-collision.test.js`: Focused geometry graph, vehicle-size, reset, station-ordering, contact, and blocked-click regressions.
- `test/guide-hand.test.js`: Focused guide target, active-level scope, timed mask, editor wiring, and horizontal art/motion mirroring regressions.
- `test/spatial-conveyor-importer.test.js`: Spatial prefab array-size trimming, 3D point overrides, embedded visual support, output naming, input rejection, and editor/dev-service wiring.
- `test/spatial-conveyor-editor.test.js`: Spatial point insertion/history, stable pivot, minimum point count, forward/inverse coordinate mapping, and on-demand editor/save wiring regressions.

### Conveyor layout subsystem

- src/conveyor-layouts.js: generated catalog for DualQueue2/3/5/10 art, closed/queue splines, capacities, exit ranges, and maximum pools.
- scripts/extract-unity-conveyor-layouts.mjs: reads direct/nested Unity spline overrides, merges DualQueue5 with ConveyorBelt6, normalizes queues left-to-right, and regenerates the catalog/inspection JSON.
- src/scene-view.js owns selected-layout rendering; src/scene-tuning.js owns selected/per-layout editor transforms; src/level-data.js retains legacy DualQueue2 fields for compatibility.
- Imported spatial packages are discovered from `artifacts/spatial-conveyors/*.json` by the Vite editor service. They are selectable in development, render through the imported 3D spline/SplineMesh data, and use one direct entrance; point and entrance editing are still pending.

## Maintenance Rule

Update this file when code files are added, removed, renamed, or when a file's main responsibility moves. Do not update it for small internal refactors that keep the same ownership boundaries.


