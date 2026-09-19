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

## Data

A work contains `workId`, `workName`, `workInfo`, `status`, `createdAt`, and `updatedAt`. Work status is `planned`, `active`, `blocked`, `completed`, or `cancelled`.

A todo contains `taskId`, `workId`, `taskName`, `taskInfo`, `status`, `createdAt`, and `updatedAt`. Todo status is `pending`, `active`, `blocked`, `completed`, or `cancelled`.

The public list shape assembles each work with `tasks: Todo[]`; tasks are stored separately to avoid duplicate state.

## Tracking behavior

When all tracking tools are active, the extension adds hidden per-turn guidance for every normal request that starts or continues work. Pi finds or creates work, synchronizes todos, marks the current todo active before the attempt, and updates statuses afterward. Tracking is not skipped merely because the request looks small.

The guidance is not added when the tracking tools have been removed from the active tool set. Pi Ask removes them during `/ask`. Pi BTW executes its side conversation outside the main conversation. The guidance also explicitly forbids changing works, todos, loops, or monitors during either mode.

## Interfaces

The compact panel defaults to a non-capturing floating overlay anchored at the top-right. It shows work and todo names, status icons, completion counts, and a visible row range when content exceeds the terminal-aware viewport. It hides on terminals narrower than 90 columns or shorter than 18 rows. Overflow starts at the newest rows and follows newly added tail rows until the user scrolls upward. In fullscreen TUI mode, mouse-wheel events over the panel scroll it directly without taking keyboard focus; regular terminal mode shows the newest rows and uses `/works` for complete browsing. Because Pi treats any persistent overlay as active, the floating mode can block display-mode changes. `/works-panel widget` switches to a right-aligned widget above the editor and renders all rows, while `/works-panel off` hides it.

`/works` opens a top-centered detailed overlay. Its top-right Copy action uses `c` to copy every work and nested todo to the system clipboard as Markdown. Its Minimize action uses `m` to collapse the overlay to a framed top bar containing live total work and todo counts, Copy, and a Maximize action; activating Maximize restores the full dashboard. In fullscreen TUI mode, Copy and Minimize/Maximize also respond to left clicks. Configured selection keys choose records, configured Page Up and Page Down keys scroll long details, the configured confirmation key toggles details, and the configured cancel key closes it.
