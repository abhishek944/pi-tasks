import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GitStatusCache } from "./git-status.js";
import type { TaskState } from "./state.js";
export declare function registerWorksCommand(pi: ExtensionAPI, state: TaskState, git: GitStatusCache, getOpenCommand: () => string[]): void;
