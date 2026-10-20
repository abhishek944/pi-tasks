# Changelog

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
