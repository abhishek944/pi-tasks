import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const REQUIRED_TRACKING_TOOLS = ["WorkCreate", "WorkList", "WorkUpdate", "TodoCreate", "TodoList", "TodoUpdate"];
const TRACKING_GUIDANCE = `[SESSION COORDINATION]
Work is the overall outcome being pursued. A todo is a concrete step that belongs to a work. A monitor runs one long-lived background command. A loop schedules a future, recurring, event-driven, or idle continuation.

For every normal user request that starts or continues work, keep the session's work and todo records synchronized. Do not skip tracking because the work looks small.

Before implementation, investigation, or any other requested work:
1. Use WorkList and TodoList to find the relevant existing records and avoid duplicates.
2. If no suitable work exists, create one with WorkCreate. Otherwise use WorkUpdate to refresh its detailed workInfo and mark it active.
3. Create or update the work's todos so they match the requested scope. Keep taskInfo detailed and self-contained.
4. Mark the todo being attempted active with TodoUpdate before doing that work.

During and after the attempt:
- When available, use MonitorCreate only when a command should continue in the background; inspect it with MonitorList and do not poll it with shell sleep loops.
- When available, use LoopCreate only when work needs a future or repeated wake. Do not create a loop for ordinary synchronous work.
- A loop or monitor does not replace work and todo status. Update the related todo when its result is known.
- Mark the todo completed, blocked, or cancelled as appropriate and update taskInfo with important current context.
- Keep the work active while required todos remain, blocked when progress cannot continue, and completed only when its required todos are complete.
- Never create or update works, todos, loops, or monitors during /ask, /btw, or any BTW side thread.`;

export function registerTrackingGuidance(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    const active = new Set(pi.getActiveTools());
    if (!REQUIRED_TRACKING_TOOLS.every((name) => active.has(name))) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${TRACKING_GUIDANCE}` };
  });
}
