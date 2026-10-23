export type TodoStatus = "active" | "blocked" | "completed" | "cancelled";
export interface Work {
    workId: string;
    workName: string;
    workInfo: string;
    createdAt: number;
    updatedAt: number;
}
/** One assignment's cumulative imported effort; absent measurement stays unknown. */
export interface DelegatedTime {
    reportPath: string;
    elapsedMs: number | null;
    workerSessionId?: string;
}
export interface Todo {
    taskId: string;
    workId: string;
    taskName: string;
    taskInfo: string;
    status: TodoStatus;
    /** Current obstacle and resume condition; cleared when leaving blocked. */
    blockedReason?: string | null;
    completionPercent?: number | null;
    /** Accumulated measured time; missing/null means historical time is unknown. */
    elapsedMs?: number | null;
    delegatedTimes?: DelegatedTime[];
    /** Current interval start, exposed only in live snapshots, never restored. */
    workingSince?: number;
    createdAt: number;
    updatedAt: number;
}
export interface WorkWithTodos extends Work {
    tasks: Todo[];
}
export type TaskEvent = {
    version: 1;
    type: "work-created";
    at: number;
    work: Work;
} | {
    version: 1;
    type: "work-updated";
    at: number;
    workId: string;
    patch: Partial<Pick<Work, "workName" | "workInfo">>;
} | {
    version: 1;
    type: "work-deleted";
    at: number;
    workId: string;
} | {
    version: 1;
    type: "todo-created";
    at: number;
    todo: Todo;
} | {
    version: 1;
    type: "todo-updated";
    at: number;
    taskId: string;
    patch: Partial<Pick<Todo, "taskName" | "taskInfo" | "status" | "blockedReason" | "completionPercent">>;
} | {
    version: 1;
    type: "todo-time";
    at: number;
    taskId: string;
    elapsedMs: number;
} | {
    version: 1;
    type: "todo-delegated-time";
    at: number;
    taskId: string;
    source: DelegatedTime;
} | {
    version: 1;
    type: "todo-deleted";
    at: number;
    taskId: string;
};
