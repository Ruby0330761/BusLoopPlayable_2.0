# Playable Project Progress

## Completed On 2026-09-07 - Conveyor narrow-gap collision guard

- Added a conveyor-only forward corridor rule: gaps between two obstacles narrower than `1.2` times the narrowest configured vehicle collision width are treated as blocked when a conveyor vehicle exits through them.
- The rule is applied consistently to drive-out checks and collision feedback, selects the nearest forward obstacle, and uses a transient expanded box without changing authored geometry or ordinary vehicle behavior.
- Verification: `test/vehicle-collision.test.js` passes all 14 cases and touched-file syntax checks pass.

## Completed On 2026-09-07 - Conveyor parameters fixed from user-provided values

- Applied the values transcribed from the user's three tuning screenshots: belt `Y=-0.01/Z scale=1.50`, arrow `X scale=1.50/Z scale=1.05`, both doors `Z scale=1.20/X rotation=150°`, and side panels at `X=-4.00/+4.00`.
- Removed the temporary per-component menu again and made the fixed config the only runtime source for these transforms.
- Migrated stale saved `conveyorVisual` values out of editor startup and tuning export paths so reset/default cannot overwrite the baked mechanism values.
- Verification: conveyor configuration and behavior tests, touched-file syntax checks, browser reload with no error logs, production build, AppLovin packaging, and all static package checks pass. Final single HTML is `4,597,384` bytes.

## Completed On 2026-09-07 - Mechanism-aware resource pruning and AppLovin packaging

- Added the shared mechanism registry and moved mechanism resources into owned folders for ordinary/spatial conveyors, luxury vehicles, ambulances, turn vehicles, hidden vehicles, garages, and vehicle transport belts. Spatial conveyor textures remain embedded in their imported JSON packages.
- Unity level import/extraction now persists `mechanics.isMechanicLevel`, ordered `mechanics.types`, and per-type counts. Ordinary levels are explicitly tagged as non-mechanism levels while retaining `ordinaryConveyor`.
- AppLovin packaging now computes a production-session whitelist from those tags plus the selected spatial conveyor, inlines selected resources only, and replaces omitted asset references with tiny placeholders. The package checker verifies both inclusion and omission.
- Final verification used `level28`: `npm run build`, `npm run package:applovin`, and `npm run check:applovin` passed; output is `4,598,228` bytes (`4.385 MiB`), below the `5,000,000` byte limit. No resource re-encoding or content modification was performed in this task.

## In Progress On 2026-09-07 - Conveyor component tuning reopened

- Reopened the temporary six-component conveyor submenu after the previous component values were found to be incorrect.
- Reset the temporary menu and fixed component baseline to neutral transforms: position/rotation `0`, XYZ scale `1`; the confirmed root/door/visibility mechanism values remain unchanged.
- Waiting for the user's final per-component values before the next permanent bake.

## Completed On 2026-09-07 - Conveyor visual parameters fixed after arrow retune

- Re-read the live editor after the final arrow adjustment: all six conveyor components use zero XYZ position/rotation offsets and `2.01` XYZ component scale.
- Baked those values into `src/conveyor-mechanism-config.js` alongside the confirmed root scale, door spacing, and right-edge visibility values.
- Removed the temporary per-component submenu and migrated old saved/exported `conveyorVisual` overrides out of reset/apply paths, so restoring editor defaults cannot change the conveyor mechanism.
- Verification: fixed-configuration regression, syntax checks, browser reload with no error logs, and temporary-menu absence check pass.

## Completed On 2026-09-07 - Forward gap collision guard

- Matched Unity's forward sweep filtering more closely and added a conservative front-of-vehicle radius guard for narrow gaps formed by multiple vehicles.
- Added projected contact fallback so a valid forward blocker cannot be skipped when edge-ray intersection is numerically empty; direct candidates are merged without overriding exact geometry targets.
- Verification: vehicle-collision suite passes (11/11), conveyor/audio/collision focused cases pass, and touched-file syntax checks pass. Full-suite baseline still contains unrelated pre-existing resource, level, and editor-contract failures.

## Completed On 2026-09-04 - Conveyor blocking, spacing, and audio correction

- Fixed full-vehicle audio races by keeping only the newest pending `bus_full` playback and stopping an older active instance of the same effect.
- Conveyor vehicles now retain their authored slot count and spacing after departures, leaving visible empty slots instead of compressing the queue.
- Conveyor collision selection follows the next occupied authored slot, and wall contacts now emit the same hit effect as vehicle contacts; door overlay inner edges use the collision exit width.
- Verification: 20 focused conveyor/audio/effect/collision tests and touched-file syntax checks pass; production build and AppLovin packaging pass (`6,978,158` bytes). The optional 5 MB check remains the only reported failure.

## Completed On 2026-09-04 - Conveyor side-panel layer and transform tuning

- Reworked conveyor side blockers into persistent left/right panel nodes with dedicated visible rail geometry; they remain shown while the conveyor container exists and no longer depend on a vehicle being directly blocked.
- Added temporary editor controls for each side panel's XYZ position and XYZ rotation, plus `bodyLengthScale`, which changes only the belt/arrow body length while leaving blocker length unchanged.
- Verification: local level22 preview shows continuous side rails and the new editor fields; conveyor contract/behavior tests, syntax checks, production build, and AppLovin packaging pass. The static AppLovin check remains limited only by the deferred 5,000,000-byte size threshold.

## Completed On 2026-09-04 - Temporary conveyor visual tuning submenu

- Added the temporary editor submenu `传送带视觉（临时）` with independent controls for conveyor length, conveyor width, and the spacing of the two side occlusion panels.
- Applied length/width tuning to the conveyor visual root only, keeping conveyor vehicles, passenger paths, and collision geometry unchanged; side panels remain visible whenever the conveyor exists and hide only with the conveyor's own empty/hidden state.
- Verification: touched-file syntax checks, exact conveyor resource/visibility contract test, nearest-forward collision test, empty-conveyor visibility test, production Vite build, and AppLovin single-file packaging completed. AppLovin static checks pass except the already-deferred 5,000,000-byte package limit; full suite remains at the existing baseline failures.

## Completed On 2026-09-04 - Conveyor collision and build visuals

- Increased the conveyor belt, arrow, and end-cap/side visual root to `1.375x` overall (an additional 10% over the previous `1.25x` pass) while leaving conveyor vehicle meshes and collision logic unchanged.
- Added dynamic same-belt vehicle obstacles and nearest-forward overlap selection, preventing a conveyor vehicle from skipping a directly blocking vehicle.
- Imported the current Unity `plane_conveyor_build` DoorLeft/DoorRight/Leftside/Rightside textures and render them as transparent occlusion overlays synchronized with belt rotation and empty-belt hiding.
- Verification: importer/collision tests (26/26 focused cases) plus conveyor behavior/resource regressions, touched-file syntax checks, production Vite build, and AppLovin packaging pass. The existing 5,000,000-byte static package limit remains deferred by request.

## Completed On 2026-09-04 - Luxury material brightness finalized

- Fixed the luxury vehicle, passenger, and count-board brightness at `2.55`, `1.90`, and `1.15` respectively, matching the accepted visual tuning.
- Restricted passenger brightness updates to visual instances explicitly marked `isLuxuryPassenger`, so ordinary passengers are not affected by wealthy-passenger tuning.
- Removed the temporary luxury material editor submenu and migrated old saved tuning so it cannot override the fixed values.
- Verification: focused luxury/editor tests, touched-file syntax checks, and production Vite build pass; the existing large-chunk warning remains.

## Completed On 2026-09-04 - Luxury material brightness correction

- Restored the Unity limousine material mapping: `Idle_wealthy.png` is the main color map and the two limousine textures are Matcap maps, with Unity brightness, diffuse strength, and emission values applied.
- Added the Unity body/clothing emission response for wealthy passengers and restored the authored metallic-looking highlights without changing ordinary vehicle or passenger materials.
- Kept the luxury count board's material color white so its built-in gold artwork is not darkened by the generic color palette.
- Verification: luxury-focused tests, syntax checks, production Vite build, and level29 browser preview pass; only the existing FBX/WebGL loader warnings remain.

## Completed On 2026-09-04 - Luxury passenger visual offset finalized

