# pi-tasks reference

## Ownership and persistence

`TaskState` owns work and todo state. Every mutation appends a versioned `pi-tasks-state` custom entry to the current Pi session. Custom entries do not enter model context. State restoration replays entries from `sessionManager.getBranch()`, so resume, fork, and tree navigation follow the active session branch.

A work deletion also deletes every associated todo. A todo cannot be created for a missing work. IDs are stable within a branch and use `W<number>` for works and `T<number>` for todos.

Limits:

- 100 works per session branch
- 500 todos per session branch
- 240 characters per name
- 10,000 characters per information field
- list tool text is truncated at 50KB or 2,000 lines

`WorkList` and `TodoList` accept an optional positive integer `limit`. Without it, they return all matching records (subject to the output truncation above). With it, filters are applied first, then the newest `limit` matching works or todos are returned in oldest-to-newest order within that selection. A `WorkList` limit applies to works, not their nested todos: all todos belonging to each selected work are included. Both tools report the number returned and the total number matching the filters; those counts describe records selected before any text truncation.

## Data

A work contains `workId`, `workName`, `workInfo`, `status`, `createdAt`, and `updatedAt`. Work status is `planned`, `active`, `blocked`, `completed`, or `cancelled`.

A todo contains `taskId`, `workId`, `taskName`, `taskInfo`, `status`, optional `completionPercent`, `createdAt`, and `updatedAt`. Todo status is `pending`, `active`, `blocked`, `completed`, or `cancelled`.

The public list shape assembles each work with `tasks: Todo[]`; tasks are stored separately to avoid duplicate state. Work progress is derived, not independently stored or editable.

### Completion progress

`TodoCreate` and `TodoUpdate` accept optional `completionPercent`: an integer from 0 through 100, or `null` to clear an obsolete estimate. Omission preserves an existing estimate on updates. For longer tasks, the guidance asks the AI to include interim estimates in `TodoUpdate` after roughly 5–10 meaningful working steps or a milestone, not just at completion or in status-only updates. The AI reports approximate progress based on completed effort and verification, explaining the evidence and remaining scope in `taskInfo`; status alone never implies an arbitrary partial percentage. Estimates remain optional; use `null` when unknown and do not increase a percentage without new evidence. This cadence is guidance, not a runtime timer or enforced tool-call count. No new tool or extra model call is added.

- Completed tasks normalize to 100%; explicit partial progress with completed status is rejected. Explicit 100 requires completed status. Completion remains an agent assertion after verification, not an independent extension proof.
- Moving a partial task to blocked retains its progress. Reopening a completed task without a new estimate becomes unknown rather than retaining 100%.
- A work is the equal arithmetic mean of all non-cancelled task percentages, rounded down for display. For example, 100, 40, 0, 0 yields 35%.
- Any unknown eligible task makes the work unknown (`—`); unknown is not silently 0. With no eligible tasks, work is unknown unless its own status is completed, then 100%.
- A completed parent never overrides unfinished child progress. Work progress reaches 100 only when all eligible tasks are completed. Progress never changes statuses or auto-continuation eligibility.
- Optional progress fields are additive to version-1 branch events. Legacy completed tasks show 100%; other legacy tasks remain unknown until reported. Invalid optional progress is sanitized on replay without discarding the task.
- Dashboard, compact panel, list output and copied Markdown share these calculations. The compact panel reserves a narrow right-hand percentage column with a divider; names truncate independently. `/works` retains inline `· N%` labels and unchanged navigation. Percentages do not predict remaining time; no subtasks, weights or separate navigation sidebar are added.

## Tracking behavior

When all tracking tools are active, the extension adds hidden per-turn guidance for every normal request that starts or continues work. Pi finds or creates work, synchronizes todos, marks the current todo active before the attempt, and updates statuses afterward. Tracking is not skipped merely because the request looks small.

The guidance is not added when the tracking tools have been removed from the active tool set. Pi Ask removes them during `/ask`. Pi BTW executes its side conversation outside the main conversation. The guidance also explicitly forbids changing works, todos, loops, or monitors during either mode.

## Auto-continuation

Auto-continuation is optional and requires Pi 1.2.0 or newer. Configure `pi-tasks.autoContinue` in Pi's `settings.json`; the extension reads `pi.getSettings()` so trusted project settings override global settings. `enabled` defaults to `false`; `maxContinuations` is optional. Omission means no continuation limit; if supplied, it must be a positive safe integer. Explicit `null` is invalid. Invalid configuration disables the flow and reports a warning. Hosts without the new settings API keep normal task tracking with no automatic continuation.

