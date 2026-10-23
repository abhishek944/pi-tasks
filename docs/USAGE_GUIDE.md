# pi-tasks usage

## Automatic tracking

For every normal request that starts or continues work, Pi should:

1. Find existing work and todos.
2. Create the relevant Work collection, or refresh its shared context when needed.
3. Create or update detailed todos for the requested scope.
4. Mark the current todo active before starting it. For an `owner: self` task, include `working=true` to select it for automatic timing; re-select at the start of each fresh run.
5. During longer tasks, report interim progress after roughly 5–10 meaningful working steps or a milestone, when an estimate is possible.
6. Mark the todo blocked immediately if its next step must wait on a dependency; otherwise update it after the attempt as active, completed, or cancelled.
7. Keep status on tasks only; update Work context when scope or shared decisions change.

The extension applies this guidance across all loaded skills and does not skip work merely because it looks small. It does not update tracking during `/ask`, `/btw`, or BTW side threads.

Write `workInfo` and `taskInfo` in normal prose with full sentences and spaces between words. Conversational brevity modes do not apply to stored records; do not concatenate words to shorten them. This is model-facing guidance, not automatic repair of existing text.

## Shared workflow and artifacts

Every tracked Work, including each worker's local Work, uses the globally installed `implement` skill for coordination. Read it once before execution, or reuse it if active. Specialized skills retain their scope: research and review remain read-only, and planning does not authorize implementation. Plain conversation, `/ask`, and `/btw` remain outside this workflow. Pi-tasks owns records and progress; `implement` owns coordination, artifact paths, and integration; `herdr` owns delegated-agent lifecycle and monitors. This instruction does not install those skills or add runtime enforcement. If `implement`, tracking tools, or required IDs are unavailable, report the blocker rather than executing without them.

Read the full current session ID through the agent's own shell tool:

```bash
printf '%s\n' "$PI_SESSION_ID"
```

Startup includes reading instructions, obtaining identity, and creating/resuming tracking. Before execution, require a nonempty session ID matching `[A-Za-z0-9][A-Za-z0-9_-]*`, a real tool-returned Work ID, and an active Task ID. Do not invent IDs, use a Herdr pane/name as identity, or substitute the parent's session ID. Hosts/custom shell tools that do not expose session identity must report that blocker.

Root task artifacts use repository-relative `var/<sessionId>/<workId>/<taskId>/`, never the system `/var/`. A delegated worker appends its own `<childSessionId>/<childWorkId>/<childTaskId>/` below the exact `parentTaskDir` from its assignment, recursively. For example:

```text
var/<rootSessionId>/W1/T2/
  plan.md
  <childSessionId>/W1/T1/
    report.md
```

Record the canonical artifact directory and parent session/Work/Task IDs in `taskInfo`, pass them unchanged in handoffs, and return them with results. Keep resolved destinations inside the repository's `var/`, including symlinks. Create folders only for useful artifacts; feature names remain descriptions rather than path keys. Each task owns its files and links to shared coordinating-task plans rather than copying them. Reuse recorded paths only after verifying current ownership, especially after session-branch navigation; matching numeric IDs alone do not authorize overwriting artifacts. Preserve existing artifacts unless an explicit migration is approved. Follow `implement` for detailed path handling and report incompatible legacy helper paths rather than inventing unsupported arguments or silently falling back to feature-named directories.

### Choose self or delegate

Before each task, start `taskInfo` with `owner: self` or `owner: delegate` and a short reason. Preserve this declaration when updating the details. Delegate only when scope and acceptance criteria are clear, ownership can be isolated, required inputs and verified prerequisites are ready, and useful parallelism or expertise outweighs startup, context transfer, monitoring, and integration costs. The owning skill must permit delegation and required tracking and monitoring must be available. Small straightforward changes, tightly coupled edits, shared-interface design, and expensive-to-explain work normally stay with one owner. Risk alone is not a reason for parallel coding; independent review may still help. Do not use arbitrary file-count, agent-count, or depth thresholds. Reassess if scope changes; each allowed delegating child applies the same rule, and parents retain responsibility for monitoring, integration, verification, and cleanup.