- Fixed the luxury passenger's complete visual group at `X=-0.12`, with `Y=0` and `Z=0` unchanged.
- The offset is applied to a dedicated internal visual parent, so the model, shadow, and attached visual content move together without changing vehicle interaction or collision positions.
- Removed the temporary XYZ offset editor controls and added migration cleanup for old saved offset values.

## Completed On 2026-09-04 - Luxury passenger rotation finalized

- Fixed the luxury passenger model rotation at `X=90°`, `Y=0°`, `Z=-90°` after editor-side manual tuning.
- Removed the temporary three-axis scene-editor controls and the corresponding tuning fields; ordinary passengers and shadows remain unaffected.
- Verification: focused luxury scene contract test and production Vite build pass. The broader suite retains the existing unrelated tuning expectation failures.

## Completed On 2026-09-04 - Luxury vehicle and passenger parity follow-up

- Matched the Unity limousine material mapping: `bus_limousine`/`Luxury.png` remains the dark group 0 and `bus_limousine_metal`/`Luxury_metal.png` is the gold group 1, both retaining Unity's `4.1` Matcap brightness.
- Corrected the wealthy passenger's coordinate basis: FBXLoader keeps the imported `+90°` X conversion, so the asset root is corrected by `-90°`; Unity bone animation quaternions now mirror Y/Z before application. The runtime uses only the prefab's authored `90°` Y rotation, with no extra X/Z visual-root rotation.
- Removed unused luxury passenger VAT requests from the runtime load path. Luxury passengers use the compressed skinned FBX, Unity body/clothing textures, and the extracted 30 FPS Idle/Move bone curves.
- Verification: luxury source-contract and animation payload tests pass, touched-file syntax checks pass, production Vite build succeeds with only the existing chunk-size warning, and the level29 browser preview shows upright passengers and corrected vehicle materials.

## Completed On 2026-09-04 - Vehicle conveyor-belt mechanism import

- Added Unity type 3 conveyor containers to the level importer/extractor, including belt width, vehicle count, and strict container/configuration validation.
- Imported `Level_Escape_D/level22.asset` as an editor-owned sample: 40 vehicles, 1 conveyor, 8 conveyor vehicles, and 238 passengers; the production selection remains unchanged.
- Implemented Unity-style visible-width spacing, continuous vehicle movement, exit-range collision checks, belt removal on dispatch, and automatic hiding when empty.
- Added the current Unity conveyor FBX/arrow models and textures to the scene renderer with animated arrow UVs and state-driven vehicle visibility.
- Verification: focused conveyor/importer/collision tests pass, touched-file syntax checks pass, `npm run build` succeeds with only the existing Vite chunk-size warning, and browser QA on `level22` confirms the belt assets load and conveyor vehicles keep moving. AppLovin packaging succeeds; the current single HTML is `6,917,534` bytes and the 5,000,000-byte limit remains intentionally deferred.

## Completed On 2026-09-04 - Hidden vehicle interaction and turn audio follow-up

- Lifted hidden vehicle rendering from pure black to charcoal `0x2a2a2a` so scene lighting remains readable while preserving the hidden-state look.
- Unrevealed hidden vehicles now remain pickable: a blocked click uses the normal collision feedback, while a clear click starts the 0.5-second reveal; after reveal the vehicle dispatches normally.
- Turn completion audio now deduplicates by a per-completion event id, allowing the same turn vehicle to play its cue again in a later turn while keeping one cue for simultaneous vehicles.
- Focused hidden/turn tests and touched-file syntax checks pass. The full suite retains the previously known unrelated failures; production packaging is still pending this pass.

## Completed On 2026-09-03 - Luxury visual orientation and material correction

- Corrected the imported `Idle_wealthy` FBX's +90 degree X conversion by baking a -90 degree X rotation before normalization; the passenger now stands upright and follows the Unity prefab's 90 degree root yaw.
- Replaced the clothing-only gray matcap render with the authored `Idle_wealthy.png` atlas on both luxury passenger material groups, retaining warm emissive tint for the clothing layer.
- Applied gold tints derived from the Unity limousine material's `_EmissionCol` to both vehicle material groups; the vehicle now renders gold while preserving the two authored matcap textures.
- Verification: luxury-focused tests, touched-file syntax checks, production Vite build, and local level29 preview pass. The AppLovin single HTML was regenerated at 6,813,986 bytes; all static checks pass except the pre-existing 5,000,000-byte size limit.

## Completed On 2026-09-03 - Hidden vehicle import and runtime parity

- Preserved Unity `vehicles[].isHidden` through level import and editor catalog generation, so imported levels can use hidden vehicles without the source Unity project.
- Reproduced the Unity `MechanismHiddenVehicle` rule: hidden vehicles remain physical blockers, automatically start revealing only after their drive-out path is clear, remain unavailable during the 0.5-second reveal, and become ordinary vehicles after the reveal completes. The playable also permits an explicit click: blocked clicks collide and clear clicks start the same reveal.
- Added the editor-owned compressed four-, six-, and ten-seat hidden-shape support, the question-mark model/texture, and the compressed `hidden_reveal.wav` delivery asset. Hidden vehicle bodies use a readable charcoal equivalent of Unity's `bus_hidden` black material while hidden, and the marker cannot expand the vehicle click target.
- Focused hidden-vehicle state, importer, resource-format, and picking-contract tests pass; production build and AppLovin packaging pass. The current AppLovin single HTML is `6,813,719` bytes. Hidden resources add `191,113` raw bytes and approximately `254,824` bytes after base64 inlining; the remaining size-limit failure comes from existing workspace resources and is tracked separately.
- Matched the Unity `bus_c_4/6/10.prefab` hidden `Arrow_01` placement by moving the question marker to the vehicle's forward edge with a small in-bounds inset. The marker remains visual-only and does not expand the vehicle pick target.
- Corrected hidden vehicle visuals: restore the authored black hidden material, apply hidden-model size matching on top of its existing normalized scale, and preserve the normal model's normalized scale through reveal so hidden vehicles do not become oversized.

## Completed On 2026-09-07 - Web LevelEditor migration

- Added a full-screen browser level authoring workspace for vehicles, garages, conveyors, gate queues, elevators, passenger queues, dependencies, and Unity vehicle-mechanism fields.
- Added selection/box selection, move/rotate/mirror/align/center, grid and vehicle snapping, guides, clipboard commands, undo/redo, depth rebuild, validation, JSON import/export, Unity/CSV/Excel export, and playable preview.
- Added vehicle rotation shortcuts: `Q/E` rotates every selected vehicle in place by 15 degrees, while `Alt+Q/E` follows Unity's anchor rotation by changing both coordinates and angles around one fixed selection center for the full Alt hold.
- Added revisioned development saves with overwrite conflict detection and backups. Browser QA saved the first durable Level9 baseline to `artifacts/web-levels/level9.json` with 37 vehicles and 262 passengers.
- Focused editor/import tests pass 19/19; production build passes with only the existing Vite chunk-size warning. Desktop and 390x844 browser QA found no horizontal overflow or new error-level logs.
- The authoring schema preserves all inventoried Unity mechanism fields, but the current playable runtime does not yet simulate every linkage, wrench/gear, combination, garage, gate, elevator, or firetruck behavior.

## Completed On 2026-09-03 - Turn vehicle completion audio correction

- Replaced the incorrectly selected gear-repair completion cue with the user-confirmed Unity `guidemove.wav`; the delivery asset is stored as `public/assets/unity/audio/guidemove.bin`.
- Re-encoded the 44.1 kHz stereo source as 16 kHz mono 16-bit PCM, reducing it from 49,568 to 8,632 bytes.
- Added a deduplicated `turn_vehicle_complete` event so one sound plays when one or more turn vehicles finish their 180-degree rotation, including same-frame completions.
- Production build, focused turn-vehicle tests, AppLovin packaging, and static checks pass after the replacement. Final single HTML is 4,724,564 bytes; the replacement audio adds 11,516 bytes after base64 inlining, leaving 275,436 bytes below the 5,000,000-byte limit.

## Completed On 2026-09-03 - Turn vehicle visual parity correction

