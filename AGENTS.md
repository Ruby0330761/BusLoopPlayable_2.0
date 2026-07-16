# AGENTS.md

# Playable Ads Working Rules

This project is a playable ad prototype. Optimize for a small working context: read only the documents needed for the current task, summarize tool output, and avoid broad scans unless the user asks for an audit.

## Default Context Route

For ordinary coding or debugging, read only:

1. `docs/project/playable-project-progress.md`
2. `docs/project/code-navigation.md`
3. The specific source files and paired tests named by the navigation map

Read additional documents only when the task matches the situations below.

## Code Change Navigation Rule

For any code change, bug fix, refactor, feature work, test update, or visual/runtime behavior change:

1. Read `docs/project/code-navigation.md` first.
2. Pick the closest change area from the navigation map.
3. Read only the mapped source files and paired tests.
4. Broaden with targeted `rg` only if the navigation does not cover the request or the mapped files prove insufficient.
5. If code files are added, removed, renamed, or ownership boundaries move, update `docs/project/code-navigation.md` in the same turn.

## When To Read Which Docs

- Gameplay rules, level semantics, win/fail behavior, vehicle/passenger logic:
  - `docs/project/playable-core-rules.md`
  - `findings.md`

- Asset status, missing Unity exports, texture/model/audio questions:
  - `docs/project/playable-resource-status.md`
  - Relevant files under `public/assets/`

- Current implementation status, next step, or handoff:
  - `docs/project/playable-project-progress.md`
  - `task_plan.md`
  - `progress.md`

- Platform packaging, AppLovin baseline, or cross-platform delivery:
  - `docs/project/playable-multi-platform-execution-plan.md`
  - `docs/platforms/platform-deltas.md`
  - The target platform file: `docs/platforms/*-playable-audit.md`

- Manual QA, real-device/upload validation, screenshots, or browser test evidence:
  - `docs/project/platform-manual-validation-checklist.md`
  - `docs/playable/browser-automation.md`

- SOP/process questions, document maintenance rules, or uncertain workflow order:
  - `docs/playable/playable-sop.md`
  - `docs/playable/platform-delivery.md`
  - `docs/playable/project-document-rules.md`

- Historical reasoning from the long planning logs:
  - `docs/project/archive/*.full-2026-07-07.md`
  - Read these only when current short docs are insufficient.

## Core SOP

1. Clarify gameplay rules and constraints.
2. Decouple resources and record gaps.
3. Build/editor first.
4. Build the AppLovin baseline first.
5. Expand to other platforms from the AppLovin baseline.
6. Validate manually on real platform uploads and record results.
7. Do static checks, hardening, and obfuscation last.

## Non-Negotiables

- Do not treat "runs locally" as platform-ready.
- Do not silently invent Unity assets/config values; record gaps instead.
- Do not skip real platform upload/manual play when platform delivery is in scope.
- Do not leave durable project facts only in chat; update the relevant project doc when the write policy below says to.
- Do not start heavy obfuscation before the platform path is stable.

## Editing On This Windows Workspace

Prefer `apply_patch` for manual edits. However, this Windows workspace sometimes fails with `orchestrator_helper_launch_canceled` or `ShellExecuteExW failed to launch setup helper: 1223`.

If `apply_patch` fails with that helper error:

- Do not keep retrying the same patch more than twice.
- Use targeted PowerShell editing instead, limited to the requested files.
- Prefer exact string replacement, section insertion, or controlled whole-file rewrite for small Markdown/config files.
- Before replacing long project notes, archive or copy the old content when it contains useful history.
- After PowerShell editing, immediately re-read the changed section or file size to verify the edit landed.
- Never use broad destructive commands or wildcard rewrites to work around the helper issue.

## Documentation Write Policy

Do not update project documents after every small code edit. Write docs only when the change creates durable project knowledge.

Update `docs/project/playable-project-progress.md` when:

- A user-visible feature, visual pass, platform package, or validation step is completed.
- Test/build/manual QA results materially change project status.
- A task is blocked by a fact the next session must know.

Update `findings.md` when:

- A new gameplay, Unity parity, platform, asset, or technical decision is discovered.
- A prior assumption is corrected.
- The finding affects future implementation choices.

Update `task_plan.md` when:

- The current goal, active phase, next steps, or priority order changes.
- A task is split into a new milestone or a milestone is accepted as complete.

Update `docs/project/code-navigation.md` when:

- Code files are added, removed, or renamed.
- A file's main responsibility moves to another file.
- A new major subsystem or test file is introduced.

Update `progress.md` when:

- There is a meaningful session handoff summary.
- Several related edits should be summarized together.
- The user asks for a status checkpoint.

Do not update docs for:

- Tiny refactors with no behavior change.
- Formatting-only edits.
- Intermediate failed attempts that do not affect future work.
- Test runs whose result matches the already-recorded status.

When writing docs, keep entries short: outcome, changed files or area, verification, and next action. Archive long investigations under `docs/project/archive/` instead of growing the root planning files.

## Token Discipline

- Read `docs/project/code-navigation.md` before touching code, then go directly to the mapped files.
- Prefer targeted `rg` searches over whole-repo reads.
- Exclude `node_modules`, `dist`, logs, and archive files unless directly relevant.
- Do not open every platform doc for a single-platform task.
- Keep `task_plan.md`, `findings.md`, and `progress.md` short; move old detail to `docs/project/archive/`.
## Verification Discipline

- Do not run a full build after every edit unless the user asks for it.
- For small, low-risk changes, prefer the narrowest relevant check, such as targeted tests, syntax checks, or reading the affected code path.
- Run full build verification when packaging, platform delivery, dependency/config changes, rendering pipeline changes, or broad runtime behavior changes are involved.
- If skipping build verification, say so briefly in the final response and mention the lighter check that was used.

