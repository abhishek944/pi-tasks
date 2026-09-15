export type WorkStatus = "planned" | "active" | "blocked" | "completed" | "cancelled";
export type TodoStatus = "pending" | "active" | "blocked" | "completed" | "cancelled";

export interface Work {
  workId: string;
  workName: string;
  workInfo: string;
  status: WorkStatus;
  createdAt: number;
  updatedAt: number;
}

export interface Todo {
  taskId: string;
  workId: string;
  taskName: string;
  taskInfo: string;
  status: TodoStatus;
  createdAt: number;
  updatedAt: number;
}

export interface WorkWithTodos extends Work {
  tasks: Todo[];
}

export type TaskEvent =
  | { version: 1; type: "work-created"; at: number; work: Work }
  | { version: 1; type: "work-updated"; at: number; workId: string; patch: Partial<Pick<Work, "workName" | "workInfo" | "status">> }
  | { version: 1; type: "work-deleted"; at: number; workId: string }
  | { version: 1; type: "todo-created"; at: number; todo: Todo }
  | { version: 1; type: "todo-updated"; at: number; taskId: string; patch: Partial<Pick<Todo, "taskName" | "taskInfo" | "status">> }
  | { version: 1; type: "todo-deleted"; at: number; taskId: string };