- Added Unity's dedicated `Arrow_02` turn-vehicle marker as a compressed editor-owned asset; turn vehicles now use it while ordinary vehicles keep `Arrow_01`.
- Reset turn-vehicle orientation to the normal parking-spot orientation after arrival, so the 180-degree garage turn does not persist in the station.
- Added focused visual source/asset regression coverage. Production build and AppLovin checks pass; the refreshed single HTML is `4,892,146` bytes.
- Fixed the compressed marker asset's `.gz` URL, which Vite was transparently decoding before the runtime decoder; the raw gzip bytes now use `Arrow_02.fbx.bin` and preserve real Unity vehicle rendering.
- Reduced the turn marker to 80%, moved it along the runtime vehicle `+Z` forward axis within the body-length limit, and excluded marker meshes from pointer picking so the adjustment cannot steal clicks from nearby vehicles.
- Wrapped both marker variants in a centered visual node so their geometry center, rather than the imported model root's offset origin, follows the vehicle rotation axis. This prevents the turn marker from drifting relative to the vehicle during the 180-degree rotation.
- Focused turn-vehicle tests pass 3/3, syntax check passes, production build and AppLovin static checks pass; the refreshed single HTML is `4,724,700` bytes.

## Completed On 2026-09-03 - Unity turn vehicle import and runtime parity

- Extended the existing Unity `level<number>.asset` importer and extractor to preserve `isTurnVehicle`, report turn-vehicle counts, and keep accepted sources in the editor-owned catalog path.
- Added Unity turn-vehicle behavior: after any successful vehicle dispatch, every other turn vehicle rotates clockwise 180 degrees over `0.25s`; turn vehicles cannot be selected during the rotation and regain availability when it completes.
- Verified the real Unity samples `level16.asset`, `level17.asset`, and `level114.asset` as editor-importable with 13, 19, and 25 turn vehicles. Production build, AppLovin packaging, and all AppLovin static checks pass; final package size is `4,861,770` bytes.

## Completed On 2026-09-03 - Ambulance countdown audio compression

- Re-encoded the imported one-second ambulance warning sound as mono 22.05 kHz PCM WAV, reducing it from 179,350 to 44,324 bytes while preserving browser-native decoding.
- Rebuilt the AppLovin package at 4,712,584 bytes; the audio budget test, package checks, and packaged-page load check pass.
## Completed On 2026-09-03 - Ambulance step indicator second scale pass

- Enlarged the ambulance step indicator by another 20% and increased only the countdown font by 10%; its lower position and non-pickable behavior remain unchanged.
- Rebuilt and checked the AppLovin package at 4,892,620 bytes; packaged-page load has one canvas and no error-level console logs.
## Completed On 2026-09-03 - Ambulance step indicator sizing and hit isolation

- Enlarged the ambulance step countdown indicator by 20% and lowered it by 10% relative to its previous vertical offset.
- Disabled raycast interaction on the indicator so its larger visual footprint cannot expand vehicle click targets or interfere with nearby vehicle selection.
- Ambulance indicator test, production build, AppLovin packaging, and final packaged-page load check pass; package size is 4,892,575 bytes.
## Completed On 2026-09-03 - Ambulance passenger forward direction

- Removed the incorrect extra yaw compensation from the ambulance VAT passenger, which was making the rescuer walk backward relative to the runtime path.
- Rebuilt the AppLovin package at 4,861,768 bytes; the final packaged page loads with a canvas and no error-level console logs.
## Completed On 2026-09-03 - Ambulance passenger display correction

- Replaced the ambulance passenger's fragile RGB VAT sampling path with runtime RGBA8 expansion while retaining the compressed VAT payload, and regenerated the animation map without Unity's `none_anim` frame.
- Restored the authored Idle/Move frame ranges, rebuilt the production output, and verified the AppLovin package embeds the ambulance assets at 4,861,770 bytes, below the 5,000,000-byte limit.
- The ambulance-focused source/asset test passes; the broader game-model suite remains at 33/44 because of 11 unrelated pre-existing tuning and collision expectations.

## Completed On 2026-09-03 - Ambulance mechanism import and playable parity

- Added validated `vehicleAmbulances` import/extraction, six-seat color-13 ambulance gameplay, per-successful-dispatch countdown/failure rules, warning audio, special result messaging, ambulance/rescuer models and materials, and the world-space heart countdown UI.
- Corrected the rescuer FBX from authored Z-up to runtime Y-up before shared passenger height normalization, so ambulance passengers now stand upright and match ordinary passenger scale/orientation.
- Ambulance/importer tests pass 5/5, browser QA shows the corrected passengers with zero error logs, production build passes, and AppLovin packaging passes at `4,827,060` bytes with all six ambulance assets embedded. The broader combined test run still has 11 unrelated stale tuning/collision/source-contract expectations.

## Completed On 2026-09-02 - Branding default adjustment

- Updated the baked and exported branding defaults to Icon Y `2018`, Logo X `0`, Logo Y `2023`, and Logo width `230`; unspecified Icon/Logo fields remain unchanged.
- The focused branding editor test and production build pass, and the current editor values were synchronized without browser errors.

## Completed On 2026-09-02 - Fish shape editor defaults restored

- Restored `src/scene-tuning.js`, `artifacts/scene-tuning.json`, and the durable level selection from the supplied Fish shape AppLovin package. The baked defaults now select level13 and `ConveyorBeltShape`, including guide vehicle 130 and spatial exit Z `0.6`; the newer independent exit Y `0.15` remains available.
- Fixed the editor reset baseline so `恢复默认参数` uses the pristine baked tuning captured before localStorage is merged. A differing saved level now reloads into the baked default level instead of leaving gameplay on the cached level.
- Targeted tuning/editor tests pass, source and exported tuning are identical, and browser QA confirms the expected defaults with no error-level console logs.

## Completed On 2026-09-02 - Validated Unity level import controls

- Added `导入关卡` and `打开关卡文件夹` actions directly under the editor level selector. Accepted `level<number>.asset` sources are stored under `artifacts/unity-level-sources/`, merged into the generated development catalog, selected, and loaded after refresh.
- Added validation for Unity text YAML identity, supported vehicles/containers, unique ids, transforms, queue continuity, per-color passenger/seat totals, depth references, file size, and currently unsupported mechanism sections. Failed validation and failed catalog regeneration leave existing source/catalog files unchanged.
- Focused importer tests pass 8/8, existing `level17.asset` and renamed `level18.asset` pass validation, invalid HTTP imports return 400 without creating a file, the production build passes with the existing chunk-size warning, and browser QA confirms the controls render without overlap.

## Completed On 2026-09-02 - Spatial exit Y position control

- Added a spatial-only `出口 Y 位置` control beside the existing exit X/Z controls. It offsets only the independent exit artwork and participates in the spatial visual rebuild cache without moving the track or gameplay anchors. The editor-authored exit defaults are now X `-0.15`, Y `0.15`, and Z `0.65`.
- Focused spatial tests pass 20/20, the production build passes with the existing chunk-size warning, and production output still excludes the development-only point editor.

## Completed On 2026-09-02 - Spatial point editor navigation and boarding anchors

- Added a dedicated editor camera profile with a 40-degree field of view, fixed 0.01-100000 clipping range, broad zoom limits, cursor-centered zoom, right-drag rotation, middle-drag panning, selection focus, and reset-view actions. The gameplay camera and background are restored when the point editor closes, and draft rebuilds no longer reset the temporary editor view.
- Made the top point toolbar draggable with viewport clamping, added visible entrance/exit markers, and added an undoable passenger entrance percent control plus a set-from-active-point action.
- Point insertion, prepend/append, and deletion now reproject entrance and exit percentages so their physical curve anchors remain stable when Catmull-Rom parameterization changes.
- Clarified spatial gameplay anchors in the point editor: passenger track entry and same-color vehicle boarding detection are separate undoable controls, while exit artwork now keeps an independent position/orientation anchor and no longer follows point-level track transforms.
- Focused spatial editor/import tests pass 20/20, browser QA confirms entrance edit/undo/close with zero error logs, production build passes, and production output contains no point-editor or Orbit/TransformControls markers.

## Completed On 2026-09-02 - On-demand spatial conveyor point editor v1