Name each Herdr subagent root pane exactly with the parent's delegated Todo ID, for example `T34`, without brackets, descriptions, Work IDs, or other prefixes. The worker creates its own session-local tracking after startup; those IDs do not replace this pane label. Rename an owned worker pane if a follow-up assigns a different parent Todo. Names may repeat across parent sessions, so use returned resource IDs for lifecycle commands, never pane names.

These are instructions using existing details fields, not a new schema, shared cross-session task tree, automatic directory creator, or enforcement hook.

## Delegated agents

Every subagent must create or resume its own session-local Work and Todos before starting its assignment, at every delegation depth. It must have a real `workId` and an active `taskId` for the current step, keep its records current, and return the IDs with results, checks, and blockers. Include this requirement, the `implement`/specialized skill handoff, parent session/Work/Task IDs, and the canonical parent task directory in every worker prompt. Require the worker to return its own session/Work/Task IDs and canonical nested artifact directory. Record parent assignment IDs as context, not as shared records: each Pi session has its own IDs. If tracking tools or IDs are unavailable, the worker must report the blocker and not begin assigned work; a parent-owned Todo or Markdown checklist is not a substitute. Never invent IDs or claim tracking existed before it did. This is model-facing guidance, not a runtime enforcement hook; `/ask` and `/btw` remain outside tracking.

## Statuses and dependencies

Works are collections with no status. Tasks use only `active`, `blocked`, `completed`, and `cancelled`. New tasks default to `active`; saved legacy task statuses `planned` and `pending` restore as active but are no longer accepted by tools. Old Work statuses are ignored during replay; no saved history is rewritten.

Use `blocked` immediately when a task cannot proceed until another agent produces output, a review finishes, an external response arrives, the user responds, permission is granted, or another obstacle is resolved. Supply `blockedReason` when creating a blocked task or entering blocked status: explain which dependency it awaits and what will unblock it. Retain its current completion estimate. Other blocked edits preserve the reason; leaving blocked clears it. Older tasks without a reason show “No reason recorded.” Parent delegated tasks stay blocked while awaiting worker output; the worker's own local tasks may be active. AgentCreate automatically blocks the parent task after successful creation, retaining its progress. For manual delegation, mark the parent task blocked explicitly.

When the dependency resolves and work resumes, mark the affected tasks active. Do not assign status to the parent Work. To cancel the whole collection, cancel its remaining tasks explicitly. Neither blocked status nor changing it schedules a wake automatically; use the appropriate monitor or event when an automatic notification is needed.

## Continue unfinished work automatically

This is off by default and requires Pi 1.2.0+. Add the following to global `~/.pi/agent/settings.json` (or your custom agent directory) or a trusted project's `.pi/settings.json`, then run `/reload`:

```json
{
  "pi-tasks": {
    "autoContinue": {
      "enabled": true
    }
  }
}
```

Send a normal prompt to start. After success or failure, if any task across all Works on the current session branch is active, the agent receives a message to continue and verify it. Legacy planned/pending task statuses restore as active. Empty Works and blocked, completed, or cancelled tasks do not cause another continuation. Record genuine blockers and resume conditions in `blockedReason` when entering blocked status before handing off.

Press Escape/abort to stop. The extension will not restart from a monitor wake or another extension's message; send a new main prompt when you want it to resume. Failed runs do not disarm continuation: after native retries, unfinished records request another run. Repeated provider failures can therefore keep consuming tokens with no configured limit. Reloading or navigating session branches does not silently resume unfinished work.

Omitting `maxContinuations` means no continuation limit: it can keep consuming tokens while unfinished records remain. Manual abort and all other stopping conditions still apply. To cap it, add a positive integer such as `"maxContinuations": 10`. After the configured number of extra continuations, the extension warns and hands control back without changing records. A fresh accepted main user run resets the limit; a rejected prompt or steering/follow-up input queued inside a running activity does not. Set `enabled` to `false` and reload to disable the feature. It checks recorded states, not whether every user requirement was captured or genuinely verified.

