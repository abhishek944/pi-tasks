# pi-tasks

A Pi extension for session-scoped work and todo tracking.

It adds:

- `WorkCreate`, `WorkList`, `WorkUpdate`, and `WorkDelete`
- `TodoCreate`, `TodoList`, `TodoUpdate`, and `TodoDelete`
- `/works`, a detailed floating dashboard modeled after `pi-loop-monitor`'s `/monitors`
- a compact floating top-right panel with work and todo names, completion percentages, and measured active time
- main-conversation guidance that keeps normal requested work current across every Pi skill and requires each delegated agent to establish its own Work and Todo IDs before assigned work

Works and todos follow the active Pi session branch. Forking or navigating the session tree restores the state for that branch. `/ask` and `/btw` conversations do not update works, todos, loops, or monitors.

The coordination model is intentionally small: a work is a collection of tasks with shared context and no status, a todo is one concrete step with its own status, a monitor runs one long-lived background command, and a loop schedules a future or repeated wake. Loops and monitors remain owned by `pi-loop-monitor`.

Tracking guidance requires the globally installed `implement` skill as the coordination workflow for every tracked Work, including worker-local Works, while preserving specialized skill permissions. Pi-tasks owns records/progress, `implement` owns task ownership decisions and artifact paths, and `herdr` owns delegated-agent lifecycle. Root artifacts use repository-relative `var/<sessionId>/<workId>/<taskId>/`; children nest their own session/Work/Task path below the parent task directory. Each task records `self` or `delegate` with a reason in `taskInfo`. These are instructions, not runtime enforcement, shared cross-session records, or an automatic skill installer. Missing required skills, tools, or IDs blocks execution; plain conversation and `/ask`/`/btw` remain outside this workflow. See [the usage guide](docs/USAGE_GUIDE.md#shared-workflow-and-artifacts) for setup and the full contract.

## Install

```bash
pi install npm:@abhishek944/pi-tasks
```

Restart Pi or run `/reload`.

## Use

The extension guides Pi to manage work automatically for normal requests that start or continue work. You can also call the tools directly:

```text
WorkCreate workName="Add task tracking" workInfo="Detailed goal, scope, constraints, and expected outcome"
TodoCreate workId="W1" taskName="Implement state" taskInfo="Detailed task context and expected result" status="active"
TodoUpdate taskId="T1" working=true
TodoUpdate taskId="T1" completionPercent=40 taskInfo="The state changes are implemented; rendering and verification remain."
TodoUpdate taskId="T1" status="completed" taskInfo="Implementation is complete; typecheck and build passed."
WorkUpdate workId="W1" workInfo="Task tracking is implemented; state and UI checks passed."
```

Run `/works` to inspect full `workInfo` and `taskInfo` in an interactive overlay.

Works are collections with no status. Tasks use four statuses: `active` (the default), `blocked`, `completed`, and `cancelled`. Use `blocked` as soon as the next step must wait for agent output, review, an external response, user input, permission, or another obstacle. Supply `blockedReason` when creating a blocked task or entering blocked status, explaining the dependency and resume condition; retain progress. The reason is preserved during other blocked edits and cleared when leaving blocked. Older records without a reason remain readable. Parent delegated tasks stay blocked while awaiting worker output; the worker's own local tasks may be active. AgentCreate automatically blocks the parent task after successful creation, retaining its progress. For manual delegation, mark the parent task blocked explicitly. Return blocked tasks to active when the dependency resolves and work resumes. Status does not itself schedule a wake. Legacy saved task statuses `planned` and `pending` restore as active; old Work statuses are ignored. Work tools no longer accept status or a status filter. To cancel an entire Work, cancel its remaining tasks; WorkDelete still deletes the collection and its tasks.

Pi reports approximate task progress through the existing `TodoCreate`/`TodoUpdate` tools using optional `completionPercent` (an integer from 0 to 100, or `null` for unknown). Work progress is the equal average of non-cancelled tasks, rounded down—not the fraction of finished tasks. For example, task values 100, 40, 0, 0 give work progress 35%. A missing estimate makes work progress unknown (`—`); blocked tasks retain their estimate. Completed tasks are 100%; reporting 100 without completed status is rejected. For longer tasks, the guidance asks Pi to include interim estimates after roughly 5–10 meaningful working steps or a milestone, rather than waiting until completion. Estimates remain optional and must be supported by evidence; this is guidance, not an enforced schedule. These percentages are estimates, not time predictions. The floating panel keeps percentages in a reserved right-hand column so long names cannot hide them. Existing keyboard controls are unchanged.

### Active task time

The panel and `/works` reserve **Done** and **Time** columns. Select the task you are actually working on with `TodoUpdate taskId="T1" working=true`; it must be active and have `owner: self` in its details. Selecting another task pauses the previous one. Use `working=false` to pause without changing status. Select again at the beginning of each fresh run; merely creating or marking a task active never starts its timer.

The extension uses `Date.now()` to add working intervals, including thinking and foreground tools. Idle time, native retry delays between agent loops, and blocking user prompts do not count. Completion, blocking, cancellation, ownership changes, abort, and shutdown stop the timer automatically. Saved totals survive reload and branch navigation; restored tasks are paused and offline time never counts. A running time has a `▶` marker. Totals are saved on interval boundaries, not every display tick. A forced process kill can lose the current unsaved interval. Blocking prompt exclusion needs a Pi host that emits `ui_prompt_start`/`ui_prompt_end`; older hosts still pause at agent-loop boundaries.

New tasks start at `0s`; historical tasks without timing show `—` until measured, with no attempt to reconstruct earlier time. Work time sums every task's measured effort, including cancelled tasks; any unknown task makes the total unknown. It is not wall-clock duration or an estimate of remaining time. Every delegated agent times its own local tasks; the parent delegate record shows `—` because remote time is unmeasured, and makes the Work total unknown. It never treats waiting as work. Listings and copied Markdown include the same totals.

The panel and `/works` prefix work names with IDs and task names with IDs plus ownership, such as `[W1] Locate subagent restrictions` and `[T1] [self] Inspect the implement skill`. Task ownership comes from an explicit `owner: self` or `owner: delegate` declaration at the start of a line in `taskInfo`; preserve it on updates. Missing or conflicting decisions show `[unassigned]`, without rewriting stored names or old records. Inside Herdr, `AgentCreate` automatically links its task to an underlined, clickable `[delegate]` badge; Open actions are also underlined. See [delegate pane links](docs/USAGE_GUIDE.md#delegate-pane-links) for linking and keyboard access.

The panel defaults to the floating top-right layout. The compact header no longer displays the session ID. An underlined Open session action beside Copy opens this agent's artifact folder in Cursor, including existing nested delegated paths; if none exists, it creates `var/<sessionId>/`. The existing Open still opens the repository. Use `/works-panel open-session` without mouse input. Narrow headers shorten Minimize/Maximize to `[-]`/`[+]`. The `/works` dashboard title stays unchanged. Its top border centers the current repository's Git branch and staged/unstaged/untracked file counts, refreshed asynchronously with a one-second cache. Clean repositories show `clean`. In fullscreen TUI mode, its title bar has clickable Copy, Open, and Minimize/Maximize actions, and you can scroll overflowing rows directly with the mouse wheel. Open runs `cursor .` in the current session directory (the Cursor CLI must be on PATH). Open `/works` to inspect every row or copy from the keyboard. Use `/works-panel minimize`, `/works-panel maximize`, or `/works-panel open` when mouse input is unavailable. In `/works`, press `o` to open Cursor. Switch layouts with `/works-panel floating`, `/works-panel widget`, or `/works-panel off`.

## Task-owned agents

`AgentCreate`, `AgentList`, `AgentStatus`, `AgentOutput`, `AgentSend`, `AgentInterrupt`, `AgentClose`, and `AgentFocus` are simple Herdr CLI wrappers using paneId directly. AgentCreate also registers pi-loop-monitor and returns IDs plus a prepared assignment; confirm MonitorList shows subscription ready, then AgentSend it. `onSignal` wakes the parent for worker state changes; optional `onDone` handles monitor termination, not task completion. No registry, startup receipts, process checks or automatic recovery. Creation/closure need modern Pi nested calls and updated pi-loop-monitor metadata; no pi-herdr-agents dependency. See [agent tools](docs/USAGE_GUIDE.md#agent-tools).

## Optional auto-continuation

On Pi 1.2.0 or newer, enable unfinished-work continuation in your global or trusted project `settings.json`:

```json
{
  "pi-tasks": {
    "autoContinue": { "enabled": true }
  }
}
```

It defaults off. Omit `maxContinuations` for no continuation limit, or add a positive integer such as `"maxContinuations": 10` to cap it. Unlimited continuation can consume tokens indefinitely while unfinished records remain; manual abort and the other stopping conditions still apply. After a normal user-requested run succeeds or fails, Pi continues while any task across all Works on the current session branch is active. Empty Works and blocked, completed, or cancelled tasks do not trigger continuation; legacy planned/pending task statuses restore as active. Escape/abort stops the flow; only a fresh accepted main interactive or RPC run rearms it. Extension wakes do not rearm it or reset the limit. The limit counts requested continuations per fresh main user run, not dollars or tool calls. Queued steering/follow-up input does not reset it. Reload after editing settings.

Auto-continuation uses Pi's native pre-settlement boundary, after queued work, retries, and compaction. Failed runs do not disarm it: after Pi's native retries finish, unfinished records request another continuation. It does not run with unavailable tracking tools or start work just because a session was restored. It never changes task statuses itself, and cannot independently prove completion. Older hosts retain ordinary tracking without this feature.

See [the usage guide](docs/USAGE_GUIDE.md) and [reference](docs/REFERENCE.md).

## Development

```bash
npm run lint
npm run typecheck
npm run build
npm run audit:production
```