- Added a spatial-only `编辑轨道点位` entry that opens a full overlay and temporarily removes the ordinary tuning sidebar without taking permanent editor space. Gameplay, vehicle picking, and long-press updates pause while it is open.
- Added click/Ctrl/Shift/box selection, move/rotate/XYZ-scale TransformControls, world/local axes, selection-center/active-point pivots, numeric point coordinates, cross-section rotation, point width, prepend/curve-sampled insert/append/delete, and 100-step undo/redo with live track preview.
- Spatial JSON saves are now explicit, validated, atomic, protected by external-change revisions, and backed up outside the scanned package folder. Save-as creates a separately selectable spatial package; unsaved edits can be discarded without touching hand-tuned spatial display/game parameters.
- Spatial road generation now interpolates imported point normals and sizes, and the imported pivot remains stable after edge-point edits without shifting the original track. Focused spatial tests pass 16/16, production build passes, production output contains no point-editor code/style markers, and browser QA confirms open/edit/undo/close behavior with zero error logs.

## Completed On 2026-08-28 - Google Android shape package batch

- Converted the 16 AppLovin packages whose filenames contain both `Android` and `shape` into Google Ads ZIP deliveries across Duck, Fish, Heart, and Rainbow base, JP, summer, and winter variants.
- Published the validated outputs under `D:/Project/Convert-playable/google/Android` using the `*_google_Android_*_shape*` naming scheme and replaced the stale Duck summer output.
- Tightened the Google pipeline after external static validation: every ZIP now has root-level `index.html`, `index.js`, and `style.css`; exact `ad.orientation=portrait` and `ad.size=width=320,height=480`; and an `ExitApi.exit()` CTA that no longer depends on `window.mraid.open` availability.
- Reconverted and overwrote all 16 Android shape outputs. Independent ZIP inspection passed `16/16`; sizes range from 1,701,642 to 2,078,215 bytes under the strict 5,000,000-byte limit. Google, Unity, and integrated conversion regressions pass; official Google Ads upload/preview remains external validation.

## Completed On 2026-08-27 - Spatial guide restoration

- Restored the optimized spatial delivery guide configuration from the complete pre-optimization backup instead of reusing the Heart values across every level family.
- Final family mapping is Duck `level12 / vehicle 1`, Fish `level13 / vehicle 130`, Heart `level15 / vehicle 157`, and Rainbow normal guide `level7 / vehicle 39`; only Rainbow enables the 3-second first-click guide on `level7 / vehicle 89`.
- Regenerated and hardened all 32 Unity spatial variants, then replaced the 32 AppLovin and 32 Unity shape files under `D:/文件/可玩-立体轨道`. The overwritten optimized batch is recoverable from `D:/Project/Convert-playable/backups/可玩-立体轨道-optimized-pre-guide-fix-20260827`.
- All 64 target files are byte-identical to validated outputs and retain the spatial optimization markers. Unity branding/MRAID lifecycle and fail-closed conversion tests pass.
- Mobile 390x844 QA confirms Rainbow's first-click mask/hand remains visible after loading for about 2.5-2.6 seconds in AppLovin and Unity, matching the backup; Duck and Fish normal guide hands are visibly restored with zero error-level logs.

## Completed On 2026-08-27 - Spatial optimization delivery batch

- Rebuilt the Duck/Level12, Fish/Level13, Heart/Level15, and Rainbow/Level7 spatial bases from the current optimized runtime, then regenerated all Android/IOS base, JP, summer, and winter AppLovin variants.
- Converted and hardened the matching Unity deliveries, preserving platform Icons, backgrounds, branding runtime, CTA behavior, and the Unity MRAID ready/viewable lifecycle.
- Replaced 64 same-name HTML files under `D:/文件/可玩-立体轨道`: 32 AppLovin plus 32 Unity. A complete pre-replacement backup is stored at `D:/Project/Convert-playable/backups/可玩-立体轨道-pre-optimization-20260827.zip`.
- All target hashes match the validated outputs. Maximum sizes are 4,473,968 bytes for AppLovin and 4,421,630 bytes for Unity; all packages retain the spatial payload and optimization markers with zero remote asset tags.
- Full Unity branding/lifecycle and fail-closed conversion regressions pass. Mobile 390x844 browser QA on representative AppLovin and Unity Android Heart packages shows a populated animated spatial track with zero error-level logs; official platform upload validation remains external.

## Completed On 2026-08-27 - Spatial-only mobile runtime optimization controls

- Added a spatial-only “立体轨道性能优化” editor group with a master switch and independent rollback switches for passenger/shadow instancing, curve lookup, live render state, unused queue allocation, static vehicle/blocker caches, boarding pooling, chunk culling, disabled preview skipping, duplicate boarding updates, and high-performance GPU preference.
- Spatial passengers and fake shadows now render through color-and-path-chunk THREE.InstancedMesh batches while preserving the existing VAT mesh, animation texture, per-row phase offset, passenger materials, capacity, spacing, speed, and road geometry. Instance wrappers share the original vertex buffers instead of duplicating the passenger model for every batch.
- Spatial-only CPU work now uses a 4096-sample position/tangent lookup, a reusable live render state, lazy ordinary queue/passenger pools, cached parked transforms and blocker results, pooled boarding visuals, and one boarding update per frame. Ordinary conveyors keep the previous snapshot and per-object rendering paths.
- Focused spatial tests pass 11/11, the main tuning persistence check passes, syntax checks pass, and the production Vite build passes for the current level15 + ConveyorBeltShape selection. Desktop/mobile browser QA shows the populated spatial track with continuing animation and zero error-level logs after the shader compatibility correction.
- Existing AppLovin/Unity delivery HTML files were not rebuilt or batch-upgraded in this step. The optimized runtime is currently available in the editor and future builds only.

## Completed On 2026-08-27 - Spatial shape Unity package batch

- Converted the 32 new AppLovin packages whose suffixes contain `shape`: 16 IOS and 16 Android variants across Duck, Fish, Heart, and Rainbow with base, JP, summer, and winter backgrounds.
- Published them under the matching `unity/IOS` and `unity/Android` naming scheme without replacing unrelated packages. The final Unity inventory is 50 IOS plus 50 Android packages.
- All 100 Unity packages pass the branding-preservation and MRAID lifecycle regression suites. The 32 shape packages preserve their spatial payload, platform branding assets/configuration, and embedded font data; they have zero remote asset tags and a maximum size of 4,404,751 bytes. Official Unity upload/preview remains external validation.

## Completed On 2026-08-27 - Corrected Android/iOS Icon filenames

- Updated the branding asset mapping after the platform Icon files were renamed: Android now uses `icon-android.jpg`, and iOS uses `icon-ios.png`; Android remains the baked default.
- Updated source/export tuning, editor options, package validation, and focused asset regressions. Syntax checks, focused tests 2/2, `npx vite build`, and all 21 AppLovin checks pass.
- Rebuilt `artifacts/applovin/index.html` at 4,086,902 bytes; SHA-256 is `53142E2EF700D003132EF4E186F8A53DAE85D18A6279BC5CAC7EB1D3EDFD1532`. The selected spatial conveyor package remains inlined.

## Completed On 2026-08-27 - Spatial scale, road width, and saved defaults

- Added spatial-only `X 轴缩放` and `Z 轴缩放` directly below `Y 轴垂直缩放`, both defaulting to `1.0` with the same `0.25-3.0` range.
- Independent axis scaling is applied around the imported track center before mirroring and user rotation. Prefab points and ordinary conveyor rendering remain unchanged.
- Added spatial-only `路面宽度`, defaulting to `1.0`. It scales the generated road laterally without moving the centerline or passenger path, and the exit overlay width follows it.
- Saved the latest full spatial group as source/export defaults: capacity 128, initial fill on, normal/long-press speed `2.3 / 5.4`, position `0 / 0.42 / -2.4`, uniform/Y/X/Z/road-width scales `1.45 / 1.3 / 1.178 / 1.05 / 1.1`, exit offset `-0.15 / 0.6`, rotation `15 / 180 / 0`, and Z mirroring on.
- Spatial tests pass 8/8, syntax checks and the production build pass, browser QA confirms the road-width control updates and restores correctly with no errors, and all 21 AppLovin checks pass.
- Rebuilt `artifacts/applovin/index.html` at 4,055,116 bytes. SHA-256: `9AA1B9FD957D71C57FBF74ABF024D777DC2503DF9EE5C1A143C579469177A093`.