## Work tools

```text
WorkCreate workName="Improve authentication" workInfo="Detailed context..."
WorkList
WorkList limit=10
WorkList workId="W1"
WorkUpdate workId="W1" workInfo="Updated shared scope and decisions..."
WorkDelete workId="W1"
```

Work tools do not accept `status`; `WorkList` filters by Work ID only. `WorkList` returns all matching works when `limit` is omitted. A positive integer `limit` selects the newest matching works after filters, displayed oldest-to-newest; every selected work still includes all of its todos. The result shows how many works were returned and how many matched in total. `WorkDelete` also removes associated todos.

## Todo tools

```text
TodoCreate workId="W1" taskName="Inspect token flow" taskInfo="Detailed context..." completionPercent=0
TodoList workId="W1"
TodoList status="active"
TodoList workId="W1" limit=10
TodoUpdate taskId="T1" status="active" completionPercent=40 taskInfo="Inspection is complete; implementation and verification remain."
TodoUpdate taskId="T1" status="blocked" blockedReason="Waiting for the review findings. Resume when the reviewer returns them."
TodoUpdate taskId="T1" status="completed" taskInfo="Detailed verified outcome..."
TodoUpdate taskId="T2" completionPercent=null taskInfo="The scope changed; the previous estimate is no longer reliable."
TodoDelete taskId="T1"
```

`TodoList` returns all matching todos when `limit` is omitted. A positive integer `limit` selects the newest matching todos after filters, displayed oldest-to-newest. The result shows how many todos were returned and how many matched in total. Both list tools can still truncate very long text output at 50KB or 2,000 lines.

### Active task time

```text
TodoUpdate taskId="T1" status="active" working=true
TodoUpdate taskId="T2" working=true
TodoUpdate taskId="T2" working=false
```

The first call selects T1; the second pauses T1 and selects T2; the third pauses T2 without changing its status. `working=true` requires an active task with `owner: self` in its details. Creation and active status alone do not start timing. The model selects the task, but never submits timestamps or estimates of duration.

Time is saved total milliseconds plus `Date.now() - workingSince` while running. The extension saves each interval when paused, switched, or finished, not on every one-second display refresh. Thinking and foreground tool execution count. Idle periods, retry delays between agent loops, and blocking extension UI prompts pause timing. Blocking, completion, cancellation, changing away from self ownership, abort, and shutdown close the interval. Select again at the beginning of each new run. A restored session or branch always starts paused and excludes offline time. Abrupt process termination can lose the unsaved current interval; there is no background checkpoint writer. Blocking prompt exclusion requires a Pi host emitting `ui_prompt_start` and `ui_prompt_end`; older hosts retain loop-boundary timing.

The compact panel and `/works` show reserved Done and Time columns; `▶` beside a duration means it is running. New tasks show `0s`. Legacy tasks without timing show `—`; selecting one begins measurement from now, not from its creation date. Work time sums task effort, including cancelled tasks; any unknown duration makes its total unknown. This is not elapsed wall-clock time and does not predict completion. Each delegated agent times its own local tasks. Parent delegate records show `—` until the worker exports measured time and the parent imports it. Imported effort contributes to both the parent task and its Work, even while the parent task remains blocked. List tools and copied Markdown include durations too.

### Delegated timing

AgentCreate creates a unique `delegated-time-<id>.json` descriptor below the existing canonical parent task directory and returns its `reportPath`. Its prepared worker assignment includes export instructions; its monitor callback includes import instructions. Herdr still runs the worker and pi-loop-monitor still reports state changes. The timing file, not the notification or chat response, carries the measured values. Both agents need this version of pi-tasks loaded.

Before returning, the worker pauses or completes its assignment tasks and exports their timing:

```text
TodoUpdate taskId="T1" working=false
TaskTimeExport reportPath="<exact path from AgentCreate>" taskIds=["T1", "T2"]
```

