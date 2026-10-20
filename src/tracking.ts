import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const REQUIRED_TRACKING_TOOLS = ["WorkCreate", "WorkList", "WorkUpdate", "TodoCreate", "TodoList", "TodoUpdate"];
const TRACKING_GUIDANCE = `[SESSION COORDINATION]
Work is the overall outcome being pursued. A todo is a concrete step that belongs to a work. A monitor runs one long-lived background command. A loop schedules a future, recurring, event-driven, or idle continuation.

For every normal user request that starts or continues work, keep the session's work and todo records synchronized. Do not skip tracking because the work looks small.
Write workInfo and taskInfo in normal prose with full sentences and spaces between words. Conversational brevity modes must not compress stored records or concatenate words.

Every delegated subagent, at every delegation depth, must use these tools to create or resume its own session-local Work and Todos before assigned work. Do not begin assigned work without a real workId and an active taskId for the current step. Keep these records current and return the IDs with results, checks, and blockers. Parent assignment IDs are context, not shared records: IDs are session-scoped. Record the parent assignment in the worker's details; do not mutate the parent's session records. Include this requirement in every subagent prompt. If tracking tools or IDs are unavailable, report the blocker and do not begin delegated work; a parent-owned Todo or Markdown checklist is not a substitute. Do not invent IDs or backdate tracking. This is an instruction, not a runtime enforcement hook, and does not change the /ask or /btw exceptions.

Shared workflow contract:
- Every tracked Work, including each subagent's local Work, follows the global implement skill for coordination. Read it before execution, or reuse it if already active; do not recursively invoke it. Specialized skills retain their scope and safety limits: research/review stay read-only and planning does not authorize implementation. If the skill is unavailable, report the blocker rather than executing without it.
- Before execution, read the full current sessionId through the agent's own shell tool using printf '%s\\n' "$PI_SESSION_ID". Require a nonempty safe component matching [A-Za-z0-9][A-Za-z0-9_-]* and real tool-returned Work/Task IDs. Missing tools, identity, or IDs block execution; never substitute the parent's identity or invent IDs. Reading instructions, obtaining identity, and establishing tracking are startup steps.
- Root task artifacts use repository-relative var/<sessionId>/<workId>/<taskId>/, not system /var/. A delegated worker appends its own <childSessionId>/<childWorkId>/<childTaskId>/ beneath the exact parentTaskDir supplied in its assignment, recursively. Keep resolved paths inside the repository's var/, including through symlinks. Record canonical paths and parent IDs in taskInfo, pass them unchanged in handoffs, and return them with results. Validate ownership before reuse after resume or branch navigation; do not overwrite artifacts just because numeric IDs match. Create artifacts only when useful; feature names are descriptions, not path keys. Do not migrate existing artifacts implicitly. Follow implement for the detailed contract and report incompatible helper paths rather than inventing arguments.
- For every task, start taskInfo with owner: self or owner: delegate followed by a short reason before execution. Preserve this explicit declaration when updating taskInfo; the panel reads this line to show the ownership badge, with unassigned for missing or conflicting decisions. Delegate only when scope/acceptance criteria are clear, ownership can be isolated, inputs and prerequisites are ready, and useful parallelism or expertise outweighs startup and integration costs. Respect skill-specific delegation restrictions and required tracking/monitor tools. Keep small, tightly coupled, shared-interface, or expensive-to-explain work with one owner. Delegating agents retain responsibility for monitoring, integration, verification, and cleanup; children apply the same rule when allowed to delegate. No arbitrary worker, file-count, or depth thresholds.
- Herdr subagent root panes are named exactly with the parent's delegated Task ID, such as T34, with no brackets, descriptions, Work IDs, or other prefixes. This is a display label, not the child's session or local Task ID. Use returned resource IDs for lifecycle operations because pane names can repeat across sessions; rename an owned worker pane when assigning it a different parent Todo.
- Pi-tasks owns records and progress, implement owns coordination and artifact paths, and herdr owns delegated-agent lifecycle. These are instructions, not automatic path creation, cross-session shared records, or runtime enforcement hooks. Plain conversation, /ask, and /btw remain outside this workflow.

Before implementation, investigation, or any other requested work:
1. Use WorkList and TodoList to find the relevant existing records and avoid duplicates.
2. If no suitable work exists, create one with WorkCreate. Otherwise use WorkUpdate to refresh its detailed workInfo and mark it active.
3. Create or update the work's todos so they match the requested scope. New works and todos default to active; the only statuses are active, blocked, completed, and cancelled. Keep taskInfo detailed and self-contained.
4. Mark the todo being attempted active with TodoUpdate before doing that work.
5. completionPercent on TodoCreate/TodoUpdate is optional. When estimating, use an approximate integer from 0 to 100 based on actual work and verification, not elapsed time or a fixed mapping from status. Use 0 for genuinely unstarted tasks and null when unknown. Never invent progress to make a work look further along.

During and after the attempt:
- When available, use MonitorCreate only when a command should continue in the background; inspect it with MonitorList and do not poll it with shell sleep loops.
- When available, use LoopCreate only when work needs a future or repeated wake. Do not create a loop for ordinary synchronous work.
- A loop or monitor does not replace work and todo status. Mark a task blocked immediately when its next step must wait for another agent’s output, review, an external response, user input, permission, or another obstacle. Record which dependency it awaits and what will unblock it in taskInfo; preserve its progress. Work actually executing in another agent may remain active, but dependent tasks awaiting that output are blocked. When the dependency resolves and work resumes, mark the affected records active and update their context.
- During longer tasks, include an evidence-based completionPercent estimate in TodoUpdate after roughly 5–10 meaningful working steps or a milestone. Do not wait until completion or only update status when an estimate is possible. Explain the evidence and remaining work in taskInfo. Estimates remain optional: use null when unknown, and leave a percentage unchanged if there is no new evidence. Keep estimates current, including after scope changes. Work completion is derived as the equal average of non-cancelled task percentages; any unknown child makes it unknown. Do not set an independent work percentage.
- Mark the todo completed, blocked, or cancelled as appropriate and update taskInfo with important current context. Only use completed/100 after verification. Blocking retains the last percentage; it does not erase completed effort. Reopening a completed task needs a fresh estimate (otherwise it becomes unknown).
- Percentages are approximate completion, not ETA or proof. Never mark a parent complete to conceal unfinished tasks, and never change statuses merely because a percentage looks complete.
- Keep the work active only while some required work can proceed. If all remaining required work must wait on dependencies, mark the parent work blocked too and record the reason and resume condition in workInfo. Complete the work only when its required todos are complete.
- Never create or update works, todos, loops, or monitors during /ask, /btw, or any BTW side thread.`;

export function areTrackingToolsActive(pi: ExtensionAPI): boolean {
  const active = new Set(pi.getActiveTools());
  return REQUIRED_TRACKING_TOOLS.every((name) => active.has(name));
}

export function registerTrackingGuidance(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    if (!areTrackingToolsActive(pi)) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${TRACKING_GUIDANCE}` };
  });
}
