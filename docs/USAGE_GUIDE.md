# pi-tasks usage

## Automatic tracking

For every normal request that starts or continues work, Pi should:

1. Find existing work and todos.
2. Create or update the relevant work and mark it active.
3. Create or update detailed todos for the requested scope.
4. Mark the current todo active before starting it.
5. Mark the todo completed, blocked, or cancelled after the attempt.
6. Complete the work only when its required todos are complete.

The extension applies this guidance across all loaded skills and does not skip work merely because it looks small. It does not update tracking during `/ask`, `/btw`, or BTW side threads.

## Work tools

```text
WorkCreate workName="Improve authentication" workInfo="Detailed context..." status="active"
WorkList
WorkList workId="W1"
WorkUpdate workId="W1" status="blocked" workInfo="Detailed blocker and retained context..."
WorkDelete workId="W1"
```

`WorkDelete` also removes associated todos.

## Todo tools

```text
TodoCreate workId="W1" taskName="Inspect token flow" taskInfo="Detailed context..."
TodoList workId="W1"
TodoList status="active"
TodoUpdate taskId="T1" status="completed" taskInfo="Detailed outcome..."
TodoDelete taskId="T1"
```

## TUI

The panel defaults to a floating top-right layout and does not take keyboard focus. It hides on small terminals. Use `/works-panel widget` for the earlier right-aligned layout above the editor, `/works-panel floating` to return to the floating layout, or `/works-panel off` to hide it.

Run `/works` for full details:

- Configured Up/Down keys: select
- Configured Page Up/Page Down keys: scroll long details
- Configured confirmation key: show or hide detailed information
- Configured cancel key or Ctrl+C: close