Use worker-local IDs for every task in this assignment, including cancelled tasks. Exclude unrelated work. Durations are read by the extension; the model never supplies milliseconds. Import any nested delegates before exporting their containing task. Unknown nested or historical effort stays unknown. An export is a paused snapshot, not a live timer; work performed after export needs a new export.

After inspecting the worker output, the parent imports timing using its own task ID:

```text
TaskTimeImport taskId="T5"
```

Import leaves status and completion unchanged. The parent can remain blocked and still display measured worker effort. Import before closing the worker, so export failures can be corrected. Repeated imports replace the previous cumulative value. After follow-ups, the worker re-exports all previously included task IDs plus any new assignment tasks to the same file, and the parent imports again. A new AgentCreate on the same parent task registers an additional assignment source; its effort is added once, and unreported sources make the total unknown.

Report files contain parent IDs, worker session identity and task timing values, not task text or transcripts. They must remain under repository `var/`. A report binds to its first exporting worker session. Missing files, identity mismatches and malformed data produce tool errors; missing worker exports remain unknown rather than zero. Legacy/manual delegations without an AgentCreate report remain unknown. Existing imported totals survive reload and pane closure; newer worker exports only affect the parent after another explicit import. Older extension versions cannot show these imported totals. No polling, background timing registry, or changes to Herdr/pi-loop-monitor are involved.

### Completion percentages

During longer tasks, Pi should include a `completionPercent` estimate in `TodoUpdate` after roughly 5–10 meaningful working steps or a milestone, rather than waiting until completion or only updating status. Explain the evidence and remaining work in `taskInfo`. Estimates remain optional: use `null` when unknown, and leave a percentage unchanged if there is no new evidence. This is model-facing guidance, not an enforced schedule or an automatic percentage increase. These are approximate AI-reported values, not a fixed percentage for each status and not a time prediction. Use an integer 0–100 or `null` for unknown. Completed status means verified completion and displays 100%; 100 without completed status is rejected. Partial progress requires reopening a completed task; reopening without a fresh estimate makes it unknown. Blocking retains the current estimate.

Work progress averages all non-cancelled tasks equally and rounds down. Tasks at 100%, 40%, 0%, 0% produce 35% work completion, not 25% based on finished-task counts. If any eligible task lacks an estimate, the work displays `—`. No eligible tasks (an empty Work or only cancelled tasks) also means unknown. Work progress has no separate status or override. Existing sessions retain their records; legacy completed tasks display 100%, while other missing estimates remain unknown.

## TUI

Both the compact panel (floating or widget) and `/works` prefix work names with their IDs, such as `[W1] Locate subagent restrictions`. Task rows and dashboard detail headings also include ownership: `[T1] [self] Inspect the implement skill` or `[T2] [delegate] Implement storage`. These are display labels only; stored names and IDs are unchanged. Work IDs use the theme's accent color, task IDs use its type-highlight color, `[self]` uses success, `[delegate]` uses warning, and `[unassigned]` stays muted. Exact hues follow the selected theme; labels remain readable without relying on color.

Ownership is read case-insensitively from explicit line-start `owner: self` or `owner: delegate` declarations in `taskInfo`, optionally followed by a reason or sentence. Incidental prose does not assign ownership. Missing, invalid, or conflicting declarations show `[unassigned]`; repeated declarations with the same valid value are unambiguous. No old records are rewritten and no new tool parameter is required. For example:

```text
owner: self. This is a small, tightly coupled change.
The task covers the panel label and its documentation.
```

### Delegate pane links

`[delegate]` describes the ownership decision; it does not launch an agent. After successful agent startup and monitor creation, AgentCreate automatically marks the parent task blocked and adds `herdr-pane: <paneId>` and `herdr-monitor: <monitorId>` lines to its existing details. The completion estimate is retained; earlier creation failures do not change its status. TodoUpdate keeps those lines when both old and new ownership stay delegate and the new details do not supply replacement link metadata. Explicit metadata takes precedence; changing ownership or AgentClose can clear the link. Set `herdr-pane: none` to explicitly unlink without changing ownership. No new task schema or private agent registry is added. AgentClose clears matching links without changing ownership or completion.

