import { taskCompletion } from "./progress.js";
import { safeSingleLine } from "./text.js";
export const TASK_ENTRY_TYPE = "pi-tasks-state";
export const MAX_WORKS = 100;
export const MAX_TODOS = 500;
export class TaskState {
    pi;
    onChange;
    works = new Map();
    todos = new Map();
    nextWorkId = 1;
    nextTaskId = 1;
    constructor(pi, onChange) {
        this.pi = pi;
        this.onChange = onChange;
    }
    restore(ctx) {
        this.works.clear();
        this.todos.clear();
        this.nextWorkId = 1;
        this.nextTaskId = 1;
        for (const entry of ctx.sessionManager.getBranch()) {
            if (entry.type !== "custom" || entry.customType !== TASK_ENTRY_TYPE)
                continue;
            const event = parseEvent(entry.data);
            if (!event)
                continue;
            try {
                this.apply(event);
            }
            catch { /* Ignore malformed extension entries and continue replay. */ }
        }
        this.onChange();
    }
    listWorks(filter) {
        return [...this.works.values()]
            .filter((work) => !filter?.workId || work.workId === filter.workId)
            .filter((work) => !filter?.status || work.status === filter.status)
            .sort((left, right) => left.createdAt - right.createdAt)
            .map((work) => ({ ...work, tasks: this.listTodos({ workId: work.workId }) }));
    }
    listTodos(filter) {
        return [...this.todos.values()]
            .filter((todo) => !filter?.taskId || todo.taskId === filter.taskId)
            .filter((todo) => !filter?.workId || todo.workId === filter.workId)
            .filter((todo) => !filter?.status || todo.status === filter.status)
            .sort((left, right) => left.createdAt - right.createdAt)
            .map((todo) => ({ ...todo }));
    }
    getWork(workId) {
        const work = this.works.get(workId);
        return work ? { ...work } : undefined;
    }
    getTodo(taskId) {
        const todo = this.todos.get(taskId);
        return todo ? { ...todo } : undefined;
    }
    createWork(workName, workInfo, status = "active") {
        if (this.works.size >= MAX_WORKS)
            throw new Error(`Maximum of ${MAX_WORKS} works reached.`);
        const now = Date.now();
        const work = {
            workId: `W${this.nextWorkId}`,
            workName: requiredName(workName, "workName"),
            workInfo: requiredText(workInfo, "workInfo"),
            status,
            createdAt: now,
            updatedAt: now,
        };
        this.record({ version: 1, type: "work-created", at: now, work });
        return { ...work };
    }
    updateWork(workId, patch) {
        if (!this.works.has(workId))
            throw new Error(`Work ${workId} not found.`);
        const normalized = compactPatch({
            workName: patch.workName === undefined ? undefined : requiredName(patch.workName, "workName"),
            workInfo: patch.workInfo === undefined ? undefined : requiredText(patch.workInfo, "workInfo"),
            status: patch.status,
        });
        if (Object.keys(normalized).length === 0)
            throw new Error("WorkUpdate requires at least one changed field.");
        this.record({ version: 1, type: "work-updated", at: Date.now(), workId, patch: normalized });
        return this.getWork(workId);
    }
    deleteWork(workId) {
        if (!this.works.has(workId))
            return false;
        this.record({ version: 1, type: "work-deleted", at: Date.now(), workId });
        return true;
    }
    createTodo(workId, taskName, taskInfo, status = "active", completionPercent) {
        if (!this.works.has(workId))
            throw new Error(`Work ${workId} not found.`);
        if (this.todos.size >= MAX_TODOS)
            throw new Error(`Maximum of ${MAX_TODOS} todos reached.`);
        validateCompletion(status, completionPercent);
        const now = Date.now();
        const todo = {
            taskId: `T${this.nextTaskId}`,
            workId,
            taskName: requiredName(taskName, "taskName"),
            taskInfo: requiredText(taskInfo, "taskInfo"),
            status,
            completionPercent: status === "completed" ? 100 : completionPercent ?? null,
            createdAt: now,
            updatedAt: now,
        };
        this.record({ version: 1, type: "todo-created", at: now, todo });
        return { ...todo };
    }
    updateTodo(taskId, patch) {
        const current = this.todos.get(taskId);
        if (!current)
            throw new Error(`Todo ${taskId} not found.`);
        validateCompletion(patch.status ?? current.status, patch.completionPercent);
        const normalized = compactPatch({
            taskName: patch.taskName === undefined ? undefined : requiredName(patch.taskName, "taskName"),
            taskInfo: patch.taskInfo === undefined ? undefined : requiredText(patch.taskInfo, "taskInfo"),
            status: patch.status,
            completionPercent: patch.completionPercent,
        });
        if (Object.keys(normalized).length === 0)
            throw new Error("TodoUpdate requires at least one changed field.");
        this.record({ version: 1, type: "todo-updated", at: Date.now(), taskId, patch: normalized });
        return this.getTodo(taskId);
    }
    deleteTodo(taskId) {
        if (!this.todos.has(taskId))
            return false;
        this.record({ version: 1, type: "todo-deleted", at: Date.now(), taskId });
        return true;
    }
    record(event) {
        this.pi.appendEntry(TASK_ENTRY_TYPE, event);
        this.apply(event);
        this.onChange();
    }
    apply(event) {
        switch (event.type) {
            case "work-created": {
                const status = restoredStatus(event.work.status);
                assertId(event.work.workId, "W");
                if (typeof event.work.workName !== "string" || typeof event.work.workInfo !== "string" || !status)
                    throw new Error("Malformed work entry.");
                this.works.set(event.work.workId, { ...event.work, status, workName: safeSingleLine(event.work.workName) });
                this.nextWorkId = Math.max(this.nextWorkId, numericId(event.work.workId) + 1);
                break;
            }
            case "work-updated": {
                const status = restoredStatus(event.patch.status);
                const work = this.works.get(event.workId);
                if (work)
                    this.works.set(event.workId, {
                        ...work,
                        ...(typeof event.patch.workName === "string" ? { workName: safeSingleLine(event.patch.workName) } : {}),
                        ...(typeof event.patch.workInfo === "string" ? { workInfo: event.patch.workInfo } : {}),
                        ...(status ? { status } : {}),
                        updatedAt: event.at,
                    });
                break;
            }
            case "work-deleted":
                this.works.delete(event.workId);
                for (const [taskId, todo] of this.todos)
                    if (todo.workId === event.workId)
                        this.todos.delete(taskId);
                break;
            case "todo-created": {
                const status = restoredStatus(event.todo.status);
                assertId(event.todo.taskId, "T");
                if (typeof event.todo.workId !== "string" || typeof event.todo.taskName !== "string" || typeof event.todo.taskInfo !== "string" || !status)
                    throw new Error("Malformed todo entry.");
                if (this.works.has(event.todo.workId))
                    this.todos.set(event.todo.taskId, {
                        ...event.todo,
                        status,
                        taskName: safeSingleLine(event.todo.taskName),
                        completionPercent: taskCompletion(event.todo),
                    });
                this.nextTaskId = Math.max(this.nextTaskId, numericId(event.todo.taskId) + 1);
                break;
            }
            case "todo-updated": {
                const status = restoredStatus(event.patch.status);
                const todo = this.todos.get(event.taskId);
                if (todo) {
                    const updated = {
                        ...todo,
                        ...(typeof event.patch.taskName === "string" ? { taskName: safeSingleLine(event.patch.taskName) } : {}),
                        ...(typeof event.patch.taskInfo === "string" ? { taskInfo: event.patch.taskInfo } : {}),
                        ...(status ? { status } : {}),
                        ...(event.patch.completionPercent !== undefined ? { completionPercent: event.patch.completionPercent } : {}),
                        updatedAt: event.at,
                    };
                    this.todos.set(event.taskId, { ...updated, completionPercent: taskCompletion(updated) });
                }
                break;
            }
            case "todo-deleted":
                this.todos.delete(event.taskId);
                break;
        }
    }
}
function validateCompletion(status, value) {
    if (value === undefined || value === null)
        return;
    if (!Number.isInteger(value) || value < 0 || value > 100)
        throw new Error("completionPercent must be an integer from 0 to 100, or null for unknown.");
    if (value === 100 && status !== "completed")
        throw new Error("100% requires verified completion. Set status to completed after verification.");
    if (status === "completed" && value !== 100)
        throw new Error("Completed tasks have 100% progress. Reopen the task before reporting partial progress.");
}
function requiredText(value, field) {
    const text = value.trim();
    if (!text)
        throw new Error(`${field} must not be empty.`);
    return text;
}
function requiredName(value, field) {
    const text = safeSingleLine(value);
    if (!text)
        throw new Error(`${field} must not be empty.`);
    return text;
}
function compactPatch(patch) {
    return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
}
function numericId(id) {
    const value = Number.parseInt(id.slice(1), 10);
    return Number.isSafeInteger(value) ? value : 0;
}
function assertId(id, prefix) {
    if (typeof id !== "string" || !new RegExp(`^${prefix}[1-9]\\d*$`).test(id) || !Number.isSafeInteger(Number(id.slice(1)))) {
        throw new Error(`Malformed ${prefix === "W" ? "work" : "todo"} ID.`);
    }
}
function restoredStatus(value) {
    // Keep legacy branch events readable without exposing retired statuses in tools.
    if (value === "planned" || value === "pending")
        return "active";
    if (value === "active" || value === "blocked" || value === "completed" || value === "cancelled")
        return value;
    return undefined;
}
function parseEvent(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const candidate = value;
    if (candidate.version !== 1 || typeof candidate.type !== "string")
        return undefined;
    if (!["work-created", "work-updated", "work-deleted", "todo-created", "todo-updated", "todo-deleted"].includes(candidate.type))
        return undefined;
    return value;
}
