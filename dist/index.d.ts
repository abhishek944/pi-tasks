/** Session-scoped work and todo tracking for Pi. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function tasksExtension(pi: ExtensionAPI): void;
export type { Todo, TodoStatus, Work, WorkStatus, WorkWithTodos } from "./types.js";