## Agent tools

These are simple Herdr CLI wrappers in pi-tasks, with no pi-herdr-agents dependency. AgentCreate also calls the existing MonitorCreate tool; AgentClose calls MonitorStop. Those two need modern Pi nested calls and the updated pi-loop-monitor result metadata. Base Work/Todo tracking and ordinary CLI wrappers do not depend on a private monitoring runtime.

| Tool | Purpose |
| --- | --- |
| `AgentCreate` | Create a timing descriptor, an unfocused tab, start Pi and register monitoring; return paneId/tabId/monitorId/reportPath plus a prepared assignment. No prompt is sent. |
| `AgentList` | `herdr agent list` (includes unrelated agents). |
| `AgentStatus` | `herdr agent get <paneId>`. |
| `AgentOutput` | `herdr pane read`; 50 trailing lines by default, up to 200. |
| `AgentSend` | `herdr agent prompt <paneId> <message>` without waiting. |
| `AgentInterrupt` | `herdr agent send-keys <paneId> esc`. |
| `AgentClose` | MonitorStop for the supplied monitorId, then `herdr pane close <paneId>`. |
| `AgentFocus` | `herdr agent focus <paneId>`; also used by delegate links. |

For an existing active Work/Todo whose `taskInfo` starts with `owner: delegate`, call:

```typescript
AgentCreate({
  workId: "W1",
  taskId: "T2",
  taskDir: "var/<full-current-sessionId>/W1/T2",
  assignment: "Review the approved change. Do not edit files or run tests.",
  provider: "<chosen-provider>",
  model: "<chosen-model-id>",
  thinking: "high",
  onSignal: "Inspect worker output. Help with blockers; review the actual changes before completing the task.",
  onDone: "The monitor stopped. Inspect its status and recover monitoring if still needed."
})
```

Replace placeholders using the existing implement path convention and model-routing-policy. The wrapper requires taskDir to exist inside the repository's canonical var/ tree. It creates a timing descriptor there but does not create folders or verify the running model. It adds parent context, worker-local tracking and timing-export instructions without granting extra permissions.

AgentCreate returns `assignmentSent: false`. Confirm MonitorList shows `Herdr signal subscription ready for <paneId>`, then call `AgentSend({ paneId, message: assignment })` using the returned assignment. Do not add a second monitor. Follow-up messages use that same paneId and existing subscription.

`onSignal` is a wake instruction for worker state changes, including blocked, idle and done. The monitor keeps watching. `onDone` is a wake instruction if the monitor process terminates, not a worker-completion callback; when omitted, pi-loop-monitor supplies its recovery instruction. Neither returns the worker's complete answer automatically. The parent uses `AgentOutput` and inspects actual files before marking tasks complete. Do not add a duplicate monitor or close a worker merely because it reports done.

Use actual paneId values, not pane names or a separate agent handle. These wrappers assume an agent pane is not repurposed. There are no process/session checks, startup receipts, registry, automatic reconnection, retry or rollback framework. Ordinary CLI errors are returned with any handles already obtained so the caller can inspect and decide what to do. Close only resources you created; a done signal does not automatically close anything or complete a task. If monitoring stops, use the existing monitor tools to inspect/reconnect explicitly.

Inside Herdr (`HERDR_ENV=1`), a linked `[delegate]` is underlined. In fullscreen mode, click that badge in compact/widget rows, dashboard rows, or task detail headings to focus its agent pane. Only fully visible badges are clickable. In `/works`, select the task and press `d`; `/works-panel delegate T<number>` provides a command path, including regular terminal mode. `[Open]` / `[O Open]` are also underlined and still open Cursor. Unlinked badges are not underlined, because they are not navigation actions.

Navigation directly focuses the linked paneId through Herdr. Closed panes, missing Herdr CLI and command errors are reported. No subprocess runs during rendering. Agent tools coordinate Herdr resources; pi-loop-monitor remains the sole monitoring runtime. Outside Herdr, badges remain informational.

