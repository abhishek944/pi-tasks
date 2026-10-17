const REQUIRED_TRACKING_TOOLS = ["WorkCreate", "WorkList", "WorkUpdate", "TodoCreate", "TodoList", "TodoUpdate"];
const TRACKING_GUIDANCE = `[SESSION COORDINATION]
Work is the overall outcome being pursued. A todo is a concrete step that belongs to a work. A monitor runs one long-lived background command. A loop schedules a future, recurring, event-driven, or idle continuation.

For every normal user request that starts or continues work, keep the session's work and todo records synchronized. Do not skip tracking because the work looks small.
Write workInfo and taskInfo in normal prose with full sentences and spaces between words. Conversational brevity modes must not compress stored records or concatenate words.

Before implementation, investigation, or any other requested work:
1. Use WorkList and TodoList to find the relevant existing records and avoid duplicates.
2. If no suitable work exists, create one with WorkCreate. Otherwise use WorkUpdate to refresh its detailed workInfo and mark it active.
3. Create or update the work's todos so they match the requested scope. Keep taskInfo detailed and self-contained.
4. Mark the todo being attempted active with TodoUpdate before doing that work.
5. Report completionPercent on TodoCreate/TodoUpdate as an approximate integer from 0 to 100 based on actual work and verification, not elapsed time or a fixed mapping from status. Explicitly use 0 for genuinely unstarted tasks; use null when unknown. Never invent progress to make a work look further along.

During and after the attempt:
- When available, use MonitorCreate only when a command should continue in the background; inspect it with MonitorList and do not poll it with shell sleep loops.
- When available, use LoopCreate only when work needs a future or repeated wake. Do not create a loop for ordinary synchronous work.
- A loop or monitor does not replace work and todo status. Update the related todo when its result is known.
- After meaningful progress, update the task completionPercent and explain the evidence and remaining work in taskInfo. Keep estimates current, including after scope changes. Work completion is derived as the equal average of non-cancelled task percentages; any unknown child makes it unknown. Do not set an independent work percentage.
- Mark the todo completed, blocked, or cancelled as appropriate and update taskInfo with important current context. Only use completed/100 after verification. Blocking retains the last percentage; it does not erase completed effort. Reopening a completed task needs a fresh estimate (otherwise it becomes unknown).
- Percentages are approximate completion, not ETA or proof. Never mark a parent complete to conceal unfinished tasks, and never change statuses merely because a percentage looks complete.
- Keep the work active while required todos remain, blocked when progress cannot continue, and completed only when its required todos are complete.
- Never create or update works, todos, loops, or monitors during /ask, /btw, or any BTW side thread.`;
export function areTrackingToolsActive(pi) {
    const active = new Set(pi.getActiveTools());
    return REQUIRED_TRACKING_TOOLS.every((name) => active.has(name));
}
export function registerTrackingGuidance(pi) {
    pi.on("before_agent_start", (event) => {
        if (!areTrackingToolsActive(pi))
            return;
        return { systemPrompt: `${event.systemPrompt}\n\n${TRACKING_GUIDANCE}` };
    });
}
