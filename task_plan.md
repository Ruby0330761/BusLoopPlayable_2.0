# Task Plan

## Current Goal

Fix the successful-operation store redirect after real-device AppLovin testing showed that the threshold did not open the store, then rebuild and provide a new validated package.

## Current Phase

Phase 4 comparison is complete: current `index.html` matches the working backup's redirect chain, while the stale descriptive `..._Hard.html` lacks the success gate. Awaiting confirmation of the exact uploaded filename/hash before changing runtime logic.

## Implementation Phases

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