## Completed On 2026-08-27 - Spatial normal and long-press speed controls

- Added spatial-only `常规队列速度` between `初始满人` and `长按加速倍率`. It defaults to the ordinary gameplay multiplier `1.0` and supports `0.1-5.0` tuning.
- Changed the spatial long-press default from `5.2` to the ordinary level-authored value `3.0`. Ordinary conveyors continue using `LEVEL_1.longPressMultiplier` unchanged.
- Spatial startup, level changes, reset, tuning changes, and pointer release now restore the configured normal speed. Sub-1.0 values slow both gameplay queue/conveyor updates and matching passenger entry visuals.
- Added a narrow saved-tuning migration that fills a missing normal speed with `1.0` and changes only the previous `5.2` default to `3.0`; other user-authored long-press values are preserved.
- Spatial tests pass 8/8, the focused main-thread test passes, browser QA confirms the field order and `1.0 / 3.0` values after reload, and all 21 AppLovin checks pass.
- Rebuilt `artifacts/applovin/index.html` at 4,055,653 bytes. SHA-256: `095726F33BDAEA1302BC2C2FDA7289583F7219F771D7D56FA9D125A02878E34B`.

## Completed On 2026-08-26 - Compressed spatial textures and install threshold 20

- Replaced the editor-owned spatial loop and exit PNGs with dimension-identical compressed files: `Loop_initial` is now 299 bytes at 4x162, and `Loop_exit` is 4,581 bytes at 214x89.
- Regenerated `ConveyorBeltShape.json`, reducing it from 888,038 bytes to 50,542 bytes, and rebuilt the production spatial payload.
- Changed `installGate.successfulOperationThreshold` from 10 to 20 in source and exported tuning. The final package contains threshold 20 and no threshold 10 value for that setting.
- Spatial tests pass 8/8, the focused install-threshold test passes, all 21 AppLovin checks pass, and final-package browser QA shows the compressed textures without visual breaks or error logs.
- Rebuilt `artifacts/applovin/index.html` at 4,055,378 bytes. SHA-256: `EB876CAB6A1B1AFCA4F024EE9DE809FEEEEE8BFFBEE8B2CE6741A8DA0EFB36E1`.

## Completed On 2026-08-26 - Spatial conveyor production packaging

- Fixed the production-only ordinary-conveyor fallback. The editor catalog remains development-served, while `prebuild` now reads the baked `spatial:*` selection and generates one active spatial package module from `artifacts/spatial-conveyors/<id>.json`.
- Production registers that generated package before `SceneView` is created. A selected package that is missing or has a mismatched id now fails the build instead of silently rendering an ordinary conveyor.
- AppLovin validation now requires the selected spatial id plus its embedded loop and exit textures. Focused spatial tests pass 8/8, the production browser render shows `ConveyorBeltShape`, and all 21 AppLovin checks pass.
- Rebuilt `artifacts/applovin/index.html` at 4,892,876 bytes. SHA-256: `0C169624357FD9DD2DF7DC762DFA67DB061EFE1AB8A60B1BE6C75AC700161C5D`.

## Completed On 2026-08-26 - Spatial conveyor X/Z rotation controls

- Added spatial-only `X 轴旋转` and `Z 轴旋转` controls beside the existing Y-axis rotation under `立体轨道位置与缩放`. Both default to zero and persist through source/exported scene tuning.
- The runtime keeps the fixed Unity coordinate correction, then applies user X, Y, and Z rotations around the spatial track center. Exit geometry follows the rebuilt curve, and ordinary conveyors remain unchanged.
- Verification: spatial tests pass 7/7 with explicit 90-degree X/Z center-rotation assertions, and `npm run build` passes with the existing large-chunk warning. Browser interaction was blocked by the local URL security policy before any tuning value was changed.

## Completed On 2026-08-26 - Spatial road texture and saved defaults

- Replaced the editor-owned spatial road segment with the supplied Unity `Loop_initial.png` (4x162) and regenerated `ConveyorBeltShape.json` so the current package and all future imports use the same embedded texture.
- Saved only the current `spatialConveyor` editor values into both source and exported tuning defaults: capacity 140, initial fill off, long press 5.2, position `0 / 0.65 / -2.25`, scale `1.5`, Y scale `1.35`, exit offset `-0.15 / 0.6`, rotation `0 / 180 / 0`, and Z mirroring on. Ordinary conveyor tuning was not changed.
- Verification: Unity source, support texture, and embedded package texture share SHA-256 `F5962D10ADD8929C5216AE8BBD278DBBAAD990C8E8D9F73BFD9B3CD8C2C1CF32`; spatial tests pass 7/7, production build passes, and browser QA confirms the new road renders with the saved spatial values and no console errors.

## Completed On 2026-08-26 - Spatial queue startup and editor folder access

- Added `打开存储文件夹` to `立体轨道编辑`. The development-only endpoint creates and opens the fixed `artifacts/spatial-conveyors` directory without accepting arbitrary paths.
- Added spatial-only `初始满人` and `长按加速倍率` controls under `立体轨道队列`. Initial fill can place passengers directly into belt slots in the same color order as the entrance flow; disabling it restores the original upload process.
- Spatial long press is independently adjustable from `1.0` to `10.0`; ordinary conveyors continue using the level-authored multiplier.
- Verification: spatial tests pass 7/7, production build passes with the existing large-chunk warning, and browser QA confirms both defaults plus successful folder opening with no console errors. The full game-model suite currently passes 30/39; its nine failures are unrelated current-worktree assertion mismatches in queue color, camera/preview, and vehicle collision/path tuning.

## Completed On 2026-08-26 - Spatial conveyor capacity control

- Added the spatial-only `立体轨道队列` editor group directly below `立体轨道位置与缩放`, with an editable `立体轨道容量` value.
- Spatial runtime capacity now uses the editor value, capped by the current level's authored passenger-group count. Reducing the value increases spacing between conveyor rows without changing the imported track shape.
- Capacity changes reset the current game and rebuild conveyor slots so the gameplay model and rendered passenger spacing remain synchronized.
- Verification: spatial tests pass 6/6, related conveyor/main-thread tests pass 9/9, browser visibility/input restoration passes with no console errors, and `npm run build` passes with the existing large-chunk warning.

## Completed On 2026-08-26 - Spatial exit 270-degree rotation and depth layering

- Rotated the spatial exit overlay by 270 degrees around its own center and the local conveyor surface normal. Exit size, X/Z offsets, and track geometry remain unchanged.
- Restored depth testing on the exit overlay while retaining its surface lift, polygon offset, and higher road-level render order. The exit renders above the conveyor road but remains behind opaque passenger models.
- Verification: spatial tests pass 6/6 and `npm run build` passes with the existing large-chunk warning.

## Completed On 2026-08-26 - Spatial exit visibility and manual position

- Corrected the exit overlay placement so it is lifted above the conveyor surface and rendered without being hidden by the base track depth.
- Added spatial-only `出口 X 位置` and `出口 Z 位置` controls under `立体轨道位置与缩放`. Both default to zero, persist with scene tuning, and rebuild only the spatial visual when changed.
- Verification: spatial tests pass 6/6, related conveyor tests pass 8/8, and `npm run build` passes with the existing large-chunk warning.

## Completed On 2026-08-26 - Spatial exit overlay parity and editor placement

- Replaced the exit-segment material substitution with a separate exit overlay anchored to the imported exit percentage and sized from the Unity `Loop_exit` SpriteRenderer. This established the correct layered structure, but its first placement remained below the track surface and required the visibility follow-up above.
- Moved `立体轨道编辑`, `传送带选择`, and the spatial-only `立体轨道位置与缩放` block directly below `Passenger Material` and immediately above the ordinary per-conveyor tuning groups.
- Regenerated `ConveyorBeltShape.json` with explicit exit sprite size metadata. Spatial tests pass 6/6, related conveyor tests pass 8/8, and `npm run build` passes with the existing large-chunk warning.

## Completed On 2026-08-26 - Spatial conveyor vertical scale and editor ordering

