import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TaskState } from "../state.js";
import type { TodoStatus, WorkStatus } from "../types.js";
export type TasksPanelMode = "floating" | "widget" | "off";
export declare class TasksPanelHost {
    private readonly state;
    private tui;
    private panel;
    private handle;
    private ui;
    private mode;
    constructor(state: TaskState);
    attach(ui: ExtensionUIContext): void;
    setMode(mode: TasksPanelMode): void;
    getMode(): TasksPanelMode;
    browse(): string | undefined;
    update(): void;
    hide(): void;
    private applyMode;
    private hideCurrent;
}
export declare function workIcon(status: WorkStatus, theme: Theme): string;
export declare function todoIcon(status: TodoStatus, theme: Theme): string;
export declare function frame(content: string, innerWidth: number, theme: Theme): string;
export declare function rule(innerWidth: number, theme: Theme): string;
export declare function border(innerWidth: number, edge: "top" | "bottom", theme: Theme): string;
