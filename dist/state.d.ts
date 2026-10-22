import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Todo, TodoStatus, Work, WorkWithTodos } from "./types.js";
export declare const TASK_ENTRY_TYPE = "pi-tasks-state";
export declare const MAX_WORKS = 100;
export declare const MAX_TODOS = 500;
export declare class TaskState {
    private readonly pi;
    private readonly onChange;
    private works;
    private todos;
    private nextWorkId;
    private nextTaskId;
    constructor(pi: ExtensionAPI, onChange: () => void);
    restore(ctx: ExtensionContext): void;
    listWorks(filter?: {
        workId?: string;
    }): WorkWithTodos[];
    listTodos(filter?: {
        taskId?: string;
        workId?: string;
        status?: TodoStatus;
    }): Todo[];
    getWork(workId: string): Work | undefined;
    getTodo(taskId: string): Todo | undefined;
    createWork(workName: string, workInfo: string): Work;
    updateWork(workId: string, patch: Partial<Pick<Work, "workName" | "workInfo">>): Work;
    deleteWork(workId: string): boolean;
    createTodo(workId: string, taskName: string, taskInfo: string, status?: TodoStatus, completionPercent?: number | null): Todo;
    updateTodo(taskId: string, patch: Partial<Pick<Todo, "taskName" | "taskInfo" | "status" | "completionPercent">>): Todo;
    deleteTodo(taskId: string): boolean;
    private record;
    private apply;
}
