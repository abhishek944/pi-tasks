# pi-tasks

A Pi extension for session-scoped work and todo tracking.

It adds:

- `WorkCreate`, `WorkList`, `WorkUpdate`, and `WorkDelete`
- `TodoCreate`, `TodoList`, `TodoUpdate`, and `TodoDelete`
- `/works`, a detailed floating dashboard modeled after `pi-loop-monitor`'s `/monitors`
- a compact floating top-right panel with work and todo names and completion percentages
- main-conversation guidance that keeps normal requested work current across every Pi skill

Works and todos follow the active Pi session branch. Forking or navigating the session tree restores the state for that branch. `/ask` and `/btw` conversations do not update works, todos, loops, or monitors.

The coordination model is intentionally small: a work is the overall outcome, a todo is one concrete step under it, a monitor runs one long-lived background command, and a loop schedules a future or repeated wake. Loops and monitors remain owned by `pi-loop-monitor`.

## Install

```bash
pi install npm:@abhishek944/pi-tasks@0.9.0
```

Restart Pi or run `/reload`.

## Use

The extension guides Pi to manage work automatically for normal requests that start or continue work. You can also call the tools directly:

```text
WorkCreate workName="Add task tracking" workInfo="Detailed goal, scope, constraints, and expected outcome" status="active"
TodoCreate workId="W1" taskName="Implement state" taskInfo="Detailed task context and expected result" status="active"
TodoUpdate taskId="T1" completionPercent=40 taskInfo="The state changes are implemented; rendering and verification remain."
TodoUpdate taskId="T1" status="completed" taskInfo="Implementation is complete; typecheck and build passed."
WorkUpdate workId="W1" status="completed"
```

Run `/works` to inspect full `workInfo` and `taskInfo` in an interactive overlay.

Works and todos use four statuses: `active` (the default), `blocked`, `completed`, and `cancelled`. Use `blocked` as soon as the next step must wait for agent output, review, an external response, user input, permission, or another obstacle. Record the dependency and resume condition in `workInfo` or `taskInfo`; retain progress. Work actually executing in another agent may remain active, but dependent tasks awaiting its output are blocked. Keep the parent active only while some required work can proceed; otherwise mark it blocked too. Return blocked records to active when the dependency resolves and work resumes. Status does not itself schedule a wake. Legacy saved `planned` and `pending` records restore as active; those statuses are no longer accepted by tools.

Pi reports approximate task progress through the existing `TodoCreate`/`TodoUpdate` tools using optional `completionPercent` (an integer from 0 to 100, or `null` for unknown). Work progress is the equal average of non-cancelled tasks, rounded down—not the fraction of finished tasks. For example, task values 100, 40, 0, 0 give work progress 35%. A missing estimate makes work progress unknown (`—`); blocked tasks retain their estimate. Completed tasks are 100%; reporting 100 without completed status is rejected. For longer tasks, the guidance asks Pi to include interim estimates after roughly 5–10 meaningful working steps or a milestone, rather than waiting until completion. Estimates remain optional and must be supported by evidence; this is guidance, not an enforced schedule. These percentages are estimates, not time predictions. The floating panel keeps percentages in a reserved right-hand column so long names cannot hide them. Existing keyboard controls are unchanged.

The panel defaults to the floating top-right layout. Its top border centers the current repository's Git branch and staged/unstaged/untracked file counts, refreshed asynchronously with a one-second cache. Clean repositories show `clean`. In fullscreen TUI mode, its title bar has clickable Copy, Open, and Minimize/Maximize actions, and you can scroll overflowing rows directly with the mouse wheel. Open runs `cursor .` in the current session directory (the Cursor CLI must be on PATH). Open `/works` to inspect every row or copy from the keyboard. Use `/works-panel minimize`, `/works-panel maximize`, or `/works-panel open` when mouse input is unavailable. In `/works`, press `o` to open Cursor. Switch layouts with `/works-panel floating`, `/works-panel widget`, or `/works-panel off`.

## Optional auto-continuation

On Pi 1.2.0 or newer, enable unfinished-work continuation in your global or trusted project `settings.json`:

```json
{
  "pi-tasks": {
    "autoContinue": { "enabled": true }
  }
}
```

It defaults off. Omit `maxContinuations` for no continuation limit, or add a positive integer such as `"maxContinuations": 10` to cap it. Unlimited continuation can consume tokens indefinitely while unfinished records remain; manual abort and the other stopping conditions still apply. After a normal user-requested run finishes, Pi continues while active works or todos remain. Completed, blocked, and cancelled records are settled. Escape/abort stops the flow; only a fresh accepted main interactive or RPC run rearms it. Extension wakes do not rearm it or reset the limit. The limit counts requested continuations per fresh main user run, not dollars or tool calls. Queued steering/follow-up input does not reset it. Reload after editing settings.

Auto-continuation uses Pi's native pre-settlement boundary, after queued work, retries, and compaction. It does not retry failed runs, run with unavailable tracking tools, or start work just because a session was restored. It never changes task statuses itself, and cannot independently prove completion. Older hosts retain ordinary tracking without this feature.

See [the usage guide](docs/USAGE_GUIDE.md) and [reference](docs/REFERENCE.md).

## Development

```bash
npm run lint
npm run typecheck
npm run build
npm run audit:production
```
