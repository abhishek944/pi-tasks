import type { Todo, WorkWithTodos } from "./types.js";

export function taskCompletion(todo: Todo): number | null {
  if (todo.status === "completed") return 100;
  const value = todo.completionPercent;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 100 ? value : null;
}

export function workCompletion(work: WorkWithTodos): number | null {
  const tasks = work.tasks.filter((todo) => todo.status !== "cancelled");
  if (tasks.length === 0) return null;
  let total = 0;
  for (const todo of tasks) {
    const value = taskCompletion(todo);
    if (value === null) return null;
    total += value;
  }
  return Math.floor(total / tasks.length);
}

export function formatCompletion(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}
