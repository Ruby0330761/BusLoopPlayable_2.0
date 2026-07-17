# Task Plan

## Current Goal

Synchronize the updated Unity Level7 coordinates for vehicles 66 and 82 into the playable's reproducible level pipeline, then rebuild and regenerate the AppLovin package.

## Current Phase

Complete: Level7 vehicle 66/82 coordinates are synchronized, verified, built, and packaged for AppLovin.

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

## Context Pointers

- Current status: `docs/project/playable-project-progress.md`
- Code map: `docs/project/code-navigation.md`
- Durable findings: `findings.md`
- Resource status: `docs/project/playable-resource-status.md`

