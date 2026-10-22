import { StringEnum } from "@earendil-works/pi-ai";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { preservePaneLink } from "./agents/links.js";
import { formatCompletion, taskCompletion, workCompletion } from "./progress.js";
import { formatTime, taskTime, workTime } from "./time.js";
import { renderTaskCall, renderTaskResult, taskResult } from "./tool-result.js";
import { areTrackingToolsActive } from "./tracking.js";
const StatusSchema = StringEnum(["active", "blocked", "completed", "cancelled"]);
const STATUS_GUIDANCE = "New tasks default to active. Use blocked immediately when the next step must wait for agent output, review, an external response, user input, permission, or another obstacle. Record the dependency and resume condition in taskInfo and retain progress. Return blocked tasks to active when the dependency resolves and work resumes. Works are collections and have no status.";
const CompletionSchema = Type.Union([Type.Integer({ minimum: 0, maximum: 100 }), Type.Null()], {
    description: "AI-reported approximate task completion, not elapsed time or a status-to-percentage mapping. Use null for unknown; reserve 100 for verified completed status. Work progress is the equal average of non-cancelled tasks.",
});
const NameSchema = Type.String({ minLength: 1, maxLength: 240 });
const DETAILS_GUIDANCE = "Write workInfo and taskInfo in normal prose with full sentences and spaces between words. Conversational brevity modes must not compress stored records or concatenate words.";
const InfoSchema = Type.String({ minLength: 1, maxLength: 10_000, description: DETAILS_GUIDANCE });
export function registerTaskTools(pi, state) {
    pi.registerTool({
        name: "WorkCreate",
        label: "WorkCreate",
        description: `Create a session-scoped work item. Use detailed workInfo that preserves the goal, context, scope, constraints, decisions, and expected outcome. Works are collections of tasks and have no status. ${DETAILS_GUIDANCE}`,
        promptSnippet: "Create a session-scoped work item before starting substantial actionable work",
        promptGuidelines: [
            "Use WorkCreate for normal requests that start new work in the main conversation; never use it during /ask or /btw.",
            "Before creating work, use WorkList to avoid duplicating an existing work item.",
            DETAILS_GUIDANCE,
        ],
        parameters: Type.Object({
            workName: NameSchema,
            workInfo: InfoSchema,
        }, { additionalProperties: false }),
        execute(_id, params) {
            const work = state.createWork(params.workName, params.workInfo);
            return Promise.resolve(taskResult(`Created work ${work.workId}: ${work.workName}`, "work-create", { workId: work.workId }));
        },
        renderCall: renderTaskCall("WorkCreate"),
        renderResult: renderTaskResult,
    });
    pi.registerTool({
        name: "WorkList",
        label: "WorkList",
        description: "List session-scoped works and their associated todos. Optional limit returns the newest N matching works after filtering, in chronological order; omitted returns all. Results include detailed workInfo and taskInfo and are truncated at 50KB or 2000 lines.",
        parameters: Type.Object({
            workId: Type.Optional(Type.String()),
            limit: Type.Optional(Type.Integer({ minimum: 1, description: "Return only the newest N matching works; omit for all." })),
        }, { additionalProperties: false }),
        execute(_id, params) {
            const matches = state.listWorks({ workId: params.workId });
            const works = params.limit === undefined ? matches : matches.slice(-params.limit);
            const summary = `Showing ${works.length} of ${matches.length} matching works`;
            return Promise.resolve(taskResult(bounded(`${summary}\n\n${formatWorks(works)}`), "work-list", { count: works.length, total: matches.length }, summary));
        },
        renderCall: renderTaskCall("WorkList"),
        renderResult: renderTaskResult,
    });
    pi.registerTool({
        name: "WorkUpdate",
        label: "WorkUpdate",
        description: `Update a work's name or detailed information as its scope or shared context changes. Works are collections of tasks and have no status. ${DETAILS_GUIDANCE}`,
        promptSnippet: "Update work context as its scope or shared decisions change",
        promptGuidelines: ["Use WorkUpdate when shared scope or context changes; keep execution status on tasks with TodoUpdate. Never update tracking during /ask or /btw.", DETAILS_GUIDANCE],
        parameters: Type.Object({
            workId: Type.String(),
            workName: Type.Optional(NameSchema),
            workInfo: Type.Optional(InfoSchema),
        }, { additionalProperties: false, minProperties: 2 }),
        execute(_id, params) {
            const work = state.updateWork(params.workId, { workName: params.workName, workInfo: params.workInfo });
            return Promise.resolve(taskResult(`Updated work ${work.workId}: ${work.workName}`, "work-update", { workId: work.workId }));
        },
        renderCall: renderTaskCall("WorkUpdate"),
        renderResult: renderTaskResult,
    });
    pi.registerTool({
        name: "WorkDelete",
        label: "WorkDelete",
        description: "Delete a work and every associated todo from the current session branch. Use only for explicit cancellation or mistaken entries.",
        parameters: Type.Object({ workId: Type.String() }, { additionalProperties: false }),
        execute(_id, params) {
            const work = state.getWork(params.workId);
            if (!work)
                throw new Error(`Work ${params.workId} not found.`);
            const todoCount = state.listTodos({ workId: params.workId }).length;
            state.deleteWork(params.workId);
            return Promise.resolve(taskResult(`Deleted work ${params.workId} and ${todoCount} associated todo${todoCount === 1 ? "" : "s"}.`, "work-delete"));
        },
        renderCall: renderTaskCall("WorkDelete"),
        renderResult: renderTaskResult,
    });
    pi.registerTool({
        name: "TodoCreate",
        label: "TodoCreate",
        description: `Create a todo under an existing work, optionally reporting approximate completionPercent (0 for known unstarted work, null for unknown). For longer tasks, use TodoUpdate for interim estimates after roughly 5–10 meaningful working steps or a milestone; do not wait until completion. taskInfo must contain enough detailed context, scope, constraints, expected outcome, and verification guidance to execute the task without guessing. ${STATUS_GUIDANCE} ${DETAILS_GUIDANCE}`,
        promptSnippet: "Create detailed todos under the current work before implementation",
        promptGuidelines: [
            "Use TodoCreate only under an existing work and only for actionable main-conversation work; never use it during /ask or /btw.",
            "Keep taskInfo detailed, current, and self-contained. completionPercent is optional; estimate from actual progress, use null when unknown, and do not infer partial completion just from status. For longer tasks, report interim estimates through TodoUpdate after roughly 5–10 meaningful working steps or a milestone.",
            DETAILS_GUIDANCE,
        ],
        parameters: Type.Object({
            workId: Type.String(),
            taskName: NameSchema,
            taskInfo: InfoSchema,
            status: Type.Optional(StatusSchema),
            completionPercent: Type.Optional(CompletionSchema),
        }, { additionalProperties: false }),
        execute(_id, params) {
            const todo = state.createTodo(params.workId, params.taskName, params.taskInfo, params.status, params.completionPercent);
            return Promise.resolve(taskResult(`Created todo ${todo.taskId} under ${todo.workId}: ${todo.taskName} · ${formatCompletion(taskCompletion(todo))} [${todo.status}]`, "todo-create", { taskId: todo.taskId, workId: todo.workId, completionPercent: taskCompletion(todo) }));
        },
        renderCall: renderTaskCall("TodoCreate"),
        renderResult: renderTaskResult,
    });
    pi.registerTool({
        name: "TodoList",
        label: "TodoList",
        description: "List todos by task, work, or status. Optional limit returns the newest N matching todos after filtering, in chronological order; omitted returns all. Results include detailed taskInfo and are truncated at 50KB or 2000 lines.",
        parameters: Type.Object({
            taskId: Type.Optional(Type.String()),
            workId: Type.Optional(Type.String()),
            status: Type.Optional(StatusSchema),
            limit: Type.Optional(Type.Integer({ minimum: 1, description: "Return only the newest N matching todos; omit for all." })),
        }, { additionalProperties: false }),
        execute(_id, params) {
            const matches = state.listTodos({ taskId: params.taskId, workId: params.workId, status: params.status });
            const todos = params.limit === undefined ? matches : matches.slice(-params.limit);
            const summary = `Showing ${todos.length} of ${matches.length} matching todos`;
            return Promise.resolve(taskResult(bounded(`${summary}\n\n${formatTodos(todos)}`), "todo-list", { count: todos.length, total: matches.length }, summary));
        },
        renderCall: renderTaskCall("TodoList"),
        renderResult: renderTaskResult,
    });
    pi.registerTool({
        name: "TodoUpdate",
        label: "TodoUpdate",
        description: `Update a todo's name, detailed information, status, completionPercent, or working selection. Set working=true immediately before working on an active owner: self task; it pauses any previously selected task. Set working=false to pause without changing status. Timing is calculated automatically, never estimated. Re-select with working=true on each fresh run. Delegated agents time their own local tasks; never select a parent delegate task. For longer tasks, include an optional completionPercent estimate after roughly 5–10 meaningful working steps or a milestone, not just at completion or in status-only updates. Explain evidence and remaining work in taskInfo; use null when unknown and never increase a percentage without evidence. Blocking retains progress. Reserve completed/100 for verified completion. ${STATUS_GUIDANCE} ${DETAILS_GUIDANCE}`,
        promptSnippet: "Keep todo status and detailed context synchronized with active work",
        promptGuidelines: ["Use TodoUpdate with working=true immediately before working on an active owner: self task, including when resuming on a fresh run. Use working=false when pausing without a status change. Only one local task is timed; runtime idle and user waits pause automatically. Never update tracking during /ask or /btw.", "During longer tasks, include an evidence-based completionPercent estimate after roughly 5–10 meaningful working steps or a milestone; do not wait until completion or only update status. Estimates remain optional: use null when unknown, and leave a percentage unchanged if there is no new evidence. Explain evidence and remaining work in taskInfo; only verified completed tasks may reach 100. Work completion is calculated automatically from tasks.", DETAILS_GUIDANCE],
        parameters: Type.Object({
            taskId: Type.String(),
            taskName: Type.Optional(NameSchema),
            taskInfo: Type.Optional(InfoSchema),
            status: Type.Optional(StatusSchema),
            completionPercent: Type.Optional(CompletionSchema),
            working: Type.Optional(Type.Boolean({ description: "Select this active owner: self task for automatic timing, or pause it. Selection switches away from the previously timed task. No timestamps or duration estimates are accepted." })),
        }, { additionalProperties: false, minProperties: 2 }),
        execute(_id, params) {
            if (params.working !== undefined && !areTrackingToolsActive(pi))
                throw new Error("Task timing is available only in tracked main-conversation work, not /ask or /btw.");
            const taskInfo = params.taskInfo === undefined ? undefined : preservePaneLink(state.getTodo(params.taskId)?.taskInfo ?? "", params.taskInfo);
            const todo = state.updateTodo(params.taskId, { taskName: params.taskName, taskInfo, status: params.status, completionPercent: params.completionPercent, working: params.working });
            return Promise.resolve(taskResult(`Updated todo ${todo.taskId}: ${todo.taskName} · ${formatCompletion(taskCompletion(todo))} · ${formatTime(taskTime(todo))}${todo.workingSince === undefined ? "" : " running"} [${todo.status}]`, "todo-update", { taskId: todo.taskId, workId: todo.workId, completionPercent: taskCompletion(todo), elapsedMs: taskTime(todo), working: todo.workingSince !== undefined }));
        },
        renderCall: renderTaskCall("TodoUpdate"),
        renderResult: renderTaskResult,
    });
    pi.registerTool({
        name: "TodoDelete",
        label: "TodoDelete",
        description: "Delete a todo from its work. Use only for explicit cancellation, scope removal, or mistaken entries.",
        parameters: Type.Object({ taskId: Type.String() }, { additionalProperties: false }),
        execute(_id, params) {
            const todo = state.getTodo(params.taskId);
            if (!todo)
                throw new Error(`Todo ${params.taskId} not found.`);
            state.deleteTodo(params.taskId);
            return Promise.resolve(taskResult(`Deleted todo ${params.taskId}: ${todo.taskName}`, "todo-delete"));
        },
        renderCall: renderTaskCall("TodoDelete"),
        renderResult: renderTaskResult,
    });
}
function formatWorks(works) {
    if (works.length === 0)
        return "No works found in this session.";
    return works.map((work) => [
        `${work.workId} ${work.workName} · ${formatCompletion(workCompletion(work))} · Time: ${formatTime(workTime(work))}`,
        `Work info:\n${work.workInfo}`,
        work.tasks.length ? `Todos:\n${formatTodos(work.tasks)}` : "Todos: none",
    ].join("\n")).join("\n\n---\n\n");
}
function formatTodos(todos) {
    if (todos.length === 0)
        return "No todos found.";
    return todos.map((todo) => `${todo.taskId} [${todo.status}] ${todo.taskName} · ${formatCompletion(taskCompletion(todo))} · Time: ${formatTime(taskTime(todo))}${todo.workingSince === undefined ? "" : " (running)"}\nWork: ${todo.workId}\nTask info:\n${todo.taskInfo}`).join("\n\n");
}
function bounded(text) {
    const result = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
    if (!result.truncated)
        return result.content;
    return `${result.content}\n\n[Output truncated: ${result.outputLines}/${result.totalLines} lines, ${formatSize(result.outputBytes)}/${formatSize(result.totalBytes)}.]`;
}
