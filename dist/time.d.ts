import type { Todo, WorkWithTodos } from "./types.js";
/** Measured task effort, not time since task creation. */
export declare function taskTime(todo: Todo, now?: number): number | null;
/** Cancelled tasks still consumed effort. Unknown historical time stays unknown. */
export declare function workTime(work: WorkWithTodos, now?: number): number | null;
export declare function formatTime(elapsedMs: number | null): string;
