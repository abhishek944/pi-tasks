import { StringEnum } from "@earendil-works/pi-ai";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatCompletion, taskCompletion, workCompletion } from "./progress.js";
import { renderTaskCall, renderTaskResult, taskResult } from "./tool-result.js";
const WorkStatusSchema = StringEnum(["planned", "active", "blocked", "completed", "cancelled"]);
const TodoStatusSchema = StringEnum(["pending", "active", "blocked", "completed", "cancelled"]);
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
        description: `Create a session-scoped work item. Use detailed workInfo that preserves the goal, context, scope, constraints, decisions, and expected outcome. ${DETAILS_GUIDANCE}`,
        promptSnippet: "Create a session-scoped work item before starting substantial actionable work",
        promptGuidelines: [
            "Use WorkCreate for normal requests that start new work in the main conversation; never use it during /ask or /btw.",
            "Before creating work, use WorkList to avoid duplicating an existing work item.",
            DETAILS_GUIDANCE,
        ],
        parameters: Type.Object({
            workName: NameSchema,
            workInfo: InfoSchema,
            status: Type.Optional(WorkStatusSchema),
        }, { additionalProperties: false }),
        execute(_id, params) {
            const work = state.createWork(params.workName, params.workInfo, params.status);
            return Promise.resolve(taskResult(`Created work ${work.workId}: ${work.workName} [${work.status}]`, "work-create", { workId: work.workId }));
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
            status: Type.Optional(WorkStatusSchema),
            limit: Type.Optional(Type.Integer({ minimum: 1, description: "Return only the newest N matching works; omit for all." })),
        }, { additionalProperties: false }),
        execute(_id, params) {
            const matches = state.listWorks({ workId: params.workId, status: params.status });
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
        description: `Update a work's name, detailed information, or status. Use before implementation to mark relevant work active and after progress to keep its detailed context current. ${DETAILS_GUIDANCE}`,
        promptSnippet: "Update work status and detailed context as actionable work progresses",
        promptGuidelines: ["Use WorkUpdate and TodoUpdate before and after actionable main-conversation work; never update tracking during /ask or /btw.", DETAILS_GUIDANCE],
        parameters: Type.Object({
            workId: Type.String(),
            workName: Type.Optional(NameSchema),
            workInfo: Type.Optional(InfoSchema),
            status: Type.Optional(WorkStatusSchema),
        }, { additionalProperties: false, minProperties: 2 }),
        execute(_id, params) {
            const work = state.updateWork(params.workId, { workName: params.workName, workInfo: params.workInfo, status: params.status });
            return Promise.resolve(taskResult(`Updated work ${work.workId}: ${work.workName} [${work.status}]`, "work-update", { workId: work.workId }));
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
        description: `Create a todo under an existing work, optionally reporting approximate completionPercent (0 for known unstarted work, null for unknown). taskInfo must contain enough detailed context, scope, constraints, expected outcome, and verification guidance to execute the task without guessing. ${DETAILS_GUIDANCE}`,
        promptSnippet: "Create detailed todos under the current work before implementation",
        promptGuidelines: [
            "Use TodoCreate only under an existing work and only for actionable main-conversation work; never use it during /ask or /btw.",
            "Keep taskInfo detailed, current, and self-contained. Report completionPercent from actual progress; do not infer partial completion just from status.",
            DETAILS_GUIDANCE,
        ],
        parameters: Type.Object({
            workId: Type.String(),
            taskName: NameSchema,
            taskInfo: InfoSchema,
            status: Type.Optional(TodoStatusSchema),
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
            status: Type.Optional(TodoStatusSchema),
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
        description: `Update a todo's name, detailed information, status, or completionPercent. Report approximate progress after meaningful work and explain evidence in taskInfo; blocking retains progress. Reserve completed/100 for verified completion. ${DETAILS_GUIDANCE}`,
        promptSnippet: "Keep todo status and detailed context synchronized with active work",
        promptGuidelines: ["Use TodoUpdate immediately before and after working on a todo in the main conversation; never update tracking during /ask or /btw.", "Update completionPercent after meaningful progress with evidence in taskInfo. Use null to clear an obsolete estimate; only verified completed tasks may reach 100. Work completion is calculated automatically from tasks.", DETAILS_GUIDANCE],
        parameters: Type.Object({
            taskId: Type.String(),
            taskName: Type.Optional(NameSchema),
            taskInfo: Type.Optional(InfoSchema),
            status: Type.Optional(TodoStatusSchema),
            completionPercent: Type.Optional(CompletionSchema),
        }, { additionalProperties: false, minProperties: 2 }),
        execute(_id, params) {
            const todo = state.updateTodo(params.taskId, { taskName: params.taskName, taskInfo: params.taskInfo, status: params.status, completionPercent: params.completionPercent });
            return Promise.resolve(taskResult(`Updated todo ${todo.taskId}: ${todo.taskName} · ${formatCompletion(taskCompletion(todo))} [${todo.status}]`, "todo-update", { taskId: todo.taskId, workId: todo.workId, completionPercent: taskCompletion(todo) }));
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
        `${work.workId} [${work.status}] ${work.workName} · ${formatCompletion(workCompletion(work))}`,
        `Work info:\n${work.workInfo}`,
        work.tasks.length ? `Todos:\n${formatTodos(work.tasks)}` : "Todos: none",
    ].join("\n")).join("\n\n---\n\n");
}
function formatTodos(todos) {
    if (todos.length === 0)
        return "No todos found.";
    return todos.map((todo) => `${todo.taskId} [${todo.status}] ${todo.taskName} · ${formatCompletion(taskCompletion(todo))}\nWork: ${todo.workId}\nTask info:\n${todo.taskInfo}`).join("\n\n");
}
function bounded(text) {
    const result = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
    if (!result.truncated)
        return result.content;
    return `${result.content}\n\n[Output truncated: ${result.outputLines}/${result.totalLines} lines, ${formatSize(result.outputBytes)}/${formatSize(result.totalBytes)}.]`;
}