A fresh accepted main interactive/RPC run arms a new continuation epoch. Input is provisional until the run starts, so handled/rejected prompts cannot arm it. Extension/custom starts do not arm or reset it. Steering/follow-up messages queued inside an already-running activity do not themselves reset the cap. Session start/reload, tree navigation, and shutdown disarm it until fresh user input. Aborted or failed activity also suspends it. `agent_settled.aborted` covers aborts that skip the actionable boundary. Tracking tools must be active; side conversations must not start continuation.

The synchronous `agent_before_settle` handler runs after native retries, compaction, and queued work. It requires a completed outcome, a non-aborted signal, no pending messages in either the boundary preview or runtime queue, and no continuation already requested by an earlier handler. Pi is still busy at this actionable boundary, so it does not require `ctx.isIdle()`. Instead it appends one custom-message draft and requests one native continuation; Pi owns committing it and honoring cancellation. No detached prompt, timer, background worker, or polling loop is created.

Planned/active works and pending/active todos on the current branch are unfinished. Completed, blocked, and cancelled records are settled. A settled parent does not hide an unfinished child. The prompt includes a bounded preview of IDs, names and statuses, and directs the agent to list tools for full details. No records means no continuation. The extension never mutates statuses, verifies work independently, or treats a blocker label as proof of an actual dependency.

When `maxContinuations` is supplied, at most that many extra continuations are requested per fresh accepted main user run. The next unfinished boundary warns once and suspends continuation; a fresh user prompt resets the cap. With no limit supplied, continuation can consume tokens indefinitely while unfinished records remain, until interrupted, failed, disabled or otherwise suspended. This is not a cost cap or a cap on native tool/retry requests, and another extension may independently request work. Settings changes take effect when Pi reloads effective settings, normally through `/reload`.

## Repository status and Cursor

Both terminal views share a cwd-scoped asynchronous Git status cache, separate from persisted work/todo state. The top border centers `git <branch> · S<staged> U<unstaged> ?<untracked>`; zero counts collapse to `clean`, detached HEAD uses `@<shortcommit>`, and narrow frames shorten the branch first. The border label remains when minimized. Initial loading displays `git loading…`, non-repositories have a plain border, and initial read failures display `git unavailable`; refreshes and later failures retain the prior snapshot.

The implementation is informed by [pi-powerline-footer's cache behavior](https://github.com/nicobailon/pi-powerline-footer/blob/main/git-status.ts): a one-second cache, asynchronous stale-while-refresh reads, deduplicated requests, cwd/generation guards, read-only Git environment (`GIT_OPTIONAL_LOCKS=0`), and bounded child processes. This extension reads branch and file counts together rather than running a separate branch timer. Attached views share the poller; unsubscribing the last view or shutting down releases it. File-changing `write`, `edit`, and `bash` results expire cached data sooner.

Open appears between Copy and Minimize/Maximize. It executes `cursor` with the separate argument `.` in the active session working directory, without a shell. The executable must be on PATH; errors are shown instead of silently failing. `/works-panel open` supplies a command path, and `/works` uses `o`. Open is also available outside Git repositories.

## Interfaces

The compact panel defaults to a non-capturing floating overlay anchored at the top-right. It shows work and todo names, status icons, completion counts, and a visible row range when content exceeds the terminal-aware viewport. It hides on terminals narrower than 90 columns or shorter than 18 rows. In fullscreen TUI mode, its title-bar Copy action exports every work and nested todo as Markdown, while Minimize collapses the panel to a restorable title bar that keeps Copy, Open, and Maximize available. `/works-panel minimize` and `/works-panel maximize` provide a keyboard-command path and preserve the collapsed state when switching between floating and widget layouts. Overflow starts at the newest rows and follows newly added tail rows until the user scrolls upward. Mouse-wheel events over the expanded floating panel scroll it directly without taking keyboard focus; regular terminal mode shows the newest rows and uses `/works` for complete browsing and copying. Because Pi treats any persistent overlay as active, the floating mode can block display-mode changes. `/works-panel widget` switches to a right-aligned widget above the editor, renders all rows, and retains the title actions, while `/works-panel off` hides it.

`/works` opens a top-centered detailed overlay. Its top-right Copy action uses `c` to copy every work and nested todo to the system clipboard as Markdown. Its Open action uses `o` to open the current directory in Cursor. Its Minimize action uses `m` to collapse the overlay to a framed top bar containing live total work and todo counts, Copy, Open, and a Maximize action; activating Maximize restores the full dashboard. In fullscreen TUI mode, Copy, Open, and Minimize/Maximize also respond to left clicks. Configured selection keys choose records, configured Page Up and Page Down keys scroll long details, the configured confirmation key toggles details, and the configured cancel key closes it.
