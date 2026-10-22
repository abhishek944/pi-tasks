import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { taskOwner } from "./ownership.js";
import { taskCompletion } from "./progress.js";
import { safeSingleLine } from "./text.js";
import type { TaskEvent, Todo, TodoStatus, Work, WorkWithTodos } from "./types.js";

export const TASK_ENTRY_TYPE = "pi-tasks-state";
export const MAX_WORKS = 100;
export const MAX_TODOS = 500;

export class TaskState {
  private works = new Map<string, Work>();
  private todos = new Map<string, Todo>();
  private nextWorkId = 1;
  private nextTaskId = 1;
  private focusedTaskId: string | undefined;
  private workingSince: number | undefined;
  private agentRunning = false;

  constructor(private readonly pi: ExtensionAPI, private readonly onChange: () => void) {}

  restore(ctx: ExtensionContext): void {
    // The branch has already changed. Never append the old interval to it.
    this.focusedTaskId = undefined;
    this.workingSince = undefined;
    this.agentRunning = false;
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

  listWorks(filter?: { workId?: string }): WorkWithTodos[] {
    return [...this.works.values()]
      .filter((work) => !filter?.workId || work.workId === filter.workId)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((work) => ({ ...work, tasks: this.listTodos({ workId: work.workId }) }));
  }

  listTodos(filter?: { taskId?: string; workId?: string; status?: TodoStatus }): Todo[] {
    return [...this.todos.values()]
      .filter((todo) => !filter?.taskId || todo.taskId === filter.taskId)
      .filter((todo) => !filter?.workId || todo.workId === filter.workId)
      .filter((todo) => !filter?.status || todo.status === filter.status)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((todo) => this.snapshot(todo));
  }

  getWork(workId: string): Work | undefined {
    const work = this.works.get(workId);
    return work ? { ...work } : undefined;
  }

  getTodo(taskId: string): Todo | undefined {
    const todo = this.todos.get(taskId);
    return todo ? this.snapshot(todo) : undefined;
  }

  private snapshot(todo: Todo): Todo {
    return { ...todo, workingSince: todo.taskId === this.focusedTaskId ? this.workingSince : undefined };
  }

  /** Gate the selected task on actual agent execution, not task status. */
  setAgentRunning(running: boolean): void {
    if (this.agentRunning === running) return;
    if (!running) this.saveInterval();
    this.agentRunning = running;
    if (running && this.focusedTaskId) this.workingSince = Date.now();
    this.onChange();
  }

  setWorking(taskId: string, working: boolean): void {
    const todo = this.todos.get(taskId);
    if (!todo) throw new Error(`Todo ${taskId} not found.`);
    if (!working) {
      if (this.focusedTaskId === taskId) this.clearWorking();
      return;
    }
    if (todo.status !== "active" || taskOwner(todo.taskInfo) !== "self") {
      throw new Error("working=true requires an active task with owner: self in this session.");
    }
    if (this.focusedTaskId === taskId) return;
    this.clearWorking();
    if (todo.elapsedMs === undefined || todo.elapsedMs === null) {
      this.record({ version: 1, type: "todo-time", at: Date.now(), taskId, elapsedMs: 0 });
    }
    this.focusedTaskId = taskId;
    if (this.agentRunning) this.workingSince = Date.now();
    this.onChange();
  }

  clearWorking(): void {
    this.saveInterval();
    this.focusedTaskId = undefined;
    this.onChange();
  }

  private saveInterval(): void {
    if (!this.focusedTaskId || this.workingSince === undefined) return;
    const todo = this.todos.get(this.focusedTaskId);
    const now = Date.now();
    if (todo) {
      this.record({ version: 1, type: "todo-time", at: now, taskId: todo.taskId,
        elapsedMs: (todo.elapsedMs ?? 0) + Math.max(0, now - this.workingSince) });
    }
    this.workingSince = undefined;
  }

  createWork(workName: string, workInfo: string): Work {
    if (this.works.size >= MAX_WORKS) throw new Error(`Maximum of ${MAX_WORKS} works reached.`);
    const now = Date.now();
    const work: Work = {
      workId: `W${this.nextWorkId}`,
      workName: requiredName(workName, "workName"),
      workInfo: requiredText(workInfo, "workInfo"),
      createdAt: now,
      updatedAt: now,
    };
    this.record({ version: 1, type: "work-created", at: now, work });
    return { ...work };
  }

  updateWork(workId: string, patch: Partial<Pick<Work, "workName" | "workInfo">>): Work {
    if (!this.works.has(workId)) throw new Error(`Work ${workId} not found.`);
    const normalized = compactPatch({
      workName: patch.workName === undefined ? undefined : requiredName(patch.workName, "workName"),
      workInfo: patch.workInfo === undefined ? undefined : requiredText(patch.workInfo, "workInfo"),
    });
    if (Object.keys(normalized).length === 0) throw new Error("WorkUpdate requires at least one changed field.");
    this.record({ version: 1, type: "work-updated", at: Date.now(), workId, patch: normalized });
    return this.getWork(workId)!;
  }

  deleteWork(workId: string): boolean {
    if (!this.works.has(workId)) return false;
    if (this.focusedTaskId && this.todos.get(this.focusedTaskId)?.workId === workId) this.clearWorking();
    this.record({ version: 1, type: "work-deleted", at: Date.now(), workId });
    return true;
  }

  createTodo(workId: string, taskName: string, taskInfo: string, status: TodoStatus = "active", completionPercent?: number | null): Todo {
    if (!this.works.has(workId)) throw new Error(`Work ${workId} not found.`);
    if (this.todos.size >= MAX_TODOS) throw new Error(`Maximum of ${MAX_TODOS} todos reached.`);
    validateCompletion(status, completionPercent);
    const now = Date.now();
    const todo: Todo = {
      taskId: `T${this.nextTaskId}`,
      workId,
      taskName: requiredName(taskName, "taskName"),
      taskInfo: requiredText(taskInfo, "taskInfo"),
      status,
      completionPercent: status === "completed" ? 100 : completionPercent ?? null,
      elapsedMs: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.record({ version: 1, type: "todo-created", at: now, todo });
    return { ...todo };
  }

  updateTodo(taskId: string, patch: Partial<Pick<Todo, "taskName" | "taskInfo" | "status" | "completionPercent">> & { working?: boolean }): Todo {
    const current = this.todos.get(taskId);
    if (!current) throw new Error(`Todo ${taskId} not found.`);
    validateCompletion(patch.status ?? current.status, patch.completionPercent);
    const normalized = compactPatch({
      taskName: patch.taskName === undefined ? undefined : requiredName(patch.taskName, "taskName"),
      taskInfo: patch.taskInfo === undefined ? undefined : requiredText(patch.taskInfo, "taskInfo"),
      status: patch.status,
      completionPercent: patch.completionPercent,
    });
    if (Object.keys(normalized).length === 0 && patch.working === undefined) throw new Error("TodoUpdate requires at least one changed field.");
    const effective = { ...current, ...normalized };
    const canWork = effective.status === "active" && taskOwner(effective.taskInfo) === "self";
    if (patch.working === true && !canWork) throw new Error("working=true requires an active task with owner: self in this session.");
    if (this.focusedTaskId === taskId && (!canWork || patch.working === false)) this.clearWorking();
    if (Object.keys(normalized).length > 0) this.record({ version: 1, type: "todo-updated", at: Date.now(), taskId, patch: normalized });
    if (patch.working !== undefined) this.setWorking(taskId, patch.working);
    return this.getTodo(taskId)!;
  }

  deleteTodo(taskId: string): boolean {
    if (!this.todos.has(taskId)) return false;
    if (this.focusedTaskId === taskId) this.clearWorking();
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
      case "work-created": {
        assertId(event.work.workId, "W");
        if (typeof event.work.workName !== "string" || typeof event.work.workInfo !== "string") throw new Error("Malformed work entry.");
        // Explicit fields keep retired Work status out of restored records.
        this.works.set(event.work.workId, {
          workId: event.work.workId,
          workName: safeSingleLine(event.work.workName),
          workInfo: event.work.workInfo,
          createdAt: event.work.createdAt,
          updatedAt: event.work.updatedAt,
        });
        this.nextWorkId = Math.max(this.nextWorkId, numericId(event.work.workId) + 1);
        break;
      }
      case "work-updated": {
        const work = this.works.get(event.workId);
        if (work) this.works.set(event.workId, {
          ...work,
          ...(typeof event.patch.workName === "string" ? { workName: safeSingleLine(event.patch.workName) } : {}),
          ...(typeof event.patch.workInfo === "string" ? { workInfo: event.patch.workInfo } : {}),
          updatedAt: event.at,
        });
        break;
      }
      case "work-deleted":
        this.works.delete(event.workId);
        for (const [taskId, todo] of this.todos) if (todo.workId === event.workId) this.todos.delete(taskId);
        break;
      case "todo-created": {
        const status = restoredStatus(event.todo.status);
        assertId(event.todo.taskId, "T");
        if (typeof event.todo.workId !== "string" || typeof event.todo.taskName !== "string" || typeof event.todo.taskInfo !== "string" || !status) throw new Error("Malformed todo entry.");
        if (this.works.has(event.todo.workId)) this.todos.set(event.todo.taskId, {
          ...event.todo,
          status,
          taskName: safeSingleLine(event.todo.taskName),
          completionPercent: taskCompletion(event.todo),
          elapsedMs: validElapsed(event.todo.elapsedMs) ? event.todo.elapsedMs : null,
          workingSince: undefined,
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
      case "todo-time": {
        const todo = this.todos.get(event.taskId);
        if (todo && validElapsed(event.elapsedMs)) this.todos.set(event.taskId, { ...todo, elapsedMs: event.elapsedMs });
        break;
      }
      case "todo-deleted":
        this.todos.delete(event.taskId);
        break;
    }
  }
}

function validElapsed(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validateCompletion(status: TodoStatus, value: number | null | undefined): void {
  if (value === undefined || value === null) return;
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error("completionPercent must be an integer from 0 to 100, or null for unknown.");
  if (value === 100 && status !== "completed") throw new Error("100% requires verified completion. Set status to completed after verification.");
  if (status === "completed" && value !== 100) throw new Error("Completed tasks have 100% progress. Reopen the task before reporting partial progress.");
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

function restoredStatus(value: unknown): TodoStatus | undefined {
  // Keep legacy branch events readable without exposing retired statuses in tools.
  if (value === "planned" || value === "pending") return "active";
  if (value === "active" || value === "blocked" || value === "completed" || value === "cancelled") return value;
  return undefined;
}

function parseEvent(value: unknown): TaskEvent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { version?: unknown; type?: unknown };
  if (candidate.version !== 1 || typeof candidate.type !== "string") return undefined;
  if (!["work-created", "work-updated", "work-deleted", "todo-created", "todo-updated", "todo-deleted", "todo-time"].includes(candidate.type)) return undefined;
  return value as TaskEvent;
}