- Added an independent spatial-track Y-axis scale, centered on the imported track bounds and applied after uniform scale, so height can be adjusted without changing the X/Z footprint or rewriting imported points.
- Reordered the editor controls to `立体轨道编辑`, `传送带选择`, then `立体轨道位置与缩放`; the position/scale section remains visible only for `spatial:*` selections.
- Verification: spatial importer/runtime tests pass 6/6, related conveyor tests pass 8/8, and `npm run build` passes with the existing large-chunk warning. In-app visual QA was blocked by the browser URL security policy.

## Completed On 2026-08-26 - Standalone spatial conveyor Prefab importer

- Added the `立体轨道编辑` editor submenu with `.prefab` file selection, import status, and catalog refresh. Imported tracks are discovered from `artifacts/spatial-conveyors/*.json`; deleting one package and refreshing removes its dropdown entry.
- Added a standalone importer and bundled `bus-loop-spatial-v1` support package containing the required template, Dreamteck path prefab, and loop/exit textures, so future imports do not read the external BusLoop Unity project.
- Verified `ConveyorBeltShape.prefab` imports as `ConveyorBeltShape.json` with 56 effective 3D points, SplineMesh count 225, capacity 300, one direct start entrance, and exit range `0.85-0.865`.
- Added selectable `spatial:*` runtime support: imported Unity transforms generate the Three.js path, Dreamteck channel data builds the repeated textured mesh, the ordinary 2D plane is hidden, and authored level queues merge into one direct start source. Point and entrance editing remain pending.
- Recalibrated the spatial-only display mapping without changing the imported 56-point topology: points are uniformly scaled around their transformed bounding-box center, rotated 180 degrees around world Y to correct the authored front/back direction, and the repeated mesh width is matched to the four-person row. Spatial tracks now use the unchanged shared scene camera.
- Added spatial-only editor controls for X/Y/Z position, uniform scale, Y-axis model rotation, and Unity Z-axis handedness correction. The default scale is reduced from `1.85` to `1.45`, and the model receives an additional 180-degree Y rotation; changes rebuild the curve and repeated mesh immediately and persist with the normal scene tuning.
- Corrected the exit material mapping so the complete `Loop_exit` texture spans the imported exit percent range once instead of repeating on every SplineMesh segment.
- Verification: spatial importer/runtime tests pass 6/6, related existing conveyor tests pass 8/8, real HTTP import succeeds, browser selection persists after reload, the populated narrow-screen composition matches the supplied layered-loop direction, and `npm run build` passes with only the existing large-chunk warning.

## Completed On 2026-08-26 - Selectable platform Icon and small Logo

- Replaced the branding and result-overlay Logo with `main-loading-icon-small.png` and added an Android/iOS Icon selector under `Icon/Logo调整`, defaulting to Android.
- The selected Icon asset path is saved in scene tuning and applied immediately in the editor. Production tree-shaking plus package checks ensure only the selected Icon is inlined; the unselected Icon and legacy large Logo are omitted.
- Focused branding/config tests pass 2/2; the separate pre-existing preview-enabled fixed-value assertion remains stale. Syntax checks, `npx vite build`, and all 20 AppLovin checks pass. Browser QA confirms both 512x512 Icon variants switch successfully and the final Android package loads the 518x312 small Logo with no error logs.
- Rebuilt `artifacts/applovin/index.html` at 4,387,236 bytes; SHA-256 is `F1FE2FE5B578342B42120DA76DBA340F9FA1A4FDC99E248CBBDA9BC0F545A09E`. Official platform preview/upload remains manual QA.

## Completed On 2026-08-24 - Unity branding-preserving full repackage

- Fixed the AppLovin-to-Unity hardening step so non-payload body scripts, including the standalone responsive Icon/Logo/text runtime, remain in the converted HTML instead of being discarded.
- Reconverted and replaced all 34 IOS plus 34 Android Unity deliveries from their current AppLovin sources. Source-to-output checks preserve branding DOM, images, Poppins font data, and standalone/integrated layout configuration across both package structures.
- All 68 final packages pass the integrated conversion and MRAID lifecycle suites, contain zero remote asset tags, and remain below 5,000,000 bytes; the maximum is 4,553,529 bytes. Local browser visual automation was unavailable because localhost access was denied, so official Unity preview/upload remains the final visual acceptance step.

## Completed On 2026-08-24 - IOS and Android playable package split

- Renamed the 34 existing AppLovin and Unity deliveries with explicit `_IOS` platform markers, generated 34 matching `_Android` AppLovin packages, and converted all Android variants to hardened Unity single-HTML packages.
- Replaced only the Android branding Icon with `C:/Users/hi/Downloads/侧面.jpg` and set the effective `branding.icon.y` value to `2026`; canonical IOS/Android comparisons confirm no other playable content changed.
- Both Unity platform directories pass the integrated lifecycle/hardening check at 34/34. All Android packages have zero remote asset tags and remain below 5,000,000 bytes; real AppLovin/Unity upload validation remains external.

## Completed On 2026-08-24 - AppLovin background variants for DoubleColor, Square, and Massive

- Completed the four-background naming set for DoubleColor, Square, and Massive: winter01 uses no suffix, Sakura uses `_JP`, winter02 uses `_winter`, and summer01 uses `_summer`.
- Added eight missing packages. Preserved the prior Massive summer package byte-for-byte as `Massive_summer.html`, then corrected the no-suffix `Massive.html` to winter01.
- Verified all 12 family packages embed the expected optimized background twice, retain the small branding logo, preserve non-background package content within each generated family, and remain below AppLovin's 5,000,000-byte limit.

## Completed On 2026-08-24 - Branding background-width constraint

- Preserved responsive outward X movement while clamping only the rendered Icon and Logo rectangles to the Three.js background plane's visible canvas width. Saved editor coordinates remain unchanged, and text keeps its existing independent responsive position.
- Added focused layout coverage for left/right overflow and oversized items. Touched syntax checks, 15 focused tests, `npx vite build`, and all 18 AppLovin static checks pass.
- Final-package browser QA passes at 1280x720 and 390x844 with no error-level logs. Rebuilt `artifacts/applovin/index.html` at 4,730,441 bytes; SHA-256 is `5682F0F89E3EDD468496EAB43424372E64ACCBDDB7BFEC93E1988B3FD4BEB888`. Official AppLovin preview/upload remains manual QA.

## Completed On 2026-08-24 - AppLovin branding overlay production fix

- Fixed production-only Icon/Logo/text disappearance on short or landscape screens. The final package already contained the DOM, configuration, images, and Poppins font; the defect was the width-only position scale placing bottom-authored items below the real stage.
- Branding positions now map X and Y independently from the 1080x2160 design space to the actual stage, while width/height use a uniform contain scale. Browser validation of the final single HTML confirms all three items render in both 1280x720 and 390x844 viewports with no error-level logs.
- Rebuilt `artifacts/applovin/index.html` at 4,729,259 bytes with normalized LF output. All 18 AppLovin static checks pass, including new branding markup/image/font checks; SHA-256 is `019ED123D6D015FCA2B618D2CFFE7A9CC0B7357F9F45229A0614C54DDEA29AFA`. Focused tests pass 2/2; the broad game-model file remains 30/39 because of nine pre-existing level/tuning fixed-value failures. Official AppLovin preview/upload remains manual QA.

## Completed On 2026-08-24 - Icon/Logo and text editor controls

- Added an `Icon/Logo调整` editor section for `public/assets/icon.png`, `public/assets/main-loading-icon.png`, and an editable text overlay, with independent display, lock, X/Y position, width, and height controls plus direct stage dragging.
- The text defaults to `Bus Fever-Car Jam Escape`, loads `public/assets/unity/fonts/Poppins-Bold.ttf`, and automatically fits changed content inside its configured box. All branding positions use the configurable preview width/height as responsive design coordinates.
- Browser QA verified text editing, dragging, lock behavior, independent visibility/size changes, long-text fitting, desktop/mobile layouts, and the Poppins font load. Focused tests pass 2/2, touched JavaScript syntax checks pass, and `npx vite build` succeeds with only the existing chunk-size warning.

## Completed On 2026-08-24 - Editor level selection persistence fix

