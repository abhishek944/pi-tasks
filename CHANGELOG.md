# Changelog

## 0.13.0 - 2026-10-23

- Add `blockedReason` to TodoCreate and TodoUpdate. Require a reason when creating a blocked task or entering blocked status, preserve it during other blocked edits, and clear it when leaving blocked. Restore older tasks without a reason and include reasons in lists and copied Markdown. AgentCreate supplies its automatic waiting reason.
- Replace inline `/works` details with a dedicated full task/work detail view opened by row click or confirmation. Show `Reason: ...` prominently for blocked tasks, support scrolling, and preserve separate delegate navigation. Escape returns to the task list without losing your place; Escape again closes the dashboard.

## 0.12.1 - 2026-10-23

- Automatically mark the parent delegated task blocked after AgentCreate successfully starts the worker and registers monitoring, preserving its completion estimate and delegate links. Clarify parent and worker task status guidance.

## 0.12.0 - 2026-10-23

- Add measured active task time using `TodoUpdate working=true|false`, timestamp-based accumulated intervals, and automatic pauses for task switches, idle periods, blocking user prompts, aborts, and task lifecycle changes. Saved totals follow the session branch and restore paused without counting offline time.
- Show compact, aligned Done and Time columns in the panel and `/works`, with a running marker and shared durations in lists, details, and copied Markdown. Keep task names readable with a 48-column compact minimum and a slim eight-column Time value.
- Sum task effort for Work time, including cancelled tasks, while preserving unknown historical and parent-delegate durations. Each delegated agent measures its own local tasks; remote timing is not aggregated into parent records.

## 0.11.1 - 2026-10-22

- Show live, colored task-state counts before Copy in floating, widget, and minimized panel headers; omit zero counts and preserve narrow-width controls.

## 0.11.0 - 2026-10-22

- Remove Work lifecycle status and its tool parameters, filter, and exported WorkStatus type. Tasks alone own status; automatic continuation checks active tasks across all Works on the current branch. Existing Work statuses are ignored during replay without rewriting history.
- Remove Work status labels/icons from terminal views and Markdown; retain task counts and derived progress. Empty Works and Works with only cancelled tasks show unknown progress and do not trigger continuation.
- New status-free Work events require an updated reader; older clients that require Work status cannot restore them correctly.

## 0.10.0 - 2026-10-21

- Activate the delegate's Herdr tab explicitly after pane focus so GUI clicks switch the visible tab, not just server focus state.

- Continue unfinished work after failed runs instead of disarming; only blocked, completed, and cancelled record states are settled, with children counted independently. Preserve explicit abort, settings, queue, tracking-tool and continuation-limit guards.

- Fix delegate and panel navigation mouse gestures: claim control presses before text selection and accept buttonless release clicks.
- Fix AgentSend argument forwarding for Herdr's prompt command and preserve delegate pane links during ordinary TodoUpdate detail edits.

- Replace the compact panel's session-ID title with an underlined Open session action beside Copy, opening the direct/nested agent artifact folder in Cursor with a command alternative; keep repository Open and width-safe controls.

- Add simple Herdr AgentCreate/List/Status/Output/Send/Interrupt/Close/Focus CLI wrappers using paneId directly, automatic task links and onSignal/onDone passthrough to existing pi-loop-monitor. Confirm monitoring before explicit AgentSend; no private agent lifecycle manager.
- Make linked delegate badges focus their panes and provide fullscreen clicks plus dashboard/command keyboard paths; keep ordinary task progress parent-owned.
- Underline Cursor Open actions and linked delegate badges; leave unlinked ownership informational and preserve clipping, scrolling, and progress columns.

## 0.9.3 - 2026-10-21

- Give work IDs, task IDs, and self/delegate ownership badges distinct theme-aware colors in compact panels, dashboard rows, and detail headings. Keep unassigned ownership muted and preserve text, progress columns, and Markdown exports.

## 0.9.2 - 2026-10-21

- Show `[taskId] [self/delegate] Task name` in compact panel and dashboard task labels using explicit ownership declarations in existing task details, with `[unassigned]` for missing or conflicting decisions.
- Replace the compact panel's Works title with the current Pi session ID from the session-context API, including minimized/widget modes, while preserving width-safe actions and overflow context.

- Coordinate every tracked Work through the global `implement` skill, preserving specialized skill permissions and side-conversation exceptions.
- Use full Pi session IDs and real Work/Task IDs for task-owned artifact paths, nesting delegated paths below the exact parent task directory. Record canonical paths in existing task details without migrating old artifacts or introducing shared cross-session state.
- Require an explicit self-versus-delegate decision and reason per task, with isolated ownership, ready inputs, and useful parallelism or expertise outweighing coordination costs. This remains instruction-only, with Herdr responsible for agent lifecycle.
- Name Herdr subagent root panes using only the parent's delegated Task ID; keep worker-local tracking and returned lifecycle resource IDs distinct from pane labels.

