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

A work contains `workId`, `workName`, `workInfo`, `status`, `createdAt`, and `updatedAt`. Work status is `active`, `blocked`, `completed`, or `cancelled`; new works default to `active`.

A todo contains `taskId`, `workId`, `taskName`, `taskInfo`, `status`, optional `completionPercent`, `createdAt`, and `updatedAt`. Todo status uses the same four values; new todos default to `active`.

The public list shape assembles each work with `tasks: Todo[]`; tasks are stored separately to avoid duplicate state. Work progress is derived, not independently stored or editable.

`Blocked` includes waiting for another agent’s output, review, an external response, user input, permission, or a genuine obstacle. Mark dependent tasks blocked immediately, with the dependency and resume condition in their information field. Actual delegated execution can remain active. Keep the parent active only while some required work can proceed; otherwise mark it blocked too. Resume affected records as active when the dependency resolves and work resumes. These are agent instructions, not automatic dependency detection or a wake mechanism.

Replay normalizes legacy `planned` and `pending` statuses to `active` in both creation and update events without rewriting history. Tools accept only the four current statuses. Existing IDs, details, and progress are preserved.

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

The guidance also requires every delegated subagent, at every depth, to create or resume its own session-local Work and Todos before assigned work, maintain a real `workId` and an active `taskId`, and return its IDs with results. Parent assignment IDs are recorded as context, not used to mutate another session's records. Worker prompts must carry this requirement, including stopping delegated execution if tracking tools or IDs are unavailable. This is instruction-only, not a tool-call gate or automatic tracking repair.

The guidance is not added when the tracking tools have been removed from the active tool set. Pi Ask removes them during `/ask`. Pi BTW executes its side conversation outside the main conversation. The guidance also explicitly forbids changing works, todos, loops, or monitors during either mode.

### Shared workflow contract

The guidance directs every tracked Work, including worker-local Works, through the globally installed `implement` skill. Reuse an active skill rather than recursively invoking it. Specialized skill permissions remain authoritative; planning, research, and review do not gain implementation authority. Missing `implement`, tracking tools, valid session identity, or real IDs blocks execution. Reading instructions, obtaining identity, and establishing records are startup steps, not assigned execution. Plain conversation and side-thread exceptions remain unchanged.

The agent obtains its full session identity from `PI_SESSION_ID` in its own shell-tool command, not from a parent prompt or Herdr pane/name. Require `[A-Za-z0-9][A-Za-z0-9_-]*` and actual Work/Task IDs. Hosts without session-environment support must report the identity blocker rather than guess. Root artifacts use repository-relative `var/<sessionId>/<workId>/<taskId>/`; delegated artifacts append `<childSessionId>/<childWorkId>/<childTaskId>/` beneath the exact canonical parent task directory, recursively. Resolved destinations, including symlinks, must remain inside repository `var/`. Paths and parent IDs go in existing `taskInfo` and handoff context; each worker returns its own IDs and canonical path. Do not migrate legacy artifacts implicitly or overwrite files after branch navigation solely because numeric IDs match. `implement` owns the detailed path/ownership contract, including incompatible specialized helper handling.

Each task starts its existing `taskInfo` with `owner: self` or `owner: delegate` plus a reason, preserving that declaration in later updates. Delegation requires a bounded outcome, isolated ownership, ready inputs and verified prerequisites, useful parallelism or expertise that exceeds coordination costs, owning-skill permission, and available tracking/monitoring. Small or tightly coupled changes stay with one owner by default. Reassess on scope changes and apply the rule at every permitted delegation depth; parents retain integration and verification responsibility. Herdr retains lifecycle and monitor ownership. Worker root panes use only the parent's delegated Task ID as their name (`T34`, without brackets or descriptions), updated when a different parent Todo is assigned. This label is distinct from worker-local IDs and may repeat across parent sessions; returned resource IDs remain authoritative for lifecycle commands. No file-count, agent-count, or depth threshold is imposed.

This is model guidance only. No new schema fields, path-creation code, tool-call gate, cross-session mutation, session-ID API dependency, or automatic skill installer is added. Guidance still depends on all tracking tools being active as described above.

## Auto-continuation

Auto-continuation is optional and requires Pi 1.2.0 or newer. Configure `pi-tasks.autoContinue` in Pi's `settings.json`; the extension reads `pi.getSettings()` so trusted project settings override global settings. `enabled` defaults to `false`; `maxContinuations` is optional. Omission means no continuation limit; if supplied, it must be a positive safe integer. Explicit `null` is invalid. Invalid configuration disables the flow and reports a warning. Hosts without the new settings API keep normal task tracking with no automatic continuation.