- Fixed current `v3` editor tuning loads so historical Level15 -> Level16 -> Level10 -> Level12 package migrations no longer rewrite an explicitly selected development level after reload; those package migrations now run only for legacy `v2` tuning.
- Browser regression confirmed Level10, Level15, and Level16 each remain selected after the editor's persist-and-reload flow. The focused localStorage test and touched-file syntax checks pass; no production build or platform package was run.

## Completed On 2026-08-21 - Removed editor Levels19-20

- Removed editor catalog entries Level19 and Level20, their Vite selection ids, regression expectations, default extraction inputs, and project-local renamed Unity snapshots.
- Retained Level17 and Level18. Because the current durable editor selection was Level19, it now falls back to Level18; saved browser tuning selecting removed Level19/20 also migrates narrowly to Level18.
- Incremental structured removal preserved the existing Level12 production active module byte-for-byte. Focused verification is recorded below.

## Completed On 2026-08-21 - Sequential Level18-20 editor imports

- Imported the three supplied Unity files in user-specified order, ignoring their original filenames: source Level16 -> editor Level18, source Level18 -> editor Level19, and source Level19 -> editor Level20.
- The resulting layouts contain 68 / 61 / 64 unique vehicles with queues 200+228 / 184+184 / 218+218. Every level has exact seat/passenger color parity, valid depth references, and zero initial vehicle collision-box overlaps.
- Added byte-identical project-local source snapshots, default extractor inputs, Vite selection support, and focused sequential-alias regression coverage.
- Four focused catalog/editor tests and touched syntax checks pass. Current Level17 editor selection and the existing Level12 production module remain unchanged; no build/package was run.

## Completed On 2026-08-21 - Level17 editor import restored

- Restored the supplied `level17.asset` as an editor-selectable development level after the earlier import was overwritten by a remote pull.
- Level17 contains 107 unique vehicles and queues of 300 + 258 passengers; color totals match all 558 seats, all depth references are valid, and there are no initial vehicle collision-box overlaps.
- Added a project-local Unity source snapshot, Vite selection support, focused regression coverage, and merge-mode protection that leaves the production active module unchanged.
- Syntax checks and three focused catalog/editor tests pass. Current `level8` selection and the existing Level12 production module were preserved; no build/package was run.

## Completed On 2026-08-21 - BG02 winter background option

- Generated the 2100x3382 `BG02_split01_winter_q60.jpg` JPEG quality-60 derivative at 140,721 bytes while preserving the supplied PNG source.
- Added it to the scene editor background selector as `BG02 \u51ac\u5b63` and recorded the source/delivery asset status.
- Scene-editor/test syntax and the focused background-selection regression pass; visual inspection of the compressed image is clean. Default background and platform packages were not changed.

## Completed On 2026-08-20 - Production handoff guide

- Added `docs/project/playable-handoff-guide.md` covering local editor startup, browser-local tuning persistence, AI-assisted tuning export/application, AppLovin packaging, and manual validation.
- Confirmed the production parameter boundary: editor changes live in `localStorage` until `window.__busLoop.exportTuning()` is written to `artifacts/scene-tuning.json` and applied with `npm run apply:tuning`.
- Clarified that local browsers are expected not to open the store because the current runtime only calls AppLovin `mraid.open()`; final CTA behavior still requires real user clicks in official preview/backend testing.
- Documentation-only change. No runtime code, build output, or existing AppLovin artifact was modified.

## Completed On 2026-08-12 - Level12 Sakura AppLovin package

- Switched the production selection and exported tuning to Level12, scoped both guide configurations to vehicle 34 while retaining the disabled first-click mask, selected the optimized Sakura background, and kept the successful-operation store redirect threshold at 10.
- Regenerated the narrow Level12 payload, passed catalog 10/10, guide 1/1, targeted background/cache/install checks 3/3, and the production build with only the existing Vite chunk-size warning.
- `artifacts/applovin/index.html` and the preserved `artifacts/applovin/level12-sakura.html` are identical at 4,197,570 bytes; all 15 AppLovin static checks pass. SHA-256: `2ED3ACA5C9233FF73B34D9A898BE2463207A478B7C226FF0F582CD48315B9D81`.
- Package fingerprints confirm Level12 only, guide vehicle 34, redirect threshold 10, Sakura bytes present, and winter/summer background bytes absent. Official AppLovin preview/upload play remains external manual QA.

## Completed On 2026-08-11 - Level12 AppLovin queue replacement

- Replaced Level12's prior Excel 173+265 split with the exact two queues embedded in `Bus Fever - Car Jam Escape Playable_applovin.html`: 219+219 passengers.
- Updated both `D:/备份/busloop素材关卡/level12.asset` fixed passenger sequence and the reproducible extractor/catalog source; the original asset is preserved as `level12.asset.before-applovin-queue-20260811.bak`.
- The playable, edited asset, generated JSON artifact, and JavaScript catalog now contain identical queue arrays. Combined colors still match all 438 vehicle seats, focused tests pass 10/10, and syntax checks pass.
- Level10 remains the selected/active production level. No production build or AppLovin package was run because only the development Level12 queue order changed.

## Completed On 2026-08-11 - Level12 layout and Excel queue import

- Imported the supplied 94-vehicle `level12.asset` into the editor/development catalog and sourced its exact passenger order from `FixQueueConfigB.xlsx` Sheet1 LevelId 12: 173 left + 265 right.
- All 438 passenger colors match the vehicle-seat totals exactly; vehicle ids and depth references are valid and the layout has zero initial collision-box overlaps.
- Added an explicit incremental extractor mode because the historical full-regeneration Level7 source is no longer available; existing verified catalog levels are preserved instead of being replaced by a different same-named asset.
- Catalog tests pass 10/10, touched/generated syntax checks pass, and browser QA rendered Level12 with zero error-level logs before restoring Level10. The production module and existing AppLovin packages remain Level10 and were not rebuilt.

## Completed On 2026-08-11 - Separate Level10 winter AppLovin package

- Preserved the existing Sakura build as `artifacts/applovin/level10-sakura.html`, then switched the baked background to winter and generated `artifacts/applovin/level10-winter.html` without overwriting it.
- Both packages retain Level10, guide vehicle 39, CTA enabled, successful-operation threshold 10, disabled first-click mask, and the existing DualQueue3 layout.
- All 15 AppLovin static checks pass independently for both named artifacts. Base64 fingerprints confirm the winter package embeds only winter q60 and the Sakura package embeds only Sakura q60; summer and the source Sakura PNG are absent.
- Winter: 3,822,146 bytes, SHA-256 `30BA4A16F886428507E5C7392E7858CAA9EB2F511DC2EC0A441CE0AE8D420E7E`. Sakura: 4,196,123 bytes, SHA-256 `81A42A23ABADC5A320203BDE099F829D5CCE9286EF7C669834C041371A94D344`.
- `artifacts/applovin/index.html` remains the latest winter output and is byte-identical to `level10-winter.html`. Official preview/upload/device play remains external manual acceptance.

## Completed On 2026-08-11 - Level10 Sakura AppLovin repackage

- Switched the completed Level10/guide-39/CTA-enabled/threshold-10 package from summer to the optimized 278,157-byte Sakura background without changing other tuning.
- Added an exact saved-editor default migration from summer q60 to Sakura q60 and corrected focused background verification to use the immutable generated manifest plus format-aware PNG/JPEG dimension parsing.
- Focused background/cache/catalog/guide checks pass 5/5. The generated session remains Level10 only with 64 vehicles, queues 218+218, and vehicle 39 present.
- Generated `artifacts/applovin/index.html` at 4,192,202 bytes; all 15 AppLovin static checks pass. Base64 fingerprints confirm only Sakura q60 is embedded; summer, winter, and the source Sakura PNG are absent.
- SHA-256: `CA7BAF4EC5645B14CEB7F95058D051EEC87653DF1F38BC2630CC499AB2BC2A63`. Official preview/upload/device play remains external manual acceptance.

## Completed On 2026-08-11 - Level10 guide-39 CTA AppLovin package

