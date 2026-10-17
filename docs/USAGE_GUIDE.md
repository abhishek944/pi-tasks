# pi-tasks usage

## Automatic tracking

For every normal request that starts or continues work, Pi should:

1. Find existing work and todos.
2. Create or update the relevant work and mark it active.
3. Create or update detailed todos for the requested scope.
4. Mark the current todo active before starting it.
5. During longer tasks, report interim progress after roughly 5–10 meaningful working steps or a milestone, when an estimate is possible.
6. Mark the todo completed, blocked, or cancelled after the attempt.
7. Complete the work only when its required todos are complete.

The extension applies this guidance across all loaded skills and does not skip work merely because it looks small. It does not update tracking during `/ask`, `/btw`, or BTW side threads.

Write `workInfo` and `taskInfo` in normal prose with full sentences and spaces between words. Conversational brevity modes do not apply to stored records; do not concatenate words to shorten them. This is model-facing guidance, not automatic repair of existing text.

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

Send a normal prompt to start. If the agent finishes with planned/active works or pending/active todos, it receives a message to continue and verify them. Blocked, completed, and cancelled records do not cause another continuation. Keep the parent work synchronized too, and record a genuine blocker reason in its information field before handing off.

Press Escape/abort to stop. The extension will not restart from a monitor wake or another extension's message; send a new main prompt when you want it to resume. Failed runs also stop instead of being retried by this feature. Reloading or navigating session branches does not silently resume unfinished work.

Omitting `maxContinuations` means no continuation limit: it can keep consuming tokens while unfinished records remain. Manual abort and all other stopping conditions still apply. To cap it, add a positive integer such as `"maxContinuations": 10`. After the configured number of extra continuations, the extension warns and hands control back without changing records. A fresh accepted main user run resets the limit; a rejected prompt or steering/follow-up input queued inside a running activity does not. Set `enabled` to `false` and reload to disable the feature. It checks recorded states, not whether every user requirement was captured or genuinely verified.

## Work tools

```text
WorkCreate workName="Improve authentication" workInfo="Detailed context..." status="active"
WorkList
WorkList limit=10
WorkList status="active" limit=5
WorkList workId="W1"
WorkUpdate workId="W1" status="blocked" workInfo="Detailed blocker and retained context..."
WorkDelete workId="W1"
```

`WorkList` returns all matching works when `limit` is omitted. A positive integer `limit` selects the newest matching works after filters, displayed oldest-to-newest; every selected work still includes all of its todos. The result shows how many works were returned and how many matched in total. `WorkDelete` also removes associated todos.

## Todo tools

```text
TodoCreate workId="W1" taskName="Inspect token flow" taskInfo="Detailed context..." completionPercent=0
TodoList workId="W1"
TodoList status="active"
TodoList workId="W1" limit=10
TodoUpdate taskId="T1" status="active" completionPercent=40 taskInfo="Inspection is complete; implementation and verification remain."
TodoUpdate taskId="T1" status="completed" taskInfo="Detailed verified outcome..."
TodoUpdate taskId="T2" completionPercent=null taskInfo="The scope changed; the previous estimate is no longer reliable."
TodoDelete taskId="T1"
```

`TodoList` returns all matching todos when `limit` is omitted. A positive integer `limit` selects the newest matching todos after filters, displayed oldest-to-newest. The result shows how many todos were returned and how many matched in total. Both list tools can still truncate very long text output at 50KB or 2,000 lines.

### Completion percentages

During longer tasks, Pi should include a `completionPercent` estimate in `TodoUpdate` after roughly 5–10 meaningful working steps or a milestone, rather than waiting until completion or only updating status. Explain the evidence and remaining work in `taskInfo`. Estimates remain optional: use `null` when unknown, and leave a percentage unchanged if there is no new evidence. This is model-facing guidance, not an enforced schedule or an automatic percentage increase. These are approximate AI-reported values, not a fixed percentage for each status and not a time prediction. Use an integer 0–100 or `null` for unknown. Completed status means verified completion and displays 100%; 100 without completed status is rejected. Partial progress requires reopening a completed task; reopening without a fresh estimate makes it unknown. Blocking retains the current estimate.

Work progress averages all non-cancelled tasks equally and rounds down. Tasks at 100%, 40%, 0%, 0% produce 35% work completion, not 25% based on finished-task counts. If any eligible task lacks an estimate, the work displays `—`. No eligible tasks also means unknown unless the work itself is verified complete. A completed parent never hides unfinished task progress. Existing sessions retain their records; legacy completed tasks display 100%, while other missing estimates remain unknown.

## TUI

The panel defaults to a floating top-right layout and does not take keyboard focus. A slim, separated right-hand column keeps work and task percentages aligned and visible even when names are long; the left side retains names, status icons and work task-counts. It hides on small terminals. The top border centers repository-wide Git status: `git main · S2 U3 ?1` means two staged files, three unstaged files, and one untracked file; a file with both staged and unstaged edits counts in both. A clean repository shows `git main · clean`. Long branches shorten before counts. Detached HEAD shows `@` plus the short commit. Git remains visible while minimized and adds no content row.

The asynchronous Git cache refreshes every second while a view is attached; file-changing tool results expire it sooner without blanking the last snapshot. Initial reads show `git loading…`; outside Git the border is plain, and initial failures show `git unavailable`. Later refresh failures retain the last snapshot until a successful read. Polling is read-only and stops when both the panel and dashboard are closed/off.

In fullscreen TUI mode, click Copy in its title bar to copy every work and todo as Markdown, Open to run `cursor .` in the current session directory, or Minimize to collapse the panel to a small title bar. Copy and Open remain available while minimized, and Maximize restores the rows. Cursor's command-line launcher must be on PATH; launch failures produce visible error feedback. When more rows exist than fit, the floating panel starts at the newest rows; move the mouse over it and use the wheel to scroll older or newer rows without taking focus from the editor. In regular terminal mode, open `/works` to browse and copy the complete list.

Use `/works-panel minimize`, `/works-panel maximize`, or `/works-panel open` when mouse input is unavailable. Use `/works-panel widget` for a right-aligned layout above the editor that renders every row and retains the clickable title actions, `/works-panel floating` to return to the floating layout, or `/works-panel off` to hide it.

Run `/works` for full details. Its top border mirrors repository-wide Git status, and its top bar includes Copy, Open, and Minimize actions. In fullscreen TUI mode, click Minimize to collapse the dashboard to a top bar showing the current work and todo totals; click Maximize to restore it. The actions also have keyboard shortcuts that work in regular terminal mode.

- `c`: copy all works and todos as Markdown
- `o`: open the current repository/session directory in Cursor
- `m`: minimize or maximize the dashboard
- Fullscreen left click: activate Copy, Open, Minimize, or Maximize
- Configured Up/Down keys: select
- Configured Page Up/Page Down keys: scroll long details
- Configured confirmation key: show or hide detailed information
- Configured cancel key or Ctrl+C: close