A fresh accepted main interactive/RPC run arms a new continuation epoch. Input is provisional until the run starts, so handled/rejected prompts cannot arm it. Extension/custom starts do not arm or reset it. Steering/follow-up messages queued inside an already-running activity do not themselves reset the cap. Session start/reload, tree navigation, and shutdown disarm it until fresh user input. Explicitly aborted activity also suspends it; failed activity does not. `agent_settled.aborted` covers aborts that skip the actionable boundary. Tracking tools must be active; side conversations must not start continuation.

The synchronous `agent_before_settle` handler runs after native retries, compaction, and queued work. It accepts completed or error outcomes and requires a non-aborted signal, no pending messages in either the boundary preview or runtime queue, and no continuation already requested by an earlier handler. Pi is still busy at this actionable boundary, so it does not require `ctx.isIdle()`. Instead it appends one custom-message draft and requests one native continuation; Pi owns committing it and honoring cancellation. No detached prompt, timer, background worker, or polling loop is created.

Any work or todo on the current branch whose status is not blocked, completed, or cancelled requires continuation. This includes active records and legacy planned/pending records, which replay normalizes to active. Completed, blocked, and cancelled records are settled. A settled parent does not hide an unfinished child. The prompt includes a bounded preview of IDs, names and statuses, and directs the agent to list tools for full details. No records means no continuation. The extension never mutates statuses, verifies work independently, or treats a blocker label as proof of an actual dependency.

When `maxContinuations` is supplied, at most that many extra continuations are requested per fresh accepted main user run. The next unfinished boundary warns once and suspends continuation; a fresh user prompt resets the cap. With no limit supplied, continuation can consume tokens indefinitely while unfinished records remain, until explicitly interrupted, disabled or otherwise suspended, including during repeated provider failures. This is not a cost cap or a cap on native tool/retry requests, and another extension may independently request work. Settings changes take effect when Pi reloads effective settings, normally through `/reload`.

## Repository status and Cursor

Both terminal views share a cwd-scoped asynchronous Git status cache, separate from persisted work/todo state. The top border centers `git <branch> · S<staged> U<unstaged> ?<untracked>`; zero counts collapse to `clean`, detached HEAD uses `@<shortcommit>`, and narrow frames shorten the branch first. The border label remains when minimized. Initial loading displays `git loading…`, non-repositories have a plain border, and initial read failures display `git unavailable`; refreshes and later failures retain the prior snapshot.