## 0.9.1 - 2026-10-21

- Prefix work and todo names with bracketed IDs in floating/widget panels, `/works` rows, and detail headings, without changing stored names or the reserved progress column.
- Require every delegated agent to establish and maintain its own session-local Work and Todo IDs before assigned work, pass the requirement to further agents, and report IDs with results. This is instruction-only; side-conversation exceptions remain unchanged.

## 0.9.0 - 2026-10-20

- Remove `planned` and `pending` from work and todo tools; both now use `active`, `blocked`, `completed`, and `cancelled`, with `active` as the creation default.
- Restore legacy `planned` and `pending` session events as `active` without rewriting history or losing records.
- Explicitly mark dependent tasks blocked while awaiting agent output, reviews, external responses, user input, permissions, or other obstacles; retain progress and record the dependency and resume condition.
- Clarify parent blocking and resumption guidance, and restrict auto-continuation to active works and todos.

## 0.8.3 - 2026-10-18

- Clarify tool and tracking guidance to request interim completion estimates during longer tasks after roughly 5–10 meaningful working steps or a milestone, rather than only at completion.
- Keep estimates optional and evidence-based, with unknown values allowed and no enforced schedule or automatic percentage increases.

## 0.8.2 - 2026-10-17

- Remove the wheel-to-scroll hint from the floating panel title while keeping the row range and mouse scrolling unchanged.

## 0.8.1 - 2026-10-17

- Reserve a slim right-hand progress column in the compact panel so long work and task names cannot obscure completion percentages.

## 0.8.0 - 2026-10-17

- Added optional AI-reported `completionPercent` to existing TodoCreate/TodoUpdate tools and persisted branch state.
- Show task completion and the equal average of non-cancelled tasks for works in existing panels, details, lists and Markdown export; preserve the current layout and controls.
- Keep unknown progress explicit, retain blocked-task estimates, and reserve 100% for completed tasks without letting parent status conceal unfinished children.

## 0.7.0 - 2026-10-17

- Added opt-in auto-continuation with an optional limit for unfinished session-branch works and todos using Pi 1.2's native pre-settlement boundary.
- Respect manual aborts, failed runs, queued messages, and unavailable tracking tools; only fresh interactive/RPC input rearms the flow after suspension.
- Added `pi-tasks.autoContinue.enabled` (default `false`) and optional `maxContinuations` (omission means unlimited) configuration with fail-closed validation.

## 0.6.0

- Added centered repository Git status to the compact panel and `/works` top border, retained when minimized.
- Show branch or detached commit plus staged, unstaged, and untracked file counts, with clean/loading/unavailable states and width-aware branch truncation.
- Share a read-only, asynchronous one-second Git cache across visible views, preserving the last snapshot during refreshes and stopping polling when hidden.
- Added Open between Copy and Minimize/Maximize to launch `cursor .` in the current session directory, with visible launch errors.
- Added the `o` shortcut in `/works` and `/works-panel open` for keyboard access.

## 0.5.1

- Clarified that stored work and todo details use full sentences and normal spacing, regardless of conversational brevity modes.
- Added this guidance to tool descriptions, detail schemas, session coordination, and the usage guide.

## 0.5.0

- Added optional positive `limit` to `WorkList` and `TodoList` for selecting the newest matching records after filtering.
- Included returned and total matching counts in list results and documented the selection behavior.

## 0.4.0

- Added clickable Copy and Minimize/Maximize actions to the persistent compact Works panel.
- Reused one Markdown export format across the compact panel and `/works` dashboard.

## 0.3.0

- Added a Copy action to `/works` for exporting every work and todo as clean Markdown.
- Added clickable Minimize/Maximize controls and live totals to the `/works` title bar.
- Changed compact-panel overflow to show the newest rows by default.
- Added direct mouse-wheel scrolling over the compact panel in fullscreen TUI mode.
- Removed the `/works-panel browse` subcommand; display modes remain available.
- Raised the minimum Pi coding-agent and TUI versions to 0.85.1 for mouse support.

## 0.2.0

- Added `/works-panel browse` for scrolling through every work and todo in the floating panel.
- Added a terminal-aware row viewport with visible range information.
- Kept completion counts visible when work names are long.
- Updated widget mode to render every work and todo row.

## 0.1.0

- Added session-branch-scoped works and todos.
- Added eight work and todo management tools.
- Added the compact top-right panel and detailed `/works` dashboard.
- Added cross-skill tracking guidance with `/ask` and `/btw` exclusions.
