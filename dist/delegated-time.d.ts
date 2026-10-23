import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TaskState } from "./state.js";
export declare function createTimingReport(ctx: ExtensionContext, taskDir: string, workId: string, taskId: string): Promise<string>;
export declare function registerDelegatedTimeTools(pi: ExtensionAPI, state: TaskState): void;