The implementation is informed by [pi-powerline-footer's cache behavior](https://github.com/nicobailon/pi-powerline-footer/blob/main/git-status.ts): a one-second cache, asynchronous stale-while-refresh reads, deduplicated requests, cwd/generation guards, read-only Git environment (`GIT_OPTIONAL_LOCKS=0`), and bounded child processes. This extension reads branch and file counts together rather than running a separate branch timer. Attached views share the poller; unsubscribing the last view or shutting down releases it. File-changing `write`, `edit`, and `bash` results expire cached data sooner.

Open appears between Copy and Minimize/Maximize. It executes `cursor` with the separate argument `.` in the active session working directory, without a shell. The executable must be on PATH; errors are shown instead of silently failing. `/works-panel open` supplies a command path, and `/works` uses `o`. Open is also available outside Git repositories.

### Ownership display

`taskOwner(taskInfo)` interprets explicit line-start `owner: self` or `owner: delegate` declarations case-insensitively. A trailing sentence/reason is allowed, but incidental prose and longer enum-like tokens such as `self-managed` do not count. Missing/invalid decisions or conflicting valid declarations return `unassigned`; repeated identical declarations remain unambiguous. Compact floating/widget panel rows, dashboard rows, and todo detail headings share this interpretation and show `[taskId] [self/delegate] Task name` (or `[unassigned]`). The existing `taskInfo` is the sole source; no persistence fields, tool parameters, migrations, or task-name edits are introduced. Progress reservations, status/count logic, and full details remain unchanged.

### Delegate navigation

Agent tools are thin, bounded, shell-free Herdr CLI wrappers using actual paneId values. No separate agent handle, private registry, process/session validation, startup receipt, recovery/reconnection or acquisition framework is implemented. Panes are assumed not to be repurposed. Structured CLI errors are reported even with exit code zero, and partial creation failures report the handles already obtained without automatic retry/cleanup.

AgentCreate creates a dedicated unfocused tab, starts Pi with the supplied model flags and calls the existing MonitorCreate through ctx.executeTool with onSignal and optional onDone unchanged. It returns paneId/tabId/monitorId, assignmentSent:false and the prepared assignment. The AI must confirm MonitorList shows subscription ready before explicit AgentSend. Follow-up sends do not replace the monitor. AgentClose calls MonitorStop with the supplied monitorId, then closes the supplied pane; callers must use only resources they created. AgentList returns the CLI inventory, including unrelated agents. No subprocess runs during rendering.

AgentCreate stores herdr-pane and herdr-monitor lines in existing taskInfo; task tools persist and restore these details. TodoUpdate preserves existing link lines for delegate-to-delegate detail edits unless explicit replacement metadata is supplied, so ordinary progress/status descriptions do not silently disable navigation. Changing ownership, explicit `herdr-pane: none`, or AgentClose can unlink. delegateLink interprets an unambiguous valid pane ID for owner:delegate inside Herdr. AgentClose removes matching delegate links. No task schema change or automatic task completion is introduced. The onSignal/onDone callbacks remain entirely owned by pi-loop-monitor; onDone means its process ended, not that worker work is complete.

Delegate navigation and AgentFocus first focus the pane, then explicitly activate the tab returned by Herdr; pane-focus success alone does not guarantee that the visible client switched tabs.

Linked `[delegate]` badges and Cursor Open controls are underlined. Fullscreen mouse regions use ANSI-aware visible columns and only include complete visible badges after clipping and scrolling. Floating/widget rows, dashboard rows and todo detail headings support clicks; hidden/minimized/offscreen badges have no regions. In `/works`, `d` opens the selected task's delegate, and `/works-panel delegate T<number>` provides a command path in regular mode. Outside Herdr or without a pane link, ownership stays informational and is not underlined. Unavailable CLI, stale/closed targets and other navigation failures produce visible errors.

## Interfaces

The compact panel defaults to a non-capturing floating overlay anchored at the top-right. Its header hides the session ID and places an underlined Open session action immediately after Copy, including minimized/widget layouts. The action uses the Pi session-context identity to locate the matching direct/nested artifact directory under repository var and opens it via the existing shell-free Cursor launcher. If absent, the standard var/sessionId directory is created on activation; ambiguous matches or unsafe identity fail visibly. No lookup or process launch occurs during rendering. /works-panel open-session supplies a keyboard-command path. Existing repository Open remains separate. On narrow headers, Minimize/Maximize shorten to [-]/[+] to preserve every action and its hit region; overflow hints use remaining space. It prefixes work and todo names with bracketed IDs (`[W1] Name`, `[T1] [self] Name`), alongside status icons, completion counts, and a visible row range when content exceeds the terminal-aware viewport. It hides on terminals narrower than 90 columns or shorter than 18 rows. In fullscreen TUI mode, its title-bar Copy action exports every work and nested todo as Markdown, while Minimize collapses the panel to a restorable title bar that keeps Copy, Open, and Maximize available. `/works-panel minimize` and `/works-panel maximize` provide a keyboard-command path and preserve the collapsed state when switching between floating and widget layouts. Overflow starts at the newest rows and follows newly added tail rows until the user scrolls upward. Mouse-wheel events over the expanded floating panel scroll it directly without taking keyboard focus; regular terminal mode shows the newest rows and uses `/works` for complete browsing and copying. Because Pi treats any persistent overlay as active, the floating mode can block display-mode changes. `/works-panel widget` switches to a right-aligned widget above the editor, renders all rows, and retains the title actions, while `/works-panel off` hides it.

`/works` opens a top-centered detailed overlay. List rows and detail headings use the same bracketed ID and ownership prefixes; list metadata no longer repeats the ID after the name. The dashboard title remains unchanged. Stored names remain unchanged. Its top-right Copy action uses `c` to copy every work and nested todo to the system clipboard as Markdown. Its Open action uses `o` to open the current directory in Cursor. Its Minimize action uses `m` to collapse the overlay to a framed top bar containing live total work and todo counts, Copy, Open, and a Maximize action; activating Maximize restores the full dashboard. In fullscreen TUI mode, Copy, Open, and Minimize/Maximize also respond to left clicks. Configured selection keys choose records, configured Page Up and Page Down keys scroll long details, the configured confirmation key toggles details, and the configured cancel key closes it.
