import { StringEnum } from "@earendil-works/pi-ai";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { renderTaskCall, renderTaskResult, taskResult } from "./tool-result.js";
const WorkStatusSchema = StringEnum(["planned", "active", "blocked", "completed", "cancelled"]);
const TodoStatusSchema = StringEnum(["pending", "active", "blocked", "completed", "cancelled"]);
const NameSchema = Type.String({ minLength: 1, maxLength: 240 });
const InfoSchema = Type.String({ minLength: 1, maxLength: 10_000 });
export function registerTaskTools(pi, state) {
    pi.registerTool({
        name: "WorkCreate",
        label: "WorkCreate",
        description: "Create a session-scoped work item. Use detailed workInfo that preserves the goal, context, scope, constraints, decisions, and expected outcome.",
        promptSnippet: "Create a session-scoped work item before starting substantial actionable work",
        promptGuidelines: [
            "Use WorkCreate for normal requests that start new work in the main conversation; never use it during /ask or /btw.",
            "Before creating work, use WorkList to avoid duplicating an existing work item.",
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
        description: "List session-scoped works and their associated todos. Results include detailed workInfo and taskInfo and are truncated at 50KB or 2000 lines.",
        parameters: Type.Object({
            workId: Type.Optional(Type.String()),
            status: Type.Optional(WorkStatusSchema),
        }, { additionalProperties: false }),
        execute(_id, params) {
            const works = state.listWorks({ workId: params.workId, status: params.status });
            return Promise.resolve(taskResult(bounded(formatWorks(works)), "work-list", { count: works.length }, `${works.length} work${works.length === 1 ? "" : "s"} found`));
        },
        renderCall: renderTaskCall("WorkList"),
        renderResult: renderTaskResult,
    });
    pi.registerTool({
        name: "WorkUpdate",
        label: "WorkUpdate",
        description: "Update a work's name, detailed information, or status. Use before implementation to mark relevant work active and after progress to keep its detailed context current.",
        promptSnippet: "Update work status and detailed context as actionable work progresses",
        promptGuidelines: ["Use WorkUpdate and TodoUpdate before and after actionable main-conversation work; never update tracking during /ask or /btw."],
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
        description: "Create a todo under an existing work. taskInfo must contain enough detailed context, scope, constraints, expected outcome, and verification guidance to execute the task without guessing.",
        promptSnippet: "Create detailed todos under the current work before implementation",
        promptGuidelines: [
            "Use TodoCreate only under an existing work and only for actionable main-conversation work; never use it during /ask or /btw.",
            "Keep taskInfo detailed, current, and self-contained.",
        ],
        parameters: Type.Object({
            workId: Type.String(),
            taskName: NameSchema,
            taskInfo: InfoSchema,
            status: Type.Optional(TodoStatusSchema),
        }, { additionalProperties: false }),
        execute(_id, params) {
            const todo = state.createTodo(params.workId, params.taskName, params.taskInfo, params.status);
            return Promise.resolve(taskResult(`Created todo ${todo.taskId} under ${todo.workId}: ${todo.taskName} [${todo.status}]`, "todo-create", { taskId: todo.taskId, workId: todo.workId }));
        },
        renderCall: renderTaskCall("TodoCreate"),
        renderResult: renderTaskResult,
    });
    pi.registerTool({
        name: "TodoList",
        label: "TodoList",
        description: "List todos by task, work, or status. Results include detailed taskInfo and are truncated at 50KB or 2000 lines.",
        parameters: Type.Object({
            taskId: Type.Optional(Type.String()),
            workId: Type.Optional(Type.String()),
            status: Type.Optional(TodoStatusSchema),
        }, { additionalProperties: false }),
        execute(_id, params) {
            const todos = state.listTodos({ taskId: params.taskId, workId: params.workId, status: params.status });
            return Promise.resolve(taskResult(bounded(formatTodos(todos)), "todo-list", { count: todos.length }, `${todos.length} todo${todos.length === 1 ? "" : "s"} found`));
        },
        renderCall: renderTaskCall("TodoList"),
        renderResult: renderTaskResult,
    });
    pi.registerTool({
        name: "TodoUpdate",
        label: "TodoUpdate",
        description: "Update a todo's name, detailed information, or status. Mark a todo active immediately before starting it and completed or blocked after the attempt.",
        promptSnippet: "Keep todo status and detailed context synchronized with active work",
        promptGuidelines: ["Use TodoUpdate immediately before and after working on a todo in the main conversation; never update tracking during /ask or /btw."],
        parameters: Type.Object({
            taskId: Type.String(),
            taskName: Type.Optional(NameSchema),
            taskInfo: Type.Optional(InfoSchema),
            status: Type.Optional(TodoStatusSchema),
        }, { additionalProperties: false, minProperties: 2 }),
        execute(_id, params) {
            const todo = state.updateTodo(params.taskId, { taskName: params.taskName, taskInfo: params.taskInfo, status: params.status });
            return Promise.resolve(taskResult(`Updated todo ${todo.taskId}: ${todo.taskName} [${todo.status}]`, "todo-update", { taskId: todo.taskId, workId: todo.workId }));
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
        `${work.workId} [${work.status}] ${work.workName}`,
        `Work info:\n${work.workInfo}`,
        work.tasks.length ? `Todos:\n${formatTodos(work.tasks)}` : "Todos: none",
    ].join("\n")).join("\n\n---\n\n");
}
function formatTodos(todos) {
    if (todos.length === 0)
        return "No todos found.";
    return todos.map((todo) => `${todo.taskId} [${todo.status}] ${todo.taskName}\nWork: ${todo.workId}\nTask info:\n${todo.taskInfo}`).join("\n\n");
}
function bounded(text) {
    const result = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
    if (!result.truncated)
        return result.content;
    return `${result.content}\n\n[Output truncated: ${result.outputLines}/${result.totalLines} lines, ${formatSize(result.outputBytes)}/${formatSize(result.totalBytes)}.]`;
}