- Baked Level10 as the single production level with 64 vehicles and authored queues 218+218; vehicle 39 is a visible 6-seat guide target.
- Synchronized both guide scopes to `level10 / vehicle 39`, kept the normal guide enabled and first-click mask disabled, kept CTA enabled, and changed the successful-operation redirect threshold from 30 to 10.
- Added a saved-editor migration from the prior Level16/45/30 package defaults to Level10/39/10 without changing unrelated camera, path, background, layout, scale, or guide-motion values.
- Source/export/selection parity, touched syntax, and five focused guide/catalog/config checks pass. Production marker scans confirm only Level10 is present and Level16/Level9 payloads are absent.
- Generated `artifacts/applovin/index.html` at 3,972,962 bytes; all 15 AppLovin static checks pass. SHA-256: `BA8EC8CD23FDF2104E0314488AFC963C7A3348D4AF28AD556F75B2F33261447B`. Official preview/upload/device play remains external manual acceptance.

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

## Completed On 2026-09-03 - Luxury vehicle and passenger import

- Added Unity importer support for zero-based `colorIndex: 15` Luxury vehicles/passengers, including the original six-seat constraint and import count reporting; color index 14 remains rejected.
- Added editor-owned limousine and wealthy-passenger assets, including compressed vehicle FBX and packed 77-frame Idle/Move VAT resources.
- Runtime now loads dedicated Luxury vehicle/material/passenger paths, applies the authored passenger orientation, uses the Luxury seat-count board, and disables spatial passenger instancing for these levels.
- Focused importer/VAT/runtime contract tests and production Vite build pass. AppLovin packaging runs, but the current workspace package remains over the 5 MB platform limit because of pre-existing garage/hidden-level assets plus the new Luxury resources; platform-size optimization is still required before delivery.

## Completed On 2026-09-03 - Luxury visual correction

- Replaced the unstable luxury passenger VAT render path with the original compressed `Idle_wealthy.fbx.bin` bind-pose topology, preserving the two authored material groups (body diffuse and clothing matcap) and eliminating duplicate-vertex animation tearing. Passenger movement currently comes from the normal path translation; the unused luxury VAT resources remain available for a later exact Unity vertex-order export.
- Luxury vehicles now bind both authored matcap materials by FBX group; the previous single diffuse-map binding that produced an untextured gray model is gone.
- Verification: packed passenger FBX parses as one skinned mesh with 24 groups and two materials; focused luxury/resource tests, syntax checks, production build, and browser level29 preview pass. Temporary Unity export inputs were removed.

## Completed On 2026-09-03 - Garage mechanism import

- Added garage container validation/extraction, automatic authored-order release, exact door collision checks, single-vehicle exit state, final garage hiding, and snapshot/render state.
- Added the Unity garage model, fake shadow, textures, counter board, door animation, and `garage_out` / `garage_clear` audio events without retaining a runtime dependency on the Unity project.
- Verification passed: 23/23 focused importer/collision tests, 1/1 garage resource wiring test, touched-file syntax checks, production build, development browser sequence QA, final single-HTML rendering, and user-interaction audio decoding with zero error-level logs.
- The full workspace suite currently passes 118/140. Its 22 failures are in existing queue/tuning/background/guide/level-session/spatial/effect expectations; all garage-specific tests pass.
- AppLovin packaging includes all six garage resources. The current level29 package is `6,738,170` bytes; all static checks except the intentionally deferred 5 MB limit pass.
- No real Unity garage level was added to the catalog because the inspected garage sources do not include the authored fixed passenger sequence required by the playable. Passenger order was not synthesized.

## Completed On 2026-09-03 - Garage visual parity correction

- Confirmed the imported garage model, fake shadow, textures, and audio are byte-identical to the current Unity source resources; no legacy Garage/Truck asset was selected.
- Applied the Unity Prefab `Truck` child `Y=180°` transform to the runtime model and fake shadow.
- Corrected door animation to use the two Unity bone local-Z hinge axes with opposite signs and an approximately `144.25°` authored swing.
- Enlarged both garage visual targets and collision footprints by the requested `60%` through one shared `1.6x` factor.
- Verification: focused collision tests `10/10`, garage resource contract test `1/1`, and touched-file syntax checks pass. Production build and AppLovin packaging pass; the existing deferred single-HTML size check remains over 5 MB (`6,813,719` bytes) while compression is intentionally postponed.

## Completed On 2026-09-03 - Garage size and lighting correction

- Reduced the shared garage visual/collision enlargement from `1.6x` to `1.3x`, keeping visible bounds and blocking geometry synchronized.
- Removed the `AmbientLight` created by Three.js from the imported garage FBX before normalization; the garage no longer changes global scene brightness while visible.
- Garage model and fake-shadow transforms remain coupled under the same parent scale and shared `Y` anchor, so the shadow stays aligned after resizing.
- Moved the garage fake shadow `0.1` local units toward the runtime front (`+Z`) while preserving its ground offset and parent scale.
- Focused garage collision/resource tests and scene syntax checks pass. Production build and AppLovin packaging pass; static checks pass except the intentionally deferred 5 MB size limit (`6,814,346` bytes).

## Completed On 2026-09-04 - Garage shadow alignment

- Moved the garage fake shadow `0.1` local units toward the runtime front (`+Z`), preserving its tuned ground offset and shared parent scale.
- Garage-focused tests `5/5`, scene syntax checks, production build, AppLovin packaging, and level39 browser smoke check pass; no error-level browser logs were reported.

## Completed On 2026-09-04 - Conveyor component tuning reset

- Restored imported conveyor visuals to their component base transforms by removing the previous overall/body/width/spacing adjustments and the artificial continuous side-rail layer.
- Preserved the current base values as the fixed scene configuration, removed the temporary component adjustment submenu, and corrected conveyor arrow texture scrolling to the authored forward direction.
- Verification: touched-file syntax checks, five conveyor-focused runtime/resource tests, production build, and AppLovin packaging pass. The optional size check still reports the existing 5 MB limit (`6,976,351` bytes); compression remains deferred.

## Completed On 2026-09-04 - Conveyor collision and contact correction

- Conveyor vehicle slot indices now follow each belt's local movement axis instead of world-X ordering, preventing rotated or differently authored belts from selecting a farther vehicle as the direct blocker.
- Container/rail collision effects now use the collision graph's world-space contact position, keeping the visible `Effect_Hit` aligned with the actual blocking wall or door.
- Verification: touched-file syntax checks and focused conveyor/collision/effect tests pass; unrelated legacy expectations remain unchanged.

## Completed On 2026-09-04 - Conveyor door spacing adjustment

- Moved the left and right conveyor door visuals outward by `10%` symmetrically from their saved base positions.
- Kept the belt body, vehicle placement, side blockers, and collision graph unchanged.
- Verification: conveyor resource/visibility contract and focused conveyor tests pass; production packaging regenerated afterward.

## Completed On 2026-09-04 - Conveyor door spacing refinement

- Refined the symmetric outward door offset from `10%` to `15%` of the existing door-center offset.
- Belt body, vehicle placement, side blockers, and collision logic remain unchanged.

## Completed On 2026-09-04 - Conveyor door asymmetric spacing

- Set the left door's outward offset to `17%` and the right door's outward offset to `20%`, each relative to the existing door-center offset.
- Kept door geometry, belt visuals, vehicle placement, side blockers, and collision logic unchanged.

## Completed On 2026-09-04 - Conveyor right-edge visibility adjustment

- Moved the conveyor's right-side vehicle disappearance boundary `7%` toward the center, so vehicles leave the visible belt slightly earlier on that side.
- Left-side visibility, vehicle spacing, collision behavior, and door positioning remain unchanged.

## Archive

Full 2026-07-07 progress log was archived to:

- `docs/project/archive/playable-project-progress.full-2026-07-08.md`


## Completed On 2026-09-07 - Conveyor mechanism tuning made reset-safe

- Isolated the confirmed conveyor visual root scale (`1.375`), asymmetric door spacing (`1.17`/`1.20`), and right-edge visibility (`0.93`) in `src/conveyor-mechanism-config.js`; conveyor vehicles remain outside the visual root scale.
- Reopened a temporary editor submenu for independent XYZ position, scale, and rotation adjustments on the belt, arrow, doors, and side panels; overrides layer over the fixed mechanism base and reset cleanly.
- Added focused configuration/temporary-override regression coverage and passed syntax checks plus conveyor-focused behavior/resource checks.