The compact panel no longer displays the session ID. Before Copy, its header shows nonzero task-state counts across all Works: `3!` blocked, `2▶` active, `5✓` completed, and `1×` cancelled, using the same icon colors as task rows. Counts update in floating, widget and minimized layouts; narrow headers shorten the toggle and truncate the summary when needed. Its underlined `[Open session]` action sits immediately after Copy in floating, widget and minimized layouts. It opens this agent's existing artifact directory under repository `var/` in Cursor, including a nested delegated session folder. If no folder exists, it creates `var/<full-sessionId>/`; multiple matching folders report an ambiguity rather than guessing. Session identity comes from Pi's context, not a pane name. Folder resolution and Cursor launch happen only on activation, never during rendering. `/works-panel open-session` is the keyboard-command alternative. The existing Open action still opens the repository. Narrow compact headers use `[-]`/`[+]` for Minimize/Maximize so all actions fit. The `/works` dashboard retains its existing title and controls.

The panel defaults to a floating top-right layout and does not take keyboard focus. Its minimum box width is 48 columns to leave room for names beside both metrics; the widget hides below 48 columns. Separated right-hand Done and Time columns keep work/task percentages and measured durations aligned and visible even when names are long; the left side retains names, task status icons and Work task-counts. Work rows have no status icons. It hides on small terminals. The top border centers repository-wide Git status: `git main · S2 U3 ?1` means two staged files, three unstaged files, and one untracked file; a file with both staged and unstaged edits counts in both. A clean repository shows `git main · clean`. Long branches shorten before counts. Detached HEAD shows `@` plus the short commit. Git remains visible while minimized and adds no content row.

The asynchronous Git cache refreshes every second while a view is attached; file-changing tool results expire it sooner without blanking the last snapshot. Initial reads show `git loading…`; outside Git the border is plain, and initial failures show `git unavailable`. Later refresh failures retain the last snapshot until a successful read. Polling is read-only and stops when both the panel and dashboard are closed/off.

In fullscreen TUI mode, click Copy in its title bar to copy every work and todo as Markdown, Open to run `cursor .` in the current session directory, or Minimize to collapse the panel to a small title bar. Copy and Open remain available while minimized, and Maximize restores the rows. Cursor's command-line launcher must be on PATH; launch failures produce visible error feedback. When more rows exist than fit, the floating panel starts at the newest rows; move the mouse over it and use the wheel to scroll older or newer rows without taking focus from the editor. In regular terminal mode, open `/works` to browse and copy the complete list.

Use `/works-panel minimize`, `/works-panel maximize`, `/works-panel open`, or `/works-panel open-session` when mouse input is unavailable. Use `/works-panel widget` for a right-aligned layout above the editor that renders every row and retains the clickable title actions, `/works-panel floating` to return to the floating layout, or `/works-panel off` to hide it.

Run `/works` for full details. Its top border mirrors repository-wide Git status, and its top bar includes Copy, Open, and Minimize actions. In fullscreen TUI mode, click Minimize to collapse the dashboard to a top bar showing the current work and todo totals; click Maximize to restore it. The actions also have keyboard shortcuts that work in regular terminal mode.

- `c`: copy all works and todos as Markdown
- `o`: open the current repository/session directory in Cursor
- `d`: open the selected task's linked delegated agent
- `m`: minimize or maximize the dashboard
- Fullscreen left click: activate header actions, or click a task/work row to open its full details. Clicking a linked delegate badge still opens its agent.
- Configured Up/Down keys: select in the list; scroll in details
- Configured Page Up/Page Down keys: page through the list or scroll long details
- Configured confirmation key: open the selected record's full detail view
- Back to works or configured cancel key: return from details to the task list without losing your place
- Configured cancel key from the task list: close `/works`

The full task view shows its name, parent work, status, completion, measured time and full task information. Blocked tasks show **Reason:** followed by the blocker text on the same line, wrapping as needed, before the task information. The mouse wheel scrolls long details. Escape from details returns to the task list; Escape again closes the dashboard.
