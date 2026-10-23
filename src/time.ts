import { taskOwner } from "./ownership.js";
import type { Todo, WorkWithTodos } from "./types.js";

/** Measured task effort, not time since task creation. */
export function taskTime(todo: Todo, now = Date.now()): number | null {
  // A delegate without a report is unmeasured, not a zero-length assignment.
  if (taskOwner(todo.taskInfo) === "delegate" && !todo.delegatedTimes?.length) return null;
  if (todo.elapsedMs === undefined || todo.elapsedMs === null) return null;
  let total = todo.elapsedMs + (todo.workingSince === undefined ? 0 : Math.max(0, now - todo.workingSince));
  for (const source of todo.delegatedTimes ?? []) {
    if (source.elapsedMs === null) return null;
    total += source.elapsedMs;
  }
  return Number.isSafeInteger(total) ? total : null;
}

/** Cancelled tasks still consumed effort. Unknown historical time stays unknown. */
export function workTime(work: WorkWithTodos, now = Date.now()): number | null {
  let total = 0;
  for (const todo of work.tasks) {
    const elapsed = taskTime(todo, now);
    if (elapsed === null) return null;
    total += elapsed;
    if (!Number.isSafeInteger(total)) return null;
  }
  return work.tasks.length ? total : null;
}

export function formatTime(elapsedMs: number | null): string {
  if (elapsedMs === null) return "—";
  const seconds = Math.floor(elapsedMs / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 1_000) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d`;
}
