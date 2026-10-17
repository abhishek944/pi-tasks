import type { Todo, WorkWithTodos } from "./types.js";
export declare function taskCompletion(todo: Todo): number | null;
export declare function workCompletion(work: WorkWithTodos): number | null;
export declare function formatCompletion(value: number | null): string;
