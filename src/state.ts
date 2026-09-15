import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { safeSingleLine } from "./text.js";
import type { TaskEvent, Todo, TodoStatus, Work, WorkStatus, WorkWithTodos } from "./types.js";

export const TASK_ENTRY_TYPE = "pi-tasks-state";
export const MAX_WORKS = 100;
export const MAX_TODOS = 500;

export class TaskState {
  private works = new Map<string, Work>();
  private todos = new Map<string, Todo>();
  private nextWorkId = 1;
  private nextTaskId = 1;

  constructor(private readonly pi: ExtensionAPI, private readonly onChange: () => void) {}

  restore(ctx: ExtensionContext): void {
    this.works.clear();
    this.todos.clear();
    this.nextWorkId = 1;
    this.nextTaskId = 1;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== TASK_ENTRY_TYPE) continue;
      const event = parseEvent(entry.data);
      if (!event) continue;
      try { this.apply(event); } catch { /* Ignore malformed extension entries and continue replay. */ }
    }
    this.onChange();
  }

  listWorks(filter?: { workId?: string; status?: WorkStatus }): WorkWithTodos[] {
    return [...this.works.values()]
      .filter((work) => !filter?.workId || work.workId === filter.workId)
      .filter((work) => !filter?.status || work.status === filter.status)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((work) => ({ ...work, tasks: this.listTodos({ workId: work.workId }) }));
  }

  listTodos(filter?: { taskId?: string; workId?: string; status?: TodoStatus }): Todo[] {
    return [...this.todos.values()]
      .filter((todo) => !filter?.taskId || todo.taskId === filter.taskId)
      .filter((todo) => !filter?.workId || todo.workId === filter.workId)
      .filter((todo) => !filter?.status || todo.status === filter.status)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((todo) => ({ ...todo }));
  }

  getWork(workId: string): Work | undefined {
    const work = this.works.get(workId);
    return work ? { ...work } : undefined;
  }

  getTodo(taskId: string): Todo | undefined {
    const todo = this.todos.get(taskId);
    return todo ? { ...todo } : undefined;
  }

  createWork(workName: string, workInfo: string, status: WorkStatus = "planned"): Work {
    if (this.works.size >= MAX_WORKS) throw new Error(`Maximum of ${MAX_WORKS} works reached.`);
    const now = Date.now();
    const work: Work = {
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

  updateWork(workId: string, patch: Partial<Pick<Work, "workName" | "workInfo" | "status">>): Work {
    if (!this.works.has(workId)) throw new Error(`Work ${workId} not found.`);
    const normalized = compactPatch({
      workName: patch.workName === undefined ? undefined : requiredName(patch.workName, "workName"),
      workInfo: patch.workInfo === undefined ? undefined : requiredText(patch.workInfo, "workInfo"),
      status: patch.status,
    });
    if (Object.keys(normalized).length === 0) throw new Error("WorkUpdate requires at least one changed field.");
    this.record({ version: 1, type: "work-updated", at: Date.now(), workId, patch: normalized });
    return this.getWork(workId)!;
  }

  deleteWork(workId: string): boolean {
    if (!this.works.has(workId)) return false;
    this.record({ version: 1, type: "work-deleted", at: Date.now(), workId });
    return true;
  }

  createTodo(workId: string, taskName: string, taskInfo: string, status: TodoStatus = "pending"): Todo {
    if (!this.works.has(workId)) throw new Error(`Work ${workId} not found.`);
    if (this.todos.size >= MAX_TODOS) throw new Error(`Maximum of ${MAX_TODOS} todos reached.`);
    const now = Date.now();
    const todo: Todo = {
      taskId: `T${this.nextTaskId}`,
      workId,
      taskName: requiredName(taskName, "taskName"),
      taskInfo: requiredText(taskInfo, "taskInfo"),
      status,
      createdAt: now,
      updatedAt: now,
    };
    this.record({ version: 1, type: "todo-created", at: now, todo });
    return { ...todo };
  }

  updateTodo(taskId: string, patch: Partial<Pick<Todo, "taskName" | "taskInfo" | "status">>): Todo {
    if (!this.todos.has(taskId)) throw new Error(`Todo ${taskId} not found.`);
    const normalized = compactPatch({
      taskName: patch.taskName === undefined ? undefined : requiredName(patch.taskName, "taskName"),
      taskInfo: patch.taskInfo === undefined ? undefined : requiredText(patch.taskInfo, "taskInfo"),
      status: patch.status,
    });
    if (Object.keys(normalized).length === 0) throw new Error("TodoUpdate requires at least one changed field.");
    this.record({ version: 1, type: "todo-updated", at: Date.now(), taskId, patch: normalized });
    return this.getTodo(taskId)!;
  }

  deleteTodo(taskId: string): boolean {
    if (!this.todos.has(taskId)) return false;
    this.record({ version: 1, type: "todo-deleted", at: Date.now(), taskId });
    return true;
  }

  private record(event: TaskEvent): void {
    this.pi.appendEntry(TASK_ENTRY_TYPE, event);
    this.apply(event);
    this.onChange();
  }

  private apply(event: TaskEvent): void {
    switch (event.type) {
      case "work-created":
        assertId(event.work.workId, "W");
        if (typeof event.work.workName !== "string" || typeof event.work.workInfo !== "string" || !isWorkStatus(event.work.status)) throw new Error("Malformed work entry.");
        this.works.set(event.work.workId, { ...event.work, workName: safeSingleLine(event.work.workName) });
        this.nextWorkId = Math.max(this.nextWorkId, numericId(event.work.workId) + 1);
        break;
      case "work-updated": {
        const work = this.works.get(event.workId);
        if (work) this.works.set(event.workId, {
          ...work,
          ...(typeof event.patch.workName === "string" ? { workName: safeSingleLine(event.patch.workName) } : {}),
          ...(typeof event.patch.workInfo === "string" ? { workInfo: event.patch.workInfo } : {}),
          ...(isWorkStatus(event.patch.status) ? { status: event.patch.status } : {}),
          updatedAt: event.at,
        });
        break;
      }
      case "work-deleted":
        this.works.delete(event.workId);
        for (const [taskId, todo] of this.todos) if (todo.workId === event.workId) this.todos.delete(taskId);
        break;
      case "todo-created":
        assertId(event.todo.taskId, "T");
        if (typeof event.todo.workId !== "string" || typeof event.todo.taskName !== "string" || typeof event.todo.taskInfo !== "string" || !isTodoStatus(event.todo.status)) throw new Error("Malformed todo entry.");
        if (this.works.has(event.todo.workId)) this.todos.set(event.todo.taskId, { ...event.todo, taskName: safeSingleLine(event.todo.taskName) });
        this.nextTaskId = Math.max(this.nextTaskId, numericId(event.todo.taskId) + 1);
        break;
      case "todo-updated": {
        const todo = this.todos.get(event.taskId);
        if (todo) this.todos.set(event.taskId, {
          ...todo,
          ...(typeof event.patch.taskName === "string" ? { taskName: safeSingleLine(event.patch.taskName) } : {}),
          ...(typeof event.patch.taskInfo === "string" ? { taskInfo: event.patch.taskInfo } : {}),
          ...(isTodoStatus(event.patch.status) ? { status: event.patch.status } : {}),
          updatedAt: event.at,
        });
        break;
      }
      case "todo-deleted":
        this.todos.delete(event.taskId);
        break;
    }
  }
}

function requiredText(value: string, field: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${field} must not be empty.`);
  return text;
}

function requiredName(value: string, field: string): string {
  const text = safeSingleLine(value);
  if (!text) throw new Error(`${field} must not be empty.`);
  return text;
}

function compactPatch<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function numericId(id: string): number {
  const value = Number.parseInt(id.slice(1), 10);
  return Number.isSafeInteger(value) ? value : 0;
}

function assertId(id: unknown, prefix: "W" | "T"): asserts id is string {
  if (typeof id !== "string" || !new RegExp(`^${prefix}[1-9]\\d*$`).test(id) || !Number.isSafeInteger(Number(id.slice(1)))) {
    throw new Error(`Malformed ${prefix === "W" ? "work" : "todo"} ID.`);
  }
}

function isWorkStatus(value: unknown): value is WorkStatus {
  return ["planned", "active", "blocked", "completed", "cancelled"].includes(String(value));
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return ["pending", "active", "blocked", "completed", "cancelled"].includes(String(value));
}

function parseEvent(value: unknown): TaskEvent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { version?: unknown; type?: unknown };
  if (candidate.version !== 1 || typeof candidate.type !== "string") return undefined;
  if (!["work-created", "work-updated", "work-deleted", "todo-created", "todo-updated", "todo-deleted"].includes(candidate.type)) return undefined;
  return value as TaskEvent;
}
