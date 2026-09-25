# pi-tasks

A Pi extension for session-scoped work and todo tracking.

It adds:

- `WorkCreate`, `WorkList`, `WorkUpdate`, and `WorkDelete`
- `TodoCreate`, `TodoList`, `TodoUpdate`, and `TodoDelete`
- `/works`, a detailed floating dashboard modeled after `pi-loop-monitor`'s `/monitors`
- a compact floating top-right panel with work and todo names
- main-conversation guidance that keeps normal requested work current across every Pi skill

Works and todos follow the active Pi session branch. Forking or navigating the session tree restores the state for that branch. `/ask` and `/btw` conversations do not update works, todos, loops, or monitors.

The coordination model is intentionally small: a work is the overall outcome, a todo is one concrete step under it, a monitor runs one long-lived background command, and a loop schedules a future or repeated wake. Loops and monitors remain owned by `pi-loop-monitor`.

## Install

```bash
pi install npm:@abhishek944/pi-tasks@0.2.0
```

Restart Pi or run `/reload`.

## Use

The extension guides Pi to manage work automatically for normal requests that start or continue work. You can also call the tools directly:

```text
WorkCreate workName="Add task tracking" workInfo="Detailed goal, scope, constraints, and expected outcome" status="active"
TodoCreate workId="W1" taskName="Implement state" taskInfo="Detailed task context and expected result" status="active"
TodoUpdate taskId="T1" status="completed" taskInfo="Implementation is complete; typecheck and build passed."
WorkUpdate workId="W1" status="completed"
```

Run `/works` to inspect full `workInfo` and `taskInfo` in an interactive overlay.

The panel defaults to the floating top-right layout. In fullscreen TUI mode, its title bar has clickable Copy and Minimize/Maximize actions, and you can scroll overflowing rows directly with the mouse wheel. Open `/works` to inspect every row or copy from the keyboard. Use `/works-panel minimize` or `/works-panel maximize` when mouse input is unavailable. Switch layouts with `/works-panel floating`, `/works-panel widget`, or `/works-panel off`.

See [the usage guide](docs/USAGE_GUIDE.md) and [reference](docs/REFERENCE.md).

## Development

```bash
npm run lint
npm run typecheck
npm run build
npm run audit:production
```
