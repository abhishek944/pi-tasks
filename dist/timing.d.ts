import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TaskState } from "./state.js";
/** Runtime activity gates timing; task status never implies execution. */
export declare function registerTaskTiming(pi: ExtensionAPI, state: TaskState): void;
